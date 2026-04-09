import { NextRequest, NextResponse } from "next/server";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

export async function GET(req: NextRequest) {
  // Check agent backend reachability
  let agentStatus = "unknown";
  try {
    const res = await fetch(`${AGENT_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    agentStatus = res.ok ? "ok" : "error";
  } catch {
    agentStatus = "down";
  }

  // Public response: safe to expose
  const publicResponse: Record<string, any> = {
    status: agentStatus === "ok" ? "ok" : "degraded",
    integration: "pydantic-ai",
    agent: agentStatus,
    timestamp: new Date().toISOString(),
  };

  // Extended diagnostics: only with debug token
  const token =
    req.headers.get("x-debug-token") || req.nextUrl.searchParams.get("debug");
  const expectedToken = process.env.SHOWCASE_DEBUG_TOKEN;

  if (token && expectedToken && token === expectedToken) {
    publicResponse.diagnostics = {
      agent_url: AGENT_URL,
      env: {
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "set" : "NOT SET",
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? "set" : "NOT SET",
        NODE_ENV: process.env.NODE_ENV,
        PORT: process.env.PORT,
      },
    };
  }

  const httpStatus = publicResponse.status === "ok" ? 200 : 503;
  return NextResponse.json(publicResponse, { status: httpStatus });
}
