/**
 * URL composition for the bookstore skin's agent-driven navigations, factored
 * out so it can be unit-tested without rendering the whole tools tree.
 *
 * Both builders route the path THROUGH the skin's `useSkinHref` builder rather
 * than concatenating onto its no-arg result. This is load-bearing under
 * LOCK_SKIN: there the no-arg base is `"/"` — NOT `""` (see `skin-path.ts`;
 * `""` is not a usable href) — so `` `${base}/book/x` `` would emit the
 * protocol-relative `//book/x`, which the browser navigates to as
 * `https://book/x` (off-site). `skinHref("book/x")` yields `/book/x` locked
 * and `/bookstore/book/x` unlocked, with no `//` in either case.
 */
export type SkinHref = (path?: string) => string;

/**
 * Path segment (relative, no leading slash) for a single book's detail page,
 * fed to a `SkinHref` builder rather than joined onto its output directly.
 */
export function bookPath(slug: string): string {
  return `book/${encodeURIComponent(slug)}`;
}

/**
 * Target for the browse/catalog view, optionally with an already-built query
 * string (genre/sort/filters). The `?` join is applied to the built href, so
 * the query behaviour is preserved while the path stays lock-safe.
 */
export function browseTarget(skinHref: SkinHref, qs: string): string {
  const href = skinHref();
  return qs ? `${href}?${qs}` : href;
}
