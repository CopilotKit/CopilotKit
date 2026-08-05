import { NextResponse } from "next/server";

const INTEGRATION_SLUG = "acp-agent";
const SMOKE_AGENT_ID = "agentic_chat";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const start = Date.now();
  // Hit our own /api/copilotkit endpoint — tests the full deployed stack
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ||
    `http://localhost:${process.env.PORT || 10000}`;

  try {
    const res = await fetch(`${baseUrl}/api/copilotkit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "agent/run",
        params: { agentId: SMOKE_AGENT_ID },
        body: {
          threadId: `smoke-${Date.now()}`,
          runId: `smoke-run-${Date.now()}`,
          state: {},
          messages: [
            {
              id: `smoke-msg-${Date.now()}`,
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

    // The endpoint can return a non-empty error stream with HTTP 200, so require
    // the terminal AG-UI event instead of treating any bytes as success.
    const body = await res.text();
    if (!body.includes('"type":"RUN_FINISHED"')) {
      return NextResponse.json(
        {
          status: "error",
          integration: INTEGRATION_SLUG,
          stage: "run_incomplete",
          error: "Runtime stream did not finish the ACP run",
          latency_ms: latency,
          timestamp: new Date().toISOString(),
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      status: "ok",
      integration: INTEGRATION_SLUG,
      latency_ms: latency,
      timestamp: new Date().toISOString(),
    });
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    const latency = Date.now() - start;

    let stage = "unknown";
    if (
      err.name === "AbortError" ||
      err.name === "TimeoutError" ||
      err.message.includes("timeout")
    )
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
