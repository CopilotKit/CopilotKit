import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    integration: "ag2",
    timestamp: new Date().toISOString(),
  });
}
