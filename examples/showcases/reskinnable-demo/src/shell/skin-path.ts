"use client";

import { useCallback } from "react";
import { usePathname } from "next/navigation";
import { useLockedSkin } from "@/shell/locked-skin-context";

/**
 * URL construction for links INSIDE a skin, honouring the single-tenant lock.
 *
 * Unlocked, every skin owns a URL segment and links carry it:
 * `skinHref("cards")` → `/banking/cards`. Under LOCK_SKIN the deploy IS the
 * product, so the segment leaves the URL space entirely and the same call
 * returns `/cards`.
 *
 * This is the CLIENT half of a two-part contract. `src/proxy.ts` is the server
 * half: it maps the prefix-free space back onto the `/[skin]` route tree that
 * actually exists on disk. The two must agree — a link that keeps the prefix
 * would put `/banking` back in the address bar on the first nav click, which is
 * the whole defect this replaced.
 *
 * Returns `/` — never `""` — for the skin index under a lock, since the empty
 * string is not a usable href.
 *
 * Without a `LockedSkinProvider` above it the context defaults to unlocked, so
 * a component rendered bare in a unit test produces today's prefixed hrefs.
 *
 * The returned builder is memoized on the base, so it is stable across renders
 * and safe to list in a `useCallback`/`useEffect` dependency array — keel's
 * `openCitation` does exactly that.
 */
export function useSkinHref(skinId: string): (path?: string) => string {
  const locked = useLockedSkin();
  const base = locked ? "" : `/${skinId}`;
  return useCallback(
    (path = "") => {
      const suffix = path.replace(/^\/+/, "");
      return (suffix ? `${base}/${suffix}` : base) || "/";
    },
    [base],
  );
}

/**
 * The URL segments BELOW the active skin — `[]` on the skin index,
 * `["runs", "r-1"]` on the run detail page. Skin layouts use this to decide
 * which nav entry is active.
 *
 * Strips a LEADING SKIN ID rather than slicing a fixed number of segments, and
 * that distinction is load-bearing. Under a lock the address bar shows a
 * prefix-free path while the matched route still carries the segment, and
 * `usePathname()` is not guaranteed to report the same one of those two across
 * SSR and post-hydration. Stripping the id when present is correct for BOTH
 * spellings, so this never has to care which it was handed — where the previous
 * `pathname.split("/").slice(2)` silently ate the first real segment whenever
 * the prefix was absent.
 *
 * A skin whose own sub-route is named after the skin (`/banking/banking`) would
 * confuse this, but no skin declares one — and under a lock that exact path is
 * how a stale prefixed bookmark arrives, where a 404 is the intended answer.
 */
export function useSkinSegments(skinId: string): string[] {
  const pathname = usePathname();
  const parts = pathname.split("/").filter(Boolean);
  return parts[0] === skinId ? parts.slice(1) : parts;
}
