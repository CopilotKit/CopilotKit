import { NextRequest, NextResponse } from "next/server";

const AGENT_URL =
  process.env.AGENT_URL ||
  process.env.LANGGRAPH_DEPLOYMENT_URL ||
  "http://localhost:8123";

export async function GET(req: NextRequest) {
  let agentStatus = "unknown";
  try {
    const res = await fetch(`${AGENT_URL}/ok`, {
      signal: AbortSignal.timeout(3000),
    });
    agentStatus = res.ok ? "ok" : "error";
  } catch {
    agentStatus = "down";
  }

  const publicResponse: Record<string, unknown> = {
    status: agentStatus === "ok" ? "ok" : "degraded",
    integration: "google-adk",
    agent: agentStatus,
    timestamp: new Date().toISOString(),
  };

  const token =
    req.headers.get("x-debug-token") || req.nextUrl.searchParams.get("debug");
  const expectedToken = process.env.SHOWCASE_DEBUG_TOKEN;

  if (token && expectedToken && token === expectedToken) {
    publicResponse.diagnostics = {
      agent_url: AGENT_URL,
      env: {
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "set" : "NOT SET",
        NODE_ENV: process.env.NODE_ENV,
        PORT: process.env.PORT,
      },
    };
  }

  const httpStatus = publicResponse.status === "ok" ? 200 : 503;
  return NextResponse.json(publicResponse, { status: httpStatus });
}
