import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    integration: "openai-agents-python",
    timestamp: new Date().toISOString(),
  });
}
