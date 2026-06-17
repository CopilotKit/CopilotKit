import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    integration: "spring-ai",
    timestamp: new Date().toISOString(),
  });
}
