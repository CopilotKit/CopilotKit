import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { resolveEndpoint } from "@/lib/endpoint";

export const dynamic = "force-dynamic";

export const POST = async (req: NextRequest) => {
  const resolved = resolveEndpoint(req);
  if ("errorResponse" in resolved) {
    return resolved.errorResponse;
  }
  const { endpoint } = resolved;

  const target = `${endpoint}fixture/reset`;

  try {
    const upstream = await fetch(target, {
      method: "POST",
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });

    const text = await upstream.text();
    try {
      const payload = text.length > 0 ? JSON.parse(text) : null;
      return NextResponse.json(payload, { status: upstream.status });
    } catch {
      return NextResponse.json(
        { error: `Agent returned non-JSON: ${text.slice(0, 200)}` },
        { status: 502 },
      );
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const isTimeout = err.name === "TimeoutError" || err.name === "AbortError";
    const prefix = isTimeout
      ? `Timeout reaching agent at ${endpoint}`
      : `Failed to reach agent at ${endpoint}`;
    return NextResponse.json(
      { error: `${prefix}: ${err.message}` },
      { status: 502 },
    );
  }
};
