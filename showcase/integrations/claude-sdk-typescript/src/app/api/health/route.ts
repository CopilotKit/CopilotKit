import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    integration: "claude-sdk-typescript",
    timestamp: new Date().toISOString(),
  });
}
