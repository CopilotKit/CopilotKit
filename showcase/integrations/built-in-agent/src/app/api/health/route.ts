import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    integration: "built-in-agent",
    timestamp: new Date().toISOString(),
  });
}
