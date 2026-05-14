import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    integration: "langgraph-typescript",
    timestamp: new Date().toISOString(),
  });
}
