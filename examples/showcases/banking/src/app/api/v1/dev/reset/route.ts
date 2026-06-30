import * as store from "@/lib/store";
import { forgetAllMemories } from "@/lib/intelligence/forget-memories";

/**
 * Dev/booth-only: restore the demo to a fresh "teachable" state.
 * 1. Re-seed the in-memory transaction store (over-limit charges back to pending).
 * 2. If Intelligence is configured, forget the learned procedure from durable memory
 *    so the fail -> teach -> succeed arc replays for the next booth visitor.
 *   curl -s -X POST http://localhost:3000/api/v1/dev/reset
 * Disabled when NODE_ENV === "production".
 */
export const POST = async () => {
  if (process.env.NODE_ENV === "production") {
    return new Response(JSON.stringify({ error: "disabled in production" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }
  store.reset();
  const apiUrl = process.env.INTELLIGENCE_API_URL;
  const apiKey = process.env.INTELLIGENCE_API_KEY;
  if (!apiUrl || !apiKey) {
    return new Response(JSON.stringify({ ok: true, reset: ["store"] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  const userId = process.env.INTELLIGENCE_USER_ID ?? "jordan-beamson";
  try {
    const forgot = await forgetAllMemories({ apiUrl, apiKey, userId });
    return new Response(JSON.stringify({ ok: true, reset: ["store", "memory"], forgot }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        reset: ["store"],
        memoryError: err instanceof Error ? err.message : String(err),
      }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }
};
