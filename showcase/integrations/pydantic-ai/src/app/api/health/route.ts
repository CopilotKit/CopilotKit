import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    integration: "pydantic-ai",
    timestamp: new Date().toISOString(),
  });
}
