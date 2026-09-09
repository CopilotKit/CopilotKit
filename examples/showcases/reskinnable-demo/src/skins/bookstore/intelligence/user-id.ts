/**
 * Resolve a stable end-user identity for Intelligence requests in the bookstore
 * skin — the scope Intelligence stores durable memory under, and the reason the
 * beat-4 preference is recalled at all.
 *
 * SERVER-SAFE: no "use client", no JSX, no .tsx imports. It is reached through
 * the server-only agent registry, so it must never pull client code server-side.
 * `IdentifyRunUser` is imported as a TYPE (erased at compile time), so the
 * registry module's runtime graph is not dragged in.
 *
 * The shopper ids are duplicated here rather than imported from providers.tsx,
 * which is a client module. A three-line duplication is the right price for
 * keeping the server graph clean; `user-id.test.ts` asserts the two lists stay
 * in step, so the duplication cannot rot silently.
 *
 * Precedence: pinned env > known shopper id > demo default.
 *  - Pinned `INTELLIGENCE_USER_ID` wins so CI stays deterministic on one identity.
 *  - Unpinned, the client forwards `{ userId, userRole }` via CopilotKit
 *    properties (providers.tsx); a `userId` this module recognises is scoped 1:1
 *    onto `bookstore-<id>`.
 *
 * ⚠ THAT 1:1 MAPPING IS NOT A DEMOABLE ISOLATION STORY. The client's
 * `properties` frequently do not reach `identifyUser` on a run, so BOTH shoppers
 * collapse into `DEMO_DEFAULT_USER_ID` and switching shopper in the sidebar
 * re-scopes NOTHING. That is app-wide, not bookstore's own defect: see the CAVEAT
 * block in `.env.example` and the flagged comments in
 * `src/shell/agent-registry.ts`, and see `bookstoreMemorySeedTargetUserIds`
 * below for what the presenter reset does about it.
 */

import type { IdentifyRunUser } from "@/shell/agent-registry";

/** Kept in step with SHOPPERS in providers.tsx by user-id.test.ts. */
export const SEEDED_SHOPPER_IDS: readonly string[] = Object.freeze([
  "maya",
  "guest",
]);

/**
 * A `Map`, not a plain object: `userId` is untrusted client-forwarded input, and
 * a plain-object lookup walks the prototype chain — so `"constructor"`,
 * `"toString"` and `"__proto__"` would all resolve truthy and spoof a shopper,
 * minting a memory scope that nothing ever resets. `Map.has`/`Map.get` only ever
 * see own entries, making that bad state unrepresentable.
 */
const SHOPPER_NAME: Map<string, string> = new Map([
  ["maya", "Maya Okonkwo"],
  ["guest", "Guest"],
]);

/**
 * The fallback scope, used when no known shopper is forwarded.
 *
 * Not an edge case: this is where a run's memory USUALLY lands, because the
 * client's `properties` frequently do not reach `identifyUser`. So a presenter
 * reset must both clear it AND re-seed it — see
 * `bookstoreMemorySeedTargetUserIds`.
 */
export const DEMO_DEFAULT_USER_ID = "bookstore-demo-shopper";

/**
 * The shopper whose taste preference the demo starts out already knowing —
 * `SHOPPERS[0]` in providers.tsx, the persona the demo opens as. Named once here
 * so the seed-target derivation below and the reset route cannot disagree about
 * who is seeded.
 */
export const SEEDED_MEMORY_SHOPPER_ID = "maya";

/**
 * The buckets the beat-4 preference is seeded into — the DEFAULT one AND Maya's
 * mapped scope, on purpose.
 *
 * Seeding only Maya's mapped scope is a beat that fails SILENTLY, and worse than
 * a degraded one: `recall_memory` looks at whichever scope the run resolved to,
 * runs frequently resolve to `DEMO_DEFAULT_USER_ID` (the client's `properties`
 * often do not reach `identifyUser`), and that bucket was seeded with nothing —
 * so the agent recalls not a generic answer but NO answer, while the preference
 * sits perfectly well stored one id over. Banking settled on seeding its default
 * bucket for this reason; people (`SEED_TARGET_USER_IDS`) and commerce
 * (`memorySeedTargetUserIds`) seed the default bucket alongside the mapped
 * operator's. This is the same shape.
 *
 * A FUNCTION, not a module constant: `resolveBookstoreUserId` reads
 * `INTELLIGENCE_USER_ID` at call time, and a constant evaluated at import would
 * answer for whatever the env held when the module first loaded.
 *
 * The `Set` is load-bearing, not tidiness: under a pinned `INTELLIGENCE_USER_ID`
 * both entries resolve to that one pinned bucket, and without the dedup the reset
 * would write every seed memory to it twice.
 *
 * ⚠ Guest is deliberately absent, and that is NOT a demoable contrast — see the
 * header caveat. Guest's bucket is left empty because there is no reason to write
 * to it, not because switching to Guest proves anything on stage.
 */
export function bookstoreMemorySeedTargetUserIds(): readonly string[] {
  return [
    ...new Set([
      // Nothing forwarded — the bucket recall actually looks at most of the time.
      resolveBookstoreUserId({}),
      // Maya's mapped scope, so the per-shopper story is already correct the day
      // the properties path is fixed.
      resolveBookstoreUserId({ userId: SEEDED_MEMORY_SHOPPER_ID }),
    ]),
  ];
}

export type BookstoreIdentityInput = { userId?: string; userRole?: string };

export function resolveBookstoreUserId({
  userId,
}: BookstoreIdentityInput = {}): string {
  const pinned = process.env.INTELLIGENCE_USER_ID;
  if (pinned) return pinned;
  if (userId && SHOPPER_NAME.has(userId)) return `bookstore-${userId}`;
  // Deliberately does NOT derive a scope from userRole: both shoppers share the
  // role "shopper", so a role-derived scope would merge their memories and
  // silently destroy the beat.
  return DEMO_DEFAULT_USER_ID;
}

export function resolveBookstoreUserName({
  userId,
}: BookstoreIdentityInput = {}): string {
  const pinnedId = process.env.INTELLIGENCE_USER_ID;
  if (pinnedId) return process.env.INTELLIGENCE_USER_NAME ?? pinnedId;
  const name = userId ? SHOPPER_NAME.get(userId) : undefined;
  return name ?? "Bookstore Shopper";
}

/**
 * The skin's `IdentifyRunUser` (server-side). Registered in
 * `src/shell/agent-registry.ts` under the skin id, this maps the
 * client-forwarded run properties onto a stable per-shopper memory scope WITHOUT
 * the API route importing anything from `src/skins/**`. The client half is
 * `BookstoreRuntimeProviders` + `useBookstoreRuntimeProperties` (providers.tsx).
 */
export const bookstoreIdentifyUser: IdentifyRunUser = (properties) => {
  const input: BookstoreIdentityInput = {
    userId: properties?.userId,
    userRole: properties?.userRole,
  };
  return {
    id: resolveBookstoreUserId(input),
    name: resolveBookstoreUserName(input),
  };
};
