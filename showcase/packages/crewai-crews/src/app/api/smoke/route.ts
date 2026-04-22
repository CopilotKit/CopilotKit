import { NextResponse } from "next/server";

const INTEGRATION_SLUG = "crewai-crews";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Upstream fetch timeout. Kept strictly shorter than ``maxDuration`` (60s)
// so that a hung upstream can't exhaust the whole route budget: a stuck
// agent surfaces as a clean ``timeout`` stage within ~25s, leaving room
// for the response JSON to be written before Next.js kills the request.
// Previously the inner fetch shared the full 45s timeout, which — when
// the agent hung — caused the smoke route itself to hang for 30s+ of the
// 60s budget before the platform cut it, producing HTTP 000 at the
// caller instead of a structured ``stage: "timeout"`` response.
const UPSTREAM_TIMEOUT_MS = 25_000;

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
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
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

    // Response is SSE stream — just verify we got content
    const body = await res.text();
    if (body.length === 0) {
      return NextResponse.json(
        {
          status: "error",
          integration: INTEGRATION_SLUG,
          stage: "response_empty",
          error: "Runtime returned empty response body",
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
