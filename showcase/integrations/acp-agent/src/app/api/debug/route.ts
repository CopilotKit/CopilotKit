import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { acpHealthUrl, missingAcpEnvironment } from "@/lib/acp-runtime";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const token =
    request.headers.get("x-debug-token") ??
    request.nextUrl.searchParams.get("token");
  const expectedToken = process.env.SHOWCASE_DEBUG_TOKEN;

  if (!expectedToken || token !== expectedToken) {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }

  return NextResponse.json({
    healthUrl: acpHealthUrl(),
    integration: "acp-agent",
    memory: process.memoryUsage(),
    missing: missingAcpEnvironment(),
    nodeVersion: process.version,
    uptimeSeconds: process.uptime(),
  });
}
