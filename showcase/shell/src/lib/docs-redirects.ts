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
// Pure functions, Edge-safe (no next/* imports — backend-url is also
// next-free; middleware already runs it on the Edge).

import { SCHEME_RE } from "./backend-url";

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
 * a scheme. For VALIDATED hosts (everything runtime-config hands
 * middleware) the `new URL(...)` consumers never throw or emit
 * scheme-relative URLs even when the value is a bare host. An
 * empty-post-trim host THROWS instead (SU5-A6): "" would normalize to
 * the origin "https://", and `new URL("https:///faq")` triggers WHATWG
 * slash-skipping — the destination PATH gets parsed as the authority,
 * silently redirecting to https://faq/. Unreachable through
 * runtime-config-validated callers; fail loud for any future raw one.
 */
function normalizeDocsHostOrigin(docsHost: string): string {
  const trimmed = docsHost.replace(/\/+$/, "");
  if (trimmed === "") {
    throw new Error(
      `[docs-redirects] docs host is empty after trimming (${JSON.stringify(
        docsHost,
      )}) — refusing to compose a redirect origin: "https://" + a path ` +
        "would let WHATWG slash-skipping parse the destination path as " +
        "the redirect host.",
    );
  }
  // SCHEME_RE is the shared scheme detector from backend-url (SU4-A6) —
  // the same test middleware's normalizePosthogHost uses; an inline
  // copy here had already drifted into a maintenance trap.
  return SCHEME_RE.test(trimmed) ? trimmed : `https://${trimmed}`;
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
 *
 * Leading-slash runs are collapsed in ONE place — middleware()
 * (SU4-A3) — so `pathname` arrives with a single leading "/". The
 * framework-slug branch's /^\/+/ regex below still tolerates runs as
 * defense-in-depth for other callers, but the ===/startsWith prefix
 * branches deliberately do NOT re-normalize.
 */
export function resolveDocsHostRedirect(
  pathname: string,
  docsHost: string,
  frameworkSlugs: ReadonlySet<string>,
): string | null {
  const origin = normalizeDocsHostOrigin(docsHost);

  // Case-insensitive matching (SU3-A4): parity with the removed
  // next.config rules (path-to-regexp sensitive:false). Prefixes and
  // slugs match in any case; the destination uses the canonical
  // lowercase prefix/slug literal while the matched remainder keeps the
  // ORIGINAL case (exactly what a path-to-regexp :path* param did).
  // toLowerCase() is length-preserving on the ASCII pathnames Next
  // hands us, so positional slicing against `pathname` is safe.
  const lower = pathname.toLowerCase();

  // /docs → docs-host root; /docs/x → docs-host /x (prefix stripped).
  if (lower === "/docs") return origin;
  if (lower.startsWith("/docs/")) {
    const rest = normalizeRedirectPath(pathname.slice("/docs".length));
    return rest === "/" ? origin : `${origin}${rest}`;
  }

  // /ag-ui and /reference keep their prefix on the docs host.
  for (const prefix of KEPT_PREFIXES) {
    if (lower === prefix || lower.startsWith(`${prefix}/`)) {
      return `${origin}${normalizeRedirectPath(prefix + pathname.slice(prefix.length))}`;
    }
  }

  // Framework-scoped routes: /<slug> and /<slug>/... — first segment
  // must exactly match a registry slug (registry slugs are canonical
  // lowercase). Match on the lowercased segment; forward the lowercase
  // slug + original-case remainder.
  const segmentMatch = /^\/+([^/]+)/.exec(lower);
  const first = segmentMatch?.[1];
  if (first && frameworkSlugs.has(first)) {
    const rest = pathname.slice(segmentMatch[0].length);
    return `${origin}${normalizeRedirectPath(`/${first}${rest}`)}`;
  }

  return null;
}
