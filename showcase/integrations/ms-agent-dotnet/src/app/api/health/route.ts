import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    integration: "ms-agent-dotnet",
    timestamp: new Date().toISOString(),
  });
}
