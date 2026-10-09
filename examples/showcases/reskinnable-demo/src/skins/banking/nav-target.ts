/**
 * URL composition for the banking skin's agent-driven navigations, factored out
 * of `tools.tsx` so it can be unit-tested without rendering the whole tools tree
 * (which needs the full CopilotKit + auth + recording provider stack).
 *
 * Both builders route the path THROUGH the skin's `useSkinHref` builder rather
 * than concatenating onto its no-arg result. This is load-bearing under
 * LOCK_SKIN: there the no-arg base is `"/"` — NOT `""` (see `skin-path.ts`;
 * `""` is not a usable href) — so `` `${base}/charges` `` would emit the
 * protocol-relative `//charges`, which the browser navigates to as
 * `https://charges/` (off-site). `skinHref("charges")` yields `/charges` locked
 * and `/banking/charges` unlocked, with no `//` in either case.
 */
export type SkinHref = (path?: string) => string;

/**
 * Target for `navigateToPageAndPerform`, whose `page` enum is `"/"`, `"/cards"`
 * or `"/team"`. `/` and the `/cards` alias both land on the skin INDEX (the card
 * tools/operations are registered there); any other page maps to its own segment
 * below the skin base.
 */
export function navTarget(skinHref: SkinHref, page: string): string {
  return page === "/" || page === "/cards"
    ? skinHref()
    : skinHref(page.toLowerCase());
}

/**
 * Target for `showCharges`: the Charges page, optionally with an
 * already-built query string (sort/top/filters). The `?` join is applied to the
 * built href, so the query behaviour is preserved while the path stays lock-safe.
 */
export function chargesTarget(skinHref: SkinHref, qs: string): string {
  const href = skinHref("charges");
  return qs ? `${href}?${qs}` : href;
}
