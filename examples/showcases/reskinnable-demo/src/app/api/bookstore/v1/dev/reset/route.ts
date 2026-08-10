import { presenterResetEnabled } from "@/lib/presenter";
import { forgetAllMemories } from "@/skins/bookstore/intelligence/forget-memories";
import { seedMemories } from "@/skins/bookstore/intelligence/seed-memories";
import {
  DEMO_DEFAULT_USER_ID,
  resolveBookstoreUserId,
  SEEDED_SHOPPER_IDS,
} from "@/skins/bookstore/intelligence/user-id";

/**
 * Presenter/booth-only demo reset.
 *
 * This skin has NO server-side store: the catalog is static seed data, and the
 * cart lives in the browser's `localStorage`, which the client clears itself
 * before navigating (see layout.tsx). That is why — unlike every other skin's
 * reset route, which owns a `store.reset()` — this route touches memory ONLY.
 *
 * Allowed when a booth deployment set PRESENTER_RESET_ENABLED, OR in any
 * non-production environment. Keeping this in agreement with the sidebar
 * button matters: gate it more tightly than the button and a production booth
 * shows a Reset control that 403s.
 */
export const POST = async (request: Request) => {
  if (!presenterResetEnabled() && process.env.NODE_ENV === "production") {
    return Response.json(
      { error: "FORBIDDEN", message: "Not available in production." },
      { status: 403 },
    );
  }

  // The body is optional: a bodyless curl must still work, because a
  // presenter debugging on stage should not have to get the payload right.
  // Fall through to the default scope on any parse failure (no body, empty
  // body, malformed JSON).
  let shopperId: string | undefined;
  try {
    const body = (await request.json()) as { shopperId?: unknown };
    if (typeof body?.shopperId === "string") shopperId = body.shopperId;
  } catch {
    shopperId = undefined;
  }

  const apiUrl = process.env.INTELLIGENCE_API_URL;
  const apiKey = process.env.INTELLIGENCE_API_KEY;
  if (!apiUrl || !apiKey) {
    // OSS path: there is no durable memory to clear, and that is NOT an
    // error — the client still clears the cart and reloads.
    return Response.json({ ok: true, reset: [], memory: "not configured" });
  }

  // Declared outside the try so the catch can report PARTIAL progress: a
  // mid-loop failure can leave some shoppers already cleared, and the error
  // body must not read as "memory untouched".
  let forgot = 0;
  let seeded = 0;
  // Project-scoped rows the forget helper deliberately left alone — they
  // belong to sibling skins sharing this backend (banking seeds a
  // project-scoped stored-procedure memory), not to bookstore. Every call
  // below sees the SAME global project rows, so this is tracked with the
  // largest value seen rather than summed — summing would overcount the
  // identical rows once per shopper. A non-zero value after a bookstore-only
  // session means something saved project-scoped despite the prompt. See
  // intelligence/forget-memories.ts.
  let skippedProjectScoped = 0;

  // SEEDED_SHOPPER_IDS holds RAW shopper ids ("maya", "guest"), not resolved
  // memory scopes — unlike banking's/people's identically-named
  // SEEDED_USER_IDS, which already hold resolved scopes. Each raw id must be
  // mapped through resolveBookstoreUserId to get the actual scope
  // ("bookstore-maya", "bookstore-guest") before touching the backend; a copy
  // of the raw ids would try to clear scopes nothing ever writes to and the
  // reset would silently no-op while reporting success.
  //
  // Wrapped in a Set: under a pinned INTELLIGENCE_USER_ID, resolveBookstoreUserId
  // returns that SAME pinned value for every input, collapsing the resolved
  // list to duplicates. Without the Set the loop below would repeatedly clear
  // the one pinned scope instead of once.
  const userIds = new Set<string>([
    ...SEEDED_SHOPPER_IDS.map((id) => resolveBookstoreUserId({ userId: id })),
    DEMO_DEFAULT_USER_ID,
  ]);
  // Name the backend and the exact ids BEFORE mutating, so a human can see in
  // the logs which stack this reset reached.
  console.warn(
    `[bookstore] presenter reset: forgetting memories at ${apiUrl} for ${[...userIds].join(", ")}`,
  );

  try {
    for (const userId of userIds) {
      const result = await forgetAllMemories({ apiUrl, apiKey, userId });
      forgot += result.forgot;
      skippedProjectScoped = Math.max(
        skippedProjectScoped,
        result.skippedProjectScoped,
      );
    }
    // Re-seed Maya only. Guest starts with nothing BY DESIGN — the contrast
    // between them is the entire memory beat.
    seeded += await seedMemories({
      apiUrl,
      apiKey,
      userId: resolveBookstoreUserId({ userId: "maya" }),
    });
    return Response.json({
      ok: true,
      reset: ["memory"],
      apiUrl,
      requestedShopper: shopperId ?? null,
      forgot,
      seeded,
      skippedProjectScoped,
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        reset: forgot > 0 ? ["memory"] : [],
        apiUrl,
        forgot,
        seeded,
        memoryError: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
};
