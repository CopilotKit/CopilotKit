import { NextResponse } from "next/server";

const INTEGRATION_SLUG = "agno";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

    // Response is SSE stream. The agno agent is known to drop the terminal
    // event (TEXT_MESSAGE_END / RUN_FINISHED / RUN_ERROR), leaving the stream
    // open until the client timeout fires — which surfaces as a 502 even
    // though the agent produced valid output. Read the stream incrementally
    // and bail as soon as we see TEXT_MESSAGE_CONTENT with "OK" in the delta,
    // regardless of whether the agent ever closes the stream. See PR
    // description for root-cause details.
    const reader = res.body?.getReader();
    if (!reader) {
      return NextResponse.json(
        {
          status: "error",
          integration: INTEGRATION_SLUG,
          stage: "response_empty",
          error: "Runtime returned no response body",
          latency_ms: latency,
          timestamp: new Date().toISOString(),
        },
        { status: 502 },
      );
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let gotOk = false;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (
          buffer.includes('"type":"TEXT_MESSAGE_CONTENT"') &&
          buffer.includes('"OK"')
        ) {
          gotOk = true;
          // Drop the connection; don't await a stream close that may never come.
          await reader.cancel().catch(() => {});
          break;
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // reader may already be released via cancel(); ignore.
      }
    }

    const finalLatency = Date.now() - start;

    if (!gotOk && buffer.length === 0) {
      return NextResponse.json(
        {
          status: "error",
          integration: INTEGRATION_SLUG,
          stage: "response_empty",
          error: "Runtime returned empty response body",
          latency_ms: finalLatency,
          timestamp: new Date().toISOString(),
        },
        { status: 502 },
      );
    }

    if (!gotOk) {
      return NextResponse.json(
        {
          status: "error",
          integration: INTEGRATION_SLUG,
          stage: "response_incomplete",
          error:
            "Stream ended without TEXT_MESSAGE_CONTENT 'OK': " +
            buffer.slice(0, 200),
          latency_ms: finalLatency,
          timestamp: new Date().toISOString(),
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      status: "ok",
      integration: INTEGRATION_SLUG,
      latency_ms: finalLatency,
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
