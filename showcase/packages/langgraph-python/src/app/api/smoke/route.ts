import { NextResponse } from "next/server";

const INTEGRATION_SLUG = "langgraph-python";
const LANGGRAPH_URL =
  process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8123";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const start = Date.now();
  try {
    // Check LangGraph backend is alive
    const healthRes = await fetch(`${LANGGRAPH_URL}/ok`, {
      signal: AbortSignal.timeout(10000),
    });
    const latency = Date.now() - start;

    if (!healthRes.ok) {
      return NextResponse.json(
        {
          status: "error",
          integration: INTEGRATION_SLUG,
          stage: "langgraph_health",
          error: `LangGraph returned ${healthRes.status}`,
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
    else if (err.message.includes("ECONNREFUSED")) stage = "agent_unreachable";
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
