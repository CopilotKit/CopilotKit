import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    integration: "llamaindex",
    timestamp: new Date().toISOString(),
  });
}
