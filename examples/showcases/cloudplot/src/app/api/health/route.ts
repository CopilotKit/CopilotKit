import { NextResponse } from "next/server";

const AGENT_PROBE_TIMEOUT_MS = 2_000;

export async function GET() {
  const deploymentUrl = process.env.LANGGRAPH_DEPLOYMENT_URL;
  if (!deploymentUrl) {
    return unhealthyResponse();
  }

  try {
    const response = await fetch(`${deploymentUrl.replace(/\/$/, "")}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(AGENT_PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return unhealthyResponse();

    return NextResponse.json({
      status: "ok",
      service: "cloudplot-frontend",
      agent: "reachable",
    });
  } catch {
    return unhealthyResponse();
  }
}

function unhealthyResponse() {
  return NextResponse.json(
    {
      status: "degraded",
      service: "cloudplot-frontend",
      agent: "unreachable",
    },
    { status: 503 },
  );
}
