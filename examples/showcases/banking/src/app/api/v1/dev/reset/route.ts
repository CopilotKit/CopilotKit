import * as store from "@/lib/store";
import { forgetAllMemories } from "@/lib/intelligence/forget-memories";
import { presenterResetEnabled } from "@/lib/presenter";
import { SEEDED_USER_IDS } from "@/lib/intelligence/user-id";

/**
 * Presenter/booth reset: restore the demo to a fresh "teachable" state.
 * Gated by PRESENTER_RESET_ENABLED (same flag the sidebar button checks), so a
 * publicly-hosted deployment is safe-off by default.
 * 1. Re-seed the in-memory transaction store (over-limit charges back to pending).
 * 2. If Intelligence is configured, forget durable memory for EVERY seeded
 *    persona (a bare list enumerates user + project scope, so the first persona
 *    also clears project-scoped rows; the rest clear their own user scope).
 */
export const POST = async () => {
  if (!presenterResetEnabled()) {
    return new Response(JSON.stringify({ error: "presenter reset disabled" }), {
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

  // Declared outside the try so the catch can report partial progress: a
  // mid-loop failure can leave the store reset AND some personas already
  // forgotten, so the error body must not read as "memory untouched".
  let forgot = 0;
  try {
    for (const userId of SEEDED_USER_IDS) {
      forgot += await forgetAllMemories({ apiUrl, apiKey, userId });
    }
    return new Response(
      JSON.stringify({ ok: true, reset: ["store", "memory"], forgot }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        reset: forgot > 0 ? ["store", "memory"] : ["store"],
        forgot,
        memoryError: err instanceof Error ? err.message : String(err),
      }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }
};
