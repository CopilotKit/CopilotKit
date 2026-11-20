import { NextResponse } from "next/server";

export async function GET() {
  const agentUrl = process.env.AGENT_URL || "http://localhost:8000";
  let agentStatus: "ok" | "down" | "error" = "down";
  let agentDetail = "";

  try {
    const response = await fetch(`${agentUrl}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    agentStatus = response.ok ? "ok" : "error";
    agentDetail = `HTTP ${response.status}`;
  } catch (error) {
    agentStatus = "down";
    agentDetail = error instanceof Error ? error.message : String(error);
    console.error(
      `[health] agent probe failed (${agentUrl}/health): ${agentDetail}`,
    );
  }

  return NextResponse.json(
    {
      status: "ok",
      integration: "ms-agent-harness-dotnet",
      agent: agentStatus,
      agent_detail: agentDetail,
      timestamp: new Date().toISOString(),
    },
    // ALWAYS 200. This route is the PUBLIC front door: the container
    // watchdog polls it to decide whether the Next.js listener itself is
    // wedged, and Railway's healthcheckPath points at it. Returning 503 for
    // an unhealthy AGENT conflates two different faults — a slow agent would
    // make the watchdog kill a perfectly healthy frontend, and would fail the
    // Railway healthcheck for a frontend that is serving fine. Agent health is
    // reported in the `agent` field above; the container's agent-side watchdog
    // branch (:8000/health) is what acts on it. Matches the other 20
    // integrations, which all return an unconditional 200 here.
    { status: 200 },
  );
}
