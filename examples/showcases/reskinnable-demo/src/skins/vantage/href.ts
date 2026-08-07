"use client";

import { useSkinHref, useSkinSegments } from "@/shell/skin-path";

/**
 * Vantage's id — must equal `skin.id`, the route segment and the agent id.
 * Declared once here because vantage's id used to appear in a dozen separate
 * `/vantage/...` string literals across pages, gen-UI components and tools —
 * the same shape that made keel worth its own helper. Several of those sites
 * (`components/gen-ui/board-card.tsx`, `pages/boards.tsx`) have no `skin`
 * object in scope, so an inline `useSkinHref(skin.id)` would have meant
 * dragging `useSkin()` into a leaf card purely to spell the id.
 */
const VANTAGE_ID = "vantage";

/**
 * Vantage's link builder: `vantageHref("boards/q2")` → `/vantage/boards/q2` on
 * the normal multi-skin demo, `/boards/q2` on a `LOCK_SKIN=vantage` deploy.
 *
 * Every in-skin link, `router.push` and `location.assign` MUST go through this.
 * A hardcoded `/vantage/...` would put the tenant segment back in the address
 * bar on a locked deploy the moment it is followed — see `src/shell/skin-path.ts`
 * and `src/proxy.ts` for the two halves of that contract.
 *
 * It is also what the AGENT should be told: `buildBoard`'s prompt and its return
 * string quote a board's URL, and a locked deploy must not have the model read
 * a 404 path out loud.
 *
 * Query strings append their own suffix:
 * `` `${vantageHref("explore")}?${qs}` ``.
 */
export function useVantageHref(): (path?: string) => string {
  return useSkinHref(VANTAGE_ID);
}

/** The URL segments below `/vantage` — `[]` on the Boardroom, `["boards", "q2"]` etc. */
export function useVantageSegments(): string[] {
  return useSkinSegments(VANTAGE_ID);
}
