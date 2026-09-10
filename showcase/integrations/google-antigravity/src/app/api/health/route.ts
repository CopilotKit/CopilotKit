import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    integration: "google-adk",
    timestamp: new Date().toISOString(),
  });
}
