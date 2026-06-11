// Docs-host redirect resolution — shared by middleware.
//
// These permanent (308) redirects used to live in next.config.ts
// `redirects()` (`permanent: true` emits 308), which bakes
// the destination host into the build artifact (`DOCS_HOST` was a
// hardcoded const) — so a staging shell 308'd docs routes to the PROD
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
 * Normalize a destination path: collapse runs of slashes and strip a
 * trailing slash (root "/" survives). Collapsing the LEADING run is
 * defense-in-depth plus cosmetics: at every call site the path is
 * appended AFTER a fixed `https://<docs-host>` origin, so a leading
 * `//` can never be parsed as a scheme-relative URL — it would only
 * produce an ugly double-slash path on a host we own.
 */
export function normalizeRedirectPath(path: string): string {
  let normalized = path.replace(/\/{2,}/g, "/");
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

/**
 * Defensive docs-host normalization: strip trailing slashes and ensure
 * a scheme so `new URL(...)` consumers never throw or emit
 * scheme-relative URLs if the runtime config hands us a bare host.
 */
function normalizeDocsHostOrigin(docsHost: string): string {
  const trimmed = docsHost.replace(/\/+$/, "");
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
}

/**
 * Resolve an SEO-table destination path (which targets the DOCS routing
 * surface) to an absolute URL on the docs host.
 */
export function resolveSeoDestination(
  destinationPath: string,
  docsHost: string,
): URL {
  const origin = normalizeDocsHostOrigin(docsHost);
  return new URL(`${origin}${normalizeRedirectPath(destinationPath)}`);
}

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
  const origin = normalizeDocsHostOrigin(docsHost);

  // /docs → docs-host root; /docs/x → docs-host /x (prefix stripped).
  if (pathname === "/docs") return origin;
  if (pathname.startsWith("/docs/")) {
    const rest = normalizeRedirectPath(pathname.slice("/docs".length));
    return rest === "/" ? origin : `${origin}${rest}`;
  }

  // /ag-ui and /reference keep their prefix on the docs host.
  for (const prefix of KEPT_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return `${origin}${normalizeRedirectPath(pathname)}`;
    }
  }

  // Framework-scoped routes: /<slug> and /<slug>/... — first segment
  // must exactly match a registry slug.
  const first = pathname.split("/").filter(Boolean)[0];
  if (first && frameworkSlugs.has(first)) {
    return `${origin}${normalizeRedirectPath(pathname)}`;
  }

  return null;
}
