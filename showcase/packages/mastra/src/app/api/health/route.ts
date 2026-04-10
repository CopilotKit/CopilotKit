import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  // Mastra runs in-process — no external agent to ping
  const publicResponse: Record<string, unknown> = {
    status: "ok",
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
