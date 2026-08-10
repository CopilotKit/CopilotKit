/**
 * Resolve a stable end-user identity for Intelligence requests in the bookstore
 * skin. This is what scopes durable memory PER SHOPPER — the mechanism behind the
 * demo's first claim, that the same pill answers differently for Maya and for
 * Guest.
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
 *    properties (providers.tsx); `userId` is the shopper id, scoped 1:1 onto
 *    `bookstore-<id>` so two shoppers never share a memory bucket.
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

/** The fallback scope, used when no known shopper is forwarded. */
export const DEMO_DEFAULT_USER_ID = "bookstore-demo-shopper";

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
