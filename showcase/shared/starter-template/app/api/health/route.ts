import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    integration: "{{SLUG}}",
    timestamp: new Date().toISOString(),
  });
}
