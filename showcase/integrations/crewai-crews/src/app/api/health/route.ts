import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    integration: "crewai-crews",
    timestamp: new Date().toISOString(),
  });
}
