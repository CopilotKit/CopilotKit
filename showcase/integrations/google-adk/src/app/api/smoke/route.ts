import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

const INTEGRATION_SLUG = "google-adk";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RunOutcome =
  | { status: "finished" }
  | { status: "error"; message: string }
  | { status: "incomplete" };

// Read the AG-UI event stream until the run reaches a terminal event. The
// runtime streams 200 and RUN_STARTED even when the run then fails (for
// example when the Gemini call is rejected), so the first chunk alone proves
// nothing: only RUN_FINISHED counts as success.
async function readRunOutcome(
  body: ReadableStream<Uint8Array>,
): Promise<RunOutcome> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = done ? "" : (lines.pop() ?? "");
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        let event: { type?: string; message?: string };
        try {
          event = JSON.parse(line.slice("data:".length));
        } catch {
          continue;
        }
        if (event.type === "RUN_ERROR") {
          return { status: "error", message: event.message ?? "RUN_ERROR" };
        }
        if (event.type === "RUN_FINISHED") return { status: "finished" };
      }
      if (done) return { status: "incomplete" };
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

export async function GET() {
  const start = Date.now();
  // Hit our own /api/copilotkit endpoint — tests the full deployed stack
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ||
    `http://localhost:${process.env.PORT || 3000}`;

  try {
    const res = await fetch(`${baseUrl}/api/copilotkit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "agent/run",
        params: { agentId: "agentic_chat" },
        body: {
          // Fresh ids per run, as the LangGraph smoke routes send.
          threadId: randomUUID(),
          runId: randomUUID(),
          state: {},
          messages: [
            {
              id: randomUUID(),
              role: "user",
              content: "Respond with exactly: OK",
            },
          ],
          tools: [],
          context: [],
          forwardedProps: {},
        },
      }),
      signal: AbortSignal.timeout(45000),
    });

    const latency = Date.now() - start;

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      return NextResponse.json(
        {
          status: "error",
          integration: INTEGRATION_SLUG,
          stage: "runtime_response",
          error: `Runtime returned ${res.status}: ${errBody.slice(0, 200)}`,
          latency_ms: latency,
          timestamp: new Date().toISOString(),
        },
        { status: 502 },
      );
    }

    if (!res.body) {
      return NextResponse.json(
        {
          status: "error",
          integration: INTEGRATION_SLUG,
          stage: "response_empty",
          error: "Runtime returned no readable body",
          latency_ms: latency,
          timestamp: new Date().toISOString(),
        },
        { status: 502 },
      );
    }

    const outcome = await readRunOutcome(res.body);
    if (outcome.status !== "finished") {
      return NextResponse.json(
        {
          status: "error",
          integration: INTEGRATION_SLUG,
          stage: outcome.status === "error" ? "run_error" : "run_incomplete",
          error:
            outcome.status === "error"
              ? `Run failed: ${outcome.message.slice(0, 200)}`
              : "Stream ended without RUN_FINISHED",
          latency_ms: Date.now() - start,
          timestamp: new Date().toISOString(),
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      status: "ok",
      integration: INTEGRATION_SLUG,
      latency_ms: Date.now() - start,
      timestamp: new Date().toISOString(),
    });
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    const latency = Date.now() - start;

    let stage = "unknown";
    if (err.name === "AbortError" || err.message.includes("timeout"))
      stage = "timeout";
    else if (
      err.message.includes("fetch") ||
      err.message.includes("ECONNREFUSED")
    )
      stage = "agent_unreachable";
    else stage = "pipeline_error";

    return NextResponse.json(
      {
        status: "error",
        integration: INTEGRATION_SLUG,
        stage,
        error: err.message,
        latency_ms: latency,
        timestamp: new Date().toISOString(),
      },
      { status: 502 },
    );
  }
}
