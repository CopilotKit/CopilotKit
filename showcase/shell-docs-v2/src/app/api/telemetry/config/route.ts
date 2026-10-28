import { connection } from "next/server";
import { getTelemetryConfig } from "@/lib/telemetry/config";

// The browser's telemetry keys, read from the live env per request. Serving
// them here instead of inlining them in the root layout (as shell-docs did)
// keeps every page statically renderable.
export async function GET() {
  await connection();
  return Response.json(getTelemetryConfig(), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
