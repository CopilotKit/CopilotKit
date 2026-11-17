// Which models can run on this server, for the playground's model picker.
//   GET /api/models -> { models: [{ id, available, note, reason? }] }
// Only yes/no and short notes leave the server: never keys, URLs or other env values.
import { modelAvailability } from "@/agent/models";
import { RATE_LIMITS, rateLimiter } from "@/lib/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const limit = rateLimiter(RATE_LIMITS.models);

export function GET(request: Request) {
  return (
    limit(request) ??
    Response.json(
      { models: modelAvailability() },
      { headers: { "Cache-Control": "no-store" } },
    )
  );
}
