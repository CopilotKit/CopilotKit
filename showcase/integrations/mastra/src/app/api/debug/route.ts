import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const token =
    req.headers.get("x-debug-token") || req.nextUrl.searchParams.get("token");
  const expectedToken = process.env.SHOWCASE_DEBUG_TOKEN;

  if (!expectedToken || !token || token !== expectedToken) {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }

  const uptime = process.uptime();
  const mem = process.memoryUsage();

  return NextResponse.json({
    integration: "mastra",
    runtime: "in-process",
    uptime: `${Math.floor(uptime / 60)}m ${Math.floor(uptime % 60)}s`,
    memory: {
      rss: `${Math.round(mem.rss / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)}MB`,
    },
    env: {
      NODE_ENV: process.env.NODE_ENV,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "set" : "NOT SET",
    },
    nodeVersion: process.version,
  });
}
