import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    integration: "strands",
    timestamp: new Date().toISOString(),
  });
}
