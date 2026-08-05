import type { NextResponse } from "next/server";
import { runSmoke } from "../../../lib/smoke-runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(): Promise<NextResponse> {
  return runSmoke();
}
