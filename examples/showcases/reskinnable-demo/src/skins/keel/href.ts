"use client";

import { useSkinHref, useSkinSegments } from "@/shell/skin-path";

/**
 * Keel's id — must equal `skin.id`, the route segment and the agent id.
 * Declared once here because keel is the only skin with parameterized routes,
 * so its id used to appear in eleven separate `/keel/...` string literals
 * across pages, components and tools.
 */
const KEEL_ID = "keel";

/**
 * Keel's link builder: `keelHref("runs/r-1")` → `/keel/runs/r-1` on the normal
 * multi-skin demo, `/runs/r-1` on a `LOCK_SKIN=keel` deploy.
 *
 * Every in-skin link and `router.push` MUST go through this. A hardcoded
 * `/keel/...` would put the tenant segment back in the address bar on a locked
 * deploy the moment it is followed — see `src/shell/skin-path.ts` and
 * `src/proxy.ts` for the two halves of that contract.
 *
 * Deep links append their own hash: `` `${keelHref(`knowledge/${docId}`)}#${id}` ``.
 */
export function useKeelHref(): (path?: string) => string {
  return useSkinHref(KEEL_ID);
}

/** The URL segments below `/keel` — `[]` on the Desk, `["runs", "r-1"]` etc. */
export function useKeelSegments(): string[] {
  return useSkinSegments(KEEL_ID);
}
