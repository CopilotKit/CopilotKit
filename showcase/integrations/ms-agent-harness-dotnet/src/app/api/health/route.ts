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
    { status: agentStatus === "ok" ? 200 : 503 },
  );
}
