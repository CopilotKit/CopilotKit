import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    integration: "crewai-conversational-flows",
    timestamp: new Date().toISOString(),
  });
}
