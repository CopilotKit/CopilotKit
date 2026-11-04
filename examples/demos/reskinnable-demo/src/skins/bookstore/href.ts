"use client";

import { useSkinHref, useSkinSegments } from "@/shell/skin-path";

/**
 * Bookstore's id — must equal `skin.id`, the route segment and the agent id.
 * Declared once here so it never needs to be repeated as a `/bookstore/...`
 * string literal across pages, components and tools.
 */
const BOOKSTORE_ID = "bookstore";

/**
 * Bookstore's link builder: `bookstoreHref("orders")` → `/bookstore/orders` on
 * the normal multi-skin demo, `/orders` on a `LOCK_SKIN=bookstore` deploy.
 *
 * Every in-skin link and `router.push` MUST go through this. A hardcoded
 * `/bookstore/...` would put the tenant segment back in the address bar on a
 * locked deploy the moment it is followed, and `pnpm lint` fails on it via a
 * `no-restricted-syntax` guard — see `src/shell/skin-path.ts` and
 * `src/proxy.ts` for the two halves of that contract.
 */
export function useBookstoreHref(): (path?: string) => string {
  return useSkinHref(BOOKSTORE_ID);
}

/** The URL segments below `/bookstore`. */
export function useBookstoreSegments(): string[] {
  return useSkinSegments(BOOKSTORE_ID);
}
