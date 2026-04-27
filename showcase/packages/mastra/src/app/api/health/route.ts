import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ||
    `http://localhost:${process.env.PORT || 3000}`;

  let agentStatus = "unknown";
  try {
    const res = await fetch(`${baseUrl}/api/copilotkit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "agent/run",
        params: { agentId: "agentic_chat" },
        body: {
          threadId: "health-check",
          runId: "health-check",
          state: {},
          messages: [],
          tools: [],
          context: [],
          forwardedProps: {},
        },
      }),
      signal: AbortSignal.timeout(3000),
    });
    // Any non-network-error response means runtime is alive
    agentStatus = res.ok || res.status < 500 ? "ok" : "error";
  } catch {
    agentStatus = "down";
  }

  const publicResponse: Record<string, unknown> = {
    status: agentStatus === "ok" ? "ok" : "degraded",
    integration: "mastra",
    agent: "in-process",
    timestamp: new Date().toISOString(),
  };

  const token =
    req.headers.get("x-debug-token") || req.nextUrl.searchParams.get("debug");
  const expectedToken = process.env.SHOWCASE_DEBUG_TOKEN;

  if (token && expectedToken && token === expectedToken) {
    publicResponse.diagnostics = {
      runtime: "in-process (mastra)",
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
