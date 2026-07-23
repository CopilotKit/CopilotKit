import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  // Token-gated: SHOWCASE_DEBUG_TOKEN must be set in env and matched
  const token =
    req.headers.get("x-debug-token") || req.nextUrl.searchParams.get("token");
  const expectedToken = process.env.SHOWCASE_DEBUG_TOKEN;

  if (!expectedToken || !token || token !== expectedToken) {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }

  const AGENT_URL =
    process.env.AGENT_URL || process.env.LANGGRAPH_DEPLOYMENT_URL || "unknown";

  // Agent connectivity
  let agentStatus = "unknown";
  let agentDetail = "";
  try {
    const res = await fetch(`${AGENT_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    agentStatus = res.ok ? "ok" : "error";
    agentDetail = `HTTP ${res.status}`;
  } catch (e: unknown) {
    agentStatus = "down";
    agentDetail = (e as Error).message;
  }

  const uptime = process.uptime();
  const mem = process.memoryUsage();

  return NextResponse.json({
    integration: "langgraph-typescript",
    uptime: `${Math.floor(uptime / 60)}m ${Math.floor(uptime % 60)}s`,
    agent: { url: AGENT_URL, status: agentStatus, detail: agentDetail },
    memory: {
      rss: `${Math.round(mem.rss / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)}MB`,
    },
    env: {
      NODE_ENV: process.env.NODE_ENV,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "set" : "NOT SET",
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? "set" : "NOT SET",
      LANGSMITH_API_KEY: process.env.LANGSMITH_API_KEY ? "set" : "NOT SET",
    },
    nodeVersion: process.version,
  });
}
