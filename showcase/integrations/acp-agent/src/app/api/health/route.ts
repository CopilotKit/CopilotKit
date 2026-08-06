import { NextResponse } from "next/server";
import { acpHealthUrl, missingAcpEnvironment } from "@/lib/acp-runtime";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const missing = missingAcpEnvironment();
  if (missing.length > 0) {
    return NextResponse.json(
      {
        agent: "unconfigured",
        integration: "acp-agent",
        missing,
        status: "error",
      },
      { status: 503 },
    );
  }

  try {
    const response = await fetch(acpHealthUrl(), {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    return NextResponse.json(
      {
        agent: response.ok ? "ok" : "error",
        integration: "acp-agent",
        status: response.ok ? "ok" : "error",
      },
      { status: response.ok ? 200 : 503 },
    );
  } catch (error: unknown) {
    console.error("[health] Intelligence app-api probe failed", error);
    return NextResponse.json(
      {
        agent: "down",
        integration: "acp-agent",
        status: "error",
      },
      { status: 503 },
    );
  }
}
