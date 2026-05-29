import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    integration: "langgraph-python",
    timestamp: new Date().toISOString(),
  });
}
