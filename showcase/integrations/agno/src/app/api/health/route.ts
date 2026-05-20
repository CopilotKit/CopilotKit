import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    integration: "agno",
    timestamp: new Date().toISOString(),
  });
}
