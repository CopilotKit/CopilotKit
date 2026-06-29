import * as store from "@/lib/store";

/**
 * Dev-only: restore the in-memory demo store to its seed snapshot.
 *
 * Re-running the over-limit teach demo mutates state — approving the charge and
 * filing the policy exception flip it from `overLimit` → `cleared`. This brings
 * the seed transactions (e.g. the $5,000 Google Ads / Marketing charge) back to
 * pending/over-limit without restarting the dev server.
 *
 *   curl -s -X POST http://localhost:3000/api/v1/dev/reset
 *
 * Disabled when NODE_ENV === "production" so it can never reset a deployed demo.
 * NOTE: this resets the app's transaction store only — it does NOT touch durable
 * memory. To replay the full fail→teach→succeed arc, also forget the saved
 * procedure (DELETE /api/memories/:id on the Intelligence backend).
 */
export const POST = async () => {
  if (process.env.NODE_ENV === "production") {
    return new Response(JSON.stringify({ error: "disabled in production" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }
  store.reset();
  return new Response(JSON.stringify({ ok: true, reset: "store" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
