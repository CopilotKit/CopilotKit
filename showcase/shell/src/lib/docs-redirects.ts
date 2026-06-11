// Docs-host redirect resolution — shared by middleware.
//
// These 301s used to live in next.config.ts `redirects()`, which bakes
// the destination host into the build artifact (`DOCS_HOST` was a
// hardcoded const) — so a staging shell 301'd docs routes to the PROD
// docs host (cross-origin RSC prefetch → CORS). The table now resolves
// per-request in middleware against the runtime `docsHost` from
// RuntimeConfig (env var DOCS_HOST, default = the prod host).
//
// Route semantics are copied 1:1 from the removed next.config rules:
//   /docs            -> <docsHost>            (prefix STRIPPED — the
//   /docs/:path*     -> <docsHost>/:path*      docs shell serves at root)
//   /ag-ui[/:path*]  -> <docsHost>/ag-ui[/:path*]      (prefix kept)
//   /reference[/:path*] -> <docsHost>/reference[/:path*] (prefix kept)
//   /<slug>[/:path*] -> <docsHost>/<slug>[/:path*]  for every registry
//     framework slug — enumerated (not a wildcard) so shell-owned
//     routes like /integrations and /matrix are never hijacked.
//
// Pure function, Edge-safe (no next/* imports).

/** Prefixes forwarded with the prefix KEPT on the destination path. */
const KEPT_PREFIXES = ["/ag-ui", "/reference"] as const;

/**
 * Returns the absolute destination URL (without query string) when
 * `pathname` belongs to the docs shell, or `null` when the path is
 * shell-owned and must fall through to normal handling.
 */
export function resolveDocsHostRedirect(
  pathname: string,
  docsHost: string,
  frameworkSlugs: ReadonlySet<string>,
): string | null {
  // /docs → docs-host root; /docs/x → docs-host /x (prefix stripped).
  if (pathname === "/docs") return docsHost;
  if (pathname.startsWith("/docs/")) {
    return `${docsHost}${pathname.slice("/docs".length)}`;
  }

  // /ag-ui and /reference keep their prefix on the docs host.
  for (const prefix of KEPT_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return `${docsHost}${pathname}`;
    }
  }

  // Framework-scoped routes: /<slug> and /<slug>/... — first segment
  // must exactly match a registry slug.
  const first = pathname.split("/").filter(Boolean)[0];
  if (first && frameworkSlugs.has(first)) {
    return `${docsHost}${pathname}`;
  }

  return null;
}
