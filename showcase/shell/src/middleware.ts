import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import { seoRedirects } from "@/lib/seo-redirects";
import type { RedirectEntry } from "@/lib/seo-redirects";
import {
  DOCS_REDIRECTS_DISABLED_HOST,
  getRuntimeConfigForMiddleware,
} from "@/lib/runtime-config";
import { SCHEME_RE } from "@/lib/backend-url";
import {
  normalizeRedirectPath,
  resolveDocsHostRedirect,
  resolveSeoDestination,
} from "@/lib/docs-redirects";
import registry from "@/data/registry.json";

// ---------------------------------------------------------------------------
// Build lookup structures at module load (once per cold start)
// ---------------------------------------------------------------------------

/**
 * Known deliberate-collapse wildcard entries (SU6-A2, exported for
 * tests): their destinations carry NO ":path*" token ON PURPOSE — every
 * matched subpath collapses onto a single page (P10: all of
 * /reference/v1/* onto the v2 reference root; S13w×<fw>: each
 * framework's removed concepts/* section onto the framework root). The
 * tokenless-destination warn in buildRedirectLookup would otherwise
 * fire for them on every cold start, desensitizing the table-bug
 * channel exactly like the duplicate twins did before the SU5-A3
 * same-destination allowlist.
 */
export const DELIBERATE_COLLAPSE_WILDCARD_IDS = /^(?:P10$|S13w×)/;

// Printable-ASCII gate for sources and destinations (SU7-F3): request
// pathnames are percent-encoded ASCII, so an entry containing a raw
// space or any non-ASCII character can never match — a silent dead
// entry. It also enforces the length-preservation assumption every
// positional-slicing comment in this module relies on: toLowerCase is
// only guaranteed length-preserving for ASCII.
const PRINTABLE_ASCII_RE = /^[\x21-\x7e]+$/;

/**
 * Build the exact-match map and wildcard list from the redirect table
 * (exported for tests). The table is documented as "first match wins" —
 * a plain Map.set loop silently inverted that to LAST-write-wins for
 * the duplicate exact sources (e.g. P2×unselected overrode
 * SR-root×unselected), skewing PostHog redirect_id attribution. Skip
 * later duplicates and warn once at module load, naming them — EXCEPT
 * same-destination duplicates (SU5-A3): the table's deliberate
 * SR-root×/P2× and SR-wild×/P1× twins redirect to the same place, so
 * they skip silently and only unexpected duplicates warn.
 *
 * PRECEDENCE (deliberate, SU4-A2): an EXACT source always beats a
 * WILDCARD source, regardless of table order — middleware tries the
 * exact map before the wildcard scan. "First match wins" therefore only
 * holds WITHIN each kind (among exacts for duplicate keys; among
 * wildcards for the linear scan). An exact source that falls under an
 * earlier wildcard prefix with a DIFFERENT destination contradicts a
 * naive top-to-bottom reading of the table, so it gets a module-load
 * warn below.
 */
export function buildRedirectLookup(entries: readonly RedirectEntry[]): {
  /** Exact-match map: source path -> { id, destination } */
  exactMap: Map<string, { id: string; destination: string }>;
  /** Wildcard entries: source has :path* -- stored as { prefix, id, destination } */
  wildcardEntries: {
    prefix: string;
    id: string;
    destinationTemplate: string;
  }[];
} {
  const exactMap = new Map<string, { id: string; destination: string }>();
  const wildcardEntries: {
    prefix: string;
    id: string;
    destinationTemplate: string;
  }[] = [];
  // First-claimed wildcard prefix -> claiming entry (id + destination
  // template). Matching is by prefix, so two entries with the same
  // prefix shadow exactly like duplicate exact sources do (the linear
  // scan would never reach the second) — dedup with the same
  // first-match-wins + module-load warn, or the shadowed ids show zero
  // PostHog traffic and the decommission report proposes deleting a
  // live redirect. The destination template is kept for the
  // same-destination twin allowlist (SU5-A3) below.
  const wildcardPrefixOwners = new Map<
    string,
    { id: string; destinationTemplate: string }
  >();
  const duplicateSources: string[] = [];
  const duplicateWildcardSources: string[] = [];
  const malformedWildcards: string[] = [];
  const invalidSources: string[] = [];
  const invalidDestinations: string[] = [];
  const rootExactSources: string[] = [];
  const nonAsciiEntries: string[] = [];
  const unreachableTrailingSlashSources: string[] = [];
  const exactDestinationsWithToken: string[] = [];
  const wildcardDestinationsWithMiscasedToken: string[] = [];
  const tokenlessWildcardDestinations: string[] = [];
  const shadowedWildcardPrefixes: string[] = [];
  const exactsUnderEarlierWildcard: string[] = [];

  // Destination comparisons (the same-destination twin allowlists and
  // the exact-under-wildcard divergence check below) run BOTH sides
  // through normalizeRedirectPath (docs-redirects): interior slash-run
  // collapse + trailing-slash strip, root "/" survives. That is EXACTLY
  // what resolveSeoDestination applies to each destination at request
  // time (SU5-A7: the normalization lives in normalizeRedirectPath;
  // resolveSeoDestination merely calls it) — a previous local copy
  // stripped trailing slashes only (half of the request-time
  // normalization), so two entries that resolve identically could
  // still be flagged as a different-destination duplicate or
  // divergence: a false-positive warn (SU6-A3).

  for (const entry of entries) {
    // Printable-ASCII gate FIRST (SU7-F3, see PRINTABLE_ASCII_RE): a
    // non-ASCII or whitespace-bearing source can never match a request
    // pathname (silent dead entry), and every later check slices by
    // position under the ASCII length-preservation assumption.
    if (
      !PRINTABLE_ASCII_RE.test(entry.source) ||
      !PRINTABLE_ASCII_RE.test(entry.destination)
    ) {
      nonAsciiEntries.push(
        `${entry.source} -> ${entry.destination} (${entry.id})`,
      );
      continue;
    }
    // Sources must be root-relative paths with no query/fragment
    // (SU4-A2): NextRequest pathnames always start with "/" and never
    // carry "?"/"#", so a source violating that can never match —
    // worse, a non-"/" wildcard source would produce a prefix the
    // matcher could partially collide with. Warn and skip.
    //
    // "//" anywhere in the source is rejected too (SU5-A2): middleware
    // collapses LEADING slash runs before any lookup, so a leading-"//"
    // source is an unreachable dead entry — and the wildcard source
    // "//:path*" sailed past every later check (prefix "//" ends with
    // "/", :path* terminates it, prefix !== "/") only for the matcher's
    // bareSource (prefix minus one slash) to come out as "/", matching
    // the HOMEPAGE: the exact hijack the root-wildcard guard rejects.
    // An INTERIOR "//" (e.g. "/a//b") is technically matchable (only
    // LEADING runs are collapsed; matchPath keeps interior runs) but no
    // live URL is authored that way — it is a presumed typo, rejected
    // under the same check (SU6-A4).
    if (
      !entry.source.startsWith("/") ||
      entry.source.includes("//") ||
      entry.source.includes("?") ||
      entry.source.includes("#")
    ) {
      invalidSources.push(`${entry.source} (${entry.id})`);
      continue;
    }
    // Destinations must be root-relative paths with no query/fragment:
    // an absolute URL gets appended after the docs-host origin and
    // mangled into a path ("https://<docsHost>https://..."); a "?"/"#"
    // suffix is silently wiped by the per-request
    // `dest.search = request.nextUrl.search` overwrite. Either way the
    // entry cannot do what its author intended — warn and skip.
    //
    // "//" in a destination is a presumed typo, same as in sources
    // above (SU6-A4): request-time normalizeRedirectPath WOULD collapse
    // the run — so it can never become a scheme-relative open redirect
    // (SU-18) — but the author plainly didn't mean to write it; reject
    // loudly instead of silently papering over it.
    if (
      !entry.destination.startsWith("/") ||
      entry.destination.includes("//") ||
      entry.destination.includes("?") ||
      entry.destination.includes("#")
    ) {
      invalidDestinations.push(
        `${entry.source} -> ${entry.destination} (${entry.id})`,
      );
      continue;
    }
    // Token detection is case-insensitive (SU5-A3): a typo like
    // ":PATH*" otherwise slips past indexOf and the source becomes a
    // silent dead EXACT entry (its key can never be a request path).
    // toLowerCase is length-preserving on these ASCII sources, so the
    // index is valid against the original-case string.
    const wildcardIdx = entry.source.toLowerCase().indexOf(":path*");
    if (wildcardIdx === -1) {
      // Keys are lowercased: matching is case-insensitive (parity with
      // the next.config rules' path-to-regexp sensitive:false — see
      // matchPath in middleware()). Also makes a source typo like MG3's
      // "/migration-guides/1.10.X" match the lowercase live URL.
      const key = entry.source.toLowerCase();
      // A root EXACT source ("/") would match the HOMEPAGE — the twin
      // of the root-wildcard guard in the wildcard branch below: it
      // passes every other source check (root-relative, no "//", no
      // ?/#, and the trailing-slash guard skips length-1 keys), yet is
      // never a legitimate SEO entry. Reject it loudly (SU7-F3).
      if (key === "/") {
        rootExactSources.push(`${entry.source} (${entry.id})`);
        continue;
      }
      // A trailing-slash exact source is UNREACHABLE (SU4-A2):
      // middleware strips trailing slashes from matchPath before the
      // lookup, so a key ending in "/" (other than root) can never be
      // queried. Warn and skip — the author meant the slashless form.
      if (key.length > 1 && key.endsWith("/")) {
        unreachableTrailingSlashSources.push(`${entry.source} (${entry.id})`);
        continue;
      }
      // An exact entry never substitutes — a ":path*" in its destination
      // would leak the literal token into the Location header (SU4-A2).
      // Case-insensitive (SU5-A3): a miscased ":PATH*" leaks just the
      // same.
      if (entry.destination.toLowerCase().includes(":path*")) {
        exactDestinationsWithToken.push(
          `${entry.source} -> ${entry.destination} (${entry.id})`,
        );
        continue;
      }
      const existing = exactMap.get(key);
      if (existing) {
        // Same-destination twin allowlist (SU5-A3): the table carries
        // DELIBERATE duplicate pairs (the six SR-root×/P2× exacts and
        // six SR-wild×/P1× wildcards) whose destinations are identical
        // — warning on them at every cold start desensitized the
        // table-bug channel. A duplicate that redirects to the SAME
        // place is harmless (first id keeps the PostHog attribution):
        // skip silently; only UNEXPECTED (different-destination)
        // duplicates warn. "Same destination" means same AFTER the
        // request-time normalization — see the comparator note above
        // the loop (SU6-A3).
        if (
          normalizeRedirectPath(existing.destination) !==
          normalizeRedirectPath(entry.destination)
        ) {
          duplicateSources.push(
            `${entry.source} (${entry.id} shadowed by ${existing.id})`,
          );
        }
        continue;
      }
      // Exact-beats-wildcard precedence check (SU4-A2, see docstring):
      // when this exact source falls under a wildcard prefix that
      // appears EARLIER in the table, a top-to-bottom reading says the
      // wildcard wins — but the exact map is consulted first, so this
      // entry does. Only warn when the two would produce DIFFERENT
      // destinations (same-destination overlap is harmless, e.g. each
      // S13e×<fw> exact under its own S13w×<fw> wildcard).
      const coveringWildcard = wildcardEntries.find(
        (wc) => key.startsWith(wc.prefix) || key === wc.prefix.slice(0, -1),
      );
      if (coveringWildcard) {
        // Slice the remainder from the ORIGINAL-case source (SU5-A3),
        // not the lowercased key — that is what middleware does at
        // request time (the rest forwards verbatim from strippedPath),
        // so an exact destination that preserves the source's case is
        // NOT a divergence, and the diagnostic prints a
        // wildcardDestination the author actually recognizes. Offsets
        // align because toLowerCase is length-preserving here.
        const rest =
          key === coveringWildcard.prefix.slice(0, -1)
            ? ""
            : entry.source.slice(coveringWildcard.prefix.length);
        const wildcardDestination = substituteWildcardTemplate(
          coveringWildcard.destinationTemplate,
          rest,
        );
        if (
          normalizeRedirectPath(wildcardDestination) !==
          normalizeRedirectPath(entry.destination)
        ) {
          exactsUnderEarlierWildcard.push(
            `${entry.source} (${entry.id} wins over earlier wildcard ` +
              `${coveringWildcard.id}: ${entry.destination} vs ` +
              `${wildcardDestination})`,
          );
        }
      }
      exactMap.set(key, {
        id: entry.id,
        destination: entry.destination,
      });
    } else {
      // Lowercased for case-insensitive prefix matching — see above.
      const prefix = entry.source.slice(0, wildcardIdx).toLowerCase();
      // A wildcard prefix MUST end with "/" — the matcher's
      // `startsWith(prefix)` would otherwise match prefix LOOKALIKES
      // (e.g. a source "/x:path*" matching "/xylophone"). And :path*
      // must TERMINATE the source: the lookup keeps only the prefix, so
      // segments after the token (e.g. "/x/:path*/y") would silently
      // over-match every /x/* path. Treat both as table bugs: warn
      // loudly and skip the entry.
      if (
        !prefix.endsWith("/") ||
        wildcardIdx + ":path*".length !== entry.source.length
      ) {
        malformedWildcards.push(`${entry.source} (${entry.id})`);
        continue;
      }
      // A root wildcard ("/:path*", prefix "/") would match EVERY path
      // on the site — that is never a legitimate SEO entry; reject it
      // before it can hijack all traffic.
      if (prefix === "/") {
        malformedWildcards.push(
          `${entry.source} (${entry.id}: root wildcard would match every path)`,
        );
        continue;
      }
      // Duplicate-prefix owner check FIRST (SU7-F3): a later entry for
      // an already-claimed prefix is DISCARDED whatever its destination
      // looks like, so it must classify as a duplicate — running the
      // miscased/tokenless destination checks below on it would fire
      // table-bug warns for an entry that never ships (a harmless
      // same-destination tokenless twin stayed loud, desensitizing the
      // channel exactly like the duplicate twins before SU5-A3).
      const owner = wildcardPrefixOwners.get(prefix);
      if (owner) {
        // Same-destination twin allowlist — see the exact-map branch
        // above (SU5-A3); same request-time-normalized comparison
        // (SU6-A3).
        if (
          normalizeRedirectPath(owner.destinationTemplate) !==
          normalizeRedirectPath(entry.destination)
        ) {
          duplicateWildcardSources.push(
            `${entry.source} (${entry.id} shadowed by ${owner.id})`,
          );
        }
        continue;
      }
      // Substitution is CASE-SENSITIVE — substituteWildcardTemplate
      // replaces the literal lowercase ":path*" only — so a miscased
      // token in a WILDCARD destination (":PATH*") never substitutes
      // and leaks verbatim into the Location header: the same leak
      // class the exact-branch literal-token check above rejects.
      // Mirror its case-insensitive detection here (SU6-A1) by
      // comparing the case-insensitive occurrence count against the
      // literal count — any mismatch means at least one token survives
      // substitution (a mixed-case template leaks its miscased token
      // even though the lowercase one substitutes).
      const tokenCount = entry.destination.match(/:path\*/gi)?.length ?? 0;
      const literalTokenCount =
        entry.destination.match(/:path\*/g)?.length ?? 0;
      if (tokenCount !== literalTokenCount) {
        wildcardDestinationsWithMiscasedToken.push(
          `${entry.source} -> ${entry.destination} (${entry.id})`,
        );
        continue;
      }
      // A wildcard destination with NO token drops the matched
      // remainder entirely — every subpath collapses onto one page.
      // That is sometimes DELIBERATE (the allowlisted entries above
      // buildRedirectLookup) and sometimes a forgotten token, so warn
      // WITHOUT skipping: the collapse is well-defined behavior either
      // way (SU6-A2).
      if (
        tokenCount === 0 &&
        !DELIBERATE_COLLAPSE_WILDCARD_IDS.test(entry.id)
      ) {
        tokenlessWildcardDestinations.push(
          `${entry.source} -> ${entry.destination} (${entry.id})`,
        );
      }
      // Overlapping wildcard prefixes (SU4-A2): the scan is first-match-
      // wins, so when an EARLIER wildcard's prefix is a prefix of this
      // one, every path this entry could match is already claimed — the
      // entry is unreachable, shows zero PostHog traffic, and the
      // decommission report would wrongly propose deleting it. (The
      // inverse — an earlier LONGER prefix — is the normal
      // most-specific-first ordering and is fine.)
      const shadowingEntry = wildcardEntries.find((wc) =>
        prefix.startsWith(wc.prefix),
      );
      if (shadowingEntry) {
        shadowedWildcardPrefixes.push(
          `${entry.source} (${entry.id} unreachable behind ` +
            `${shadowingEntry.id})`,
        );
      }
      wildcardPrefixOwners.set(prefix, {
        id: entry.id,
        destinationTemplate: entry.destination,
      });
      wildcardEntries.push({
        prefix,
        id: entry.id,
        destinationTemplate: entry.destination,
      });
    }
  }

  if (duplicateSources.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      "[middleware] seo-redirects has duplicate exact sources — first " +
        `match wins, later entries are ignored: ${duplicateSources.join(", ")}`,
    );
  }
  if (duplicateWildcardSources.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      "[middleware] seo-redirects has duplicate wildcard prefixes — first " +
        "match wins, later entries are ignored: " +
        duplicateWildcardSources.join(", "),
    );
  }
  if (malformedWildcards.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      "[middleware] seo-redirects has malformed wildcard sources — the " +
        'prefix must end on a "/" boundary (no prefix lookalikes), :path* ' +
        "must be the final token, and a bare /:path* is never legal; " +
        `they are ignored: ${malformedWildcards.join(", ")}`,
    );
  }
  if (invalidDestinations.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      "[middleware] seo-redirects has entries with an invalid destination " +
        '(must be a root-relative path starting with "/", with no "//", ' +
        `"?" or "#") — they are ignored: ${invalidDestinations.join(", ")}`,
    );
  }
  if (invalidSources.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      "[middleware] seo-redirects has entries with an invalid source " +
        '(must be a root-relative path starting with "/", with no "//", ' +
        `"?" or "#") — they are ignored: ${invalidSources.join(", ")}`,
    );
  }
  if (nonAsciiEntries.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      "[middleware] seo-redirects has entries whose source or " +
        "destination contains non-printable-ASCII characters (raw " +
        "whitespace or non-ASCII) — request pathnames are " +
        "percent-encoded ASCII, so they can never match; they are " +
        `ignored: ${nonAsciiEntries.join(", ")}`,
    );
  }
  if (rootExactSources.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      '[middleware] seo-redirects has a root ("/") EXACT source — it ' +
        "would hijack the homepage (the root-wildcard guard's exact " +
        `twin); it is ignored: ${rootExactSources.join(", ")}`,
    );
  }
  if (unreachableTrailingSlashSources.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      "[middleware] seo-redirects has exact sources with a trailing " +
        "slash — matching strips trailing slashes before the lookup, so " +
        "they can never match; they are ignored: " +
        unreachableTrailingSlashSources.join(", "),
    );
  }
  if (exactDestinationsWithToken.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      "[middleware] seo-redirects has EXACT sources whose destination " +
        'contains ":path*" — exact matches never substitute, so the ' +
        "literal token would leak into the Location header; they are " +
        `ignored: ${exactDestinationsWithToken.join(", ")}`,
    );
  }
  if (wildcardDestinationsWithMiscasedToken.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      "[middleware] seo-redirects has WILDCARD sources whose destination " +
        'contains a miscased ":path*" token — substitution replaces the ' +
        "literal lowercase token only, so the miscased token would leak " +
        "into the Location header; they are ignored: " +
        wildcardDestinationsWithMiscasedToken.join(", "),
    );
  }
  if (tokenlessWildcardDestinations.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      "[middleware] seo-redirects has WILDCARD sources whose destination " +
        'has no ":path*" token — the matched remainder is silently ' +
        "dropped (every subpath collapses onto the same destination). " +
        "If deliberate, add the id to DELIBERATE_COLLAPSE_WILDCARD_IDS; " +
        `otherwise add the token: ${tokenlessWildcardDestinations.join(", ")}`,
    );
  }
  if (shadowedWildcardPrefixes.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      "[middleware] seo-redirects has wildcard sources whose prefix " +
        "falls under an EARLIER wildcard prefix — the scan is first-" +
        "match-wins, so they are unreachable (zero PostHog traffic; the " +
        "decommission report would wrongly propose deleting them): " +
        shadowedWildcardPrefixes.join(", "),
    );
  }
  if (exactsUnderEarlierWildcard.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      "[middleware] seo-redirects has exact sources under an EARLIER " +
        "wildcard prefix with a DIFFERENT destination — exact beats " +
        "wildcard regardless of table order (see buildRedirectLookup), " +
        "contradicting a top-to-bottom reading: " +
        exactsUnderEarlierWildcard.join(", "),
    );
  }

  return { exactMap, wildcardEntries };
}

/**
 * Substitute the matched path remainder into a destination template
 * (exported for tests). replaceAll, not a single replace — a template
 * with multiple :path* tokens would otherwise leak the literal token
 * into the Location header. Function replacer because `rest` is
 * user-controlled and the string form of String.prototype.replace
 * expands `$&`, "$`", `$'`, `$$` in the replacement (e.g.
 * /coagents/$&foo would re-insert the matched ":path*" token).
 * replaceAll never rescans inserted text, so a rest of ":path*" cannot
 * loop or double-substitute.
 */
export function substituteWildcardTemplate(
  template: string,
  rest: string,
): string {
  if (!template.includes(":path*")) return template;
  return template.replaceAll(":path*", () => rest);
}

const { exactMap, wildcardEntries } = buildRedirectLookup(seoRedirects);

// ---------------------------------------------------------------------------
// PostHog tracking via fetch (Edge Runtime compatible — no posthog-node SDK)
// ---------------------------------------------------------------------------

// Warn-once latch. NOTE: all the once-guards in this module
// (posthogKeyWarned, captureFailureWarnings, the module-load table
// warns above) are per-ISOLATE, not per-process — the Edge runtime can
// run several isolates side by side and recycles them, so "once" means
// once per isolate cold start. Expect occasional repeats in production
// logs; that's the mechanism, not a bug.
let posthogKeyWarned = false;

/**
 * Once-guarded missing-POSTHOG_KEY signal, fired at config-resolution
 * time on EVERY middleware invocation — NOT lazily inside trackRedirect
 * (SU6-A5): the lazy check only ran when a redirect MATCHED, so a prod
 * deploy whose traffic never hit a redirect source got ZERO signal that
 * every seo_redirect would go uncaptured.
 *
 * Mirrors warnIfNoFrameworkSlugs's NODE_ENV branching (SU4-A5): a
 * missing key is legitimate on dev/preview deploys (warn), but in
 * production it is a wiring bug — every redirect goes uncaptured and
 * the decommission report silently under-counts live traffic, the
 * wrongful-deletion class.
 */
function warnIfPosthogKeyMissing(posthogKey: string | undefined): void {
  if (posthogKey || posthogKeyWarned) return;
  posthogKeyWarned = true;
  const message =
    "[middleware] POSTHOG_KEY is not set — redirect tracking disabled";
  if (process.env.NODE_ENV === "production") {
    // eslint-disable-next-line no-console
    console.error(
      `${message}. In production this is a wiring bug: seo_redirect ` +
        "events are not recorded, so the redirect decommission report " +
        "under-counts this deploy's traffic.",
    );
  } else {
    // eslint-disable-next-line no-console
    console.warn(message);
  }
}

// One loud log per distinct capture-failure class (`http:<status>` /
// `net:<error name>`), not per request (and per isolate — see the note
// on posthogKeyWarned above) — mirrors the patternWarnings
// pattern in lib/backend-url.ts. Observability here is load-bearing:
// the redirect-decommission report deletes redirects that show ZERO
// PostHog traffic, so silently-broken capture (a swallowed rejection or
// an unchecked 4xx/5xx) leads to wrongful deletions.
const captureFailureWarnings = new Set<string>();

function warnCaptureFailureOnce(failureClass: string, detail: string): void {
  if (captureFailureWarnings.has(failureClass)) return;
  captureFailureWarnings.add(failureClass);
  // eslint-disable-next-line no-console
  console.warn(
    `[middleware] PostHog redirect capture failing (${failureClass}): ` +
      `${detail} — seo_redirect events are not being recorded, so the ` +
      "redirect decommission report will under-count this traffic.",
  );
}

/**
 * Defense-in-depth use-site normalization (exported for tests —
 * SU4-A7): runtime-config already ensures a scheme on POSTHOG_HOST
 * (getRuntimeConfig → ensureScheme, same hardening as readDocsHost), so
 * by the time middleware() threads the value here it is normally
 * absolute — the scheme-less branch is UNREACHABLE through middleware()
 * and only unit tests can exercise it. The guard keeps the capture
 * fetch safe if a future caller ever hands trackRedirect a raw env
 * value — a scheme-less host would make `fetch()` reject a relative
 * URL on EVERY redirect, silently zeroing the decommission report.
 */
export function normalizePosthogHost(host: string): string {
  // Trailing slashes are stripped FIRST (SU7-F3) so the caller's
  // `${host}/capture/` concatenation never yields "host//capture/" —
  // the same defense-in-depth posture as the scheme guard below
  // (runtime-config's readUrl already strips them for values threaded
  // through middleware(), so like the scheme branch this is only
  // reachable by future direct callers).
  const stripped = host.replace(/\/+$/, "");
  return SCHEME_RE.test(stripped) ? stripped : `https://${stripped}`;
}

function trackRedirect(
  event: NextFetchEvent,
  // posthogHost/posthogKey are resolved ONCE per request in middleware()
  // and passed in — trackRedirect used to call
  // getRuntimeConfigForMiddleware() again, resolving the config twice
  // per redirected request.
  posthogHost: string,
  posthogKey: string | undefined,
  id: string,
  fromPath: string,
  dest: URL,
): void {
  // The missing-key signal fires at config-resolution time in
  // middleware() (warnIfPosthogKeyMissing, SU6-A5) — here we only skip
  // the capture.
  if (!posthogKey) return;

  const captureUrl = `${normalizePosthogHost(posthogHost)}/capture/`;

  // Don't await (never block the redirect), but DO hand the promise to
  // event.waitUntil — the Edge runtime may otherwise terminate as soon
  // as the redirect response is returned, dropping the in-flight capture.
  const capture = fetch(captureUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: posthogKey,
      event: "seo_redirect",
      distinct_id: "seo-redirect-tracker",
      properties: {
        redirect_id: id,
        from_path: fromPath,
        // to_path alone is ambiguous for self-referential entries (e.g.
        // M3 /faq -> docs-host /faq emits from_path === to_path) — the
        // decommission report needs the destination HOST to tell them
        // apart. to_path is kept for continuity with historic events;
        // to_url adds the host but excludes the query string (it varies
        // per request and would explode property cardinality).
        to_path: dest.pathname,
        to_url: `${dest.origin}${dest.pathname}`,
      },
    }),
  })
    .then((res) => {
      // A 4xx/5xx resolves the fetch promise — without this check a
      // misconfigured key/host fails capture silently forever.
      if (!res.ok) {
        warnCaptureFailureOnce(
          `http:${res.status}`,
          `POST ${captureUrl} returned ${res.status}`,
        );
      }
    })
    .catch((err: unknown) => {
      // Never block or fail the redirect on tracking errors — but DO
      // surface them (once per class) instead of swallowing.
      const name = err instanceof Error ? err.name : typeof err;
      const message = err instanceof Error ? err.message : String(err);
      warnCaptureFailureOnce(`net:${name}`, message);
    });
  event.waitUntil(capture);
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

// Framework slugs owned by the docs shell. Any path whose first
// segment matches one of these is a framework-scoped docs URL — it
// 308s to the docs host BEFORE the SEO-redirect table runs, so legacy
// redirects (e.g. S1×mastra: `/mastra/agentic-chat-ui` →
// `/mastra/prebuilt-components`) can never hijack it even when legacy
// framework keys overlap with registry slugs.
// Lowercased at construction (SU4-A4): docs-redirects matches the
// LOWERCASED first path segment against this set (case-insensitive
// parity, SU3-A4). Registry slugs are canonical lowercase today, but a
// future mixed-case slug would otherwise silently never match — its
// docs-host redirect would just be disabled with no signal.
// Defensive extraction (SU5-A1, exported for tests): the previous
// construction reached through a bare `as` cast straight to
// `i.slug.toLowerCase()` — a malformed registry (null, a non-array
// `integrations`, entries missing `slug` or carrying a non-string slug)
// would TypeError at MODULE LOAD: the exact 500-every-request failure
// warnIfNoFrameworkSlugs exists to prevent. Extract structurally
// instead, counting dropped entries so the module-load guard below can
// warn alongside warnIfNoFrameworkSlugs.
export function extractFrameworkSlugs(registryData: unknown): {
  slugs: Set<string>;
  dropped: number;
} {
  const integrations = (
    registryData as { integrations?: unknown } | null | undefined
  )?.integrations;
  if (!Array.isArray(integrations)) {
    // Zero slugs — warnIfNoFrameworkSlugs screams about this shape.
    return { slugs: new Set(), dropped: 0 };
  }
  const slugs = new Set<string>();
  let dropped = 0;
  for (const entry of integrations) {
    const slug = (entry as { slug?: unknown } | null | undefined)?.slug;
    if (typeof slug === "string") {
      slugs.add(slug.toLowerCase());
    } else {
      dropped += 1;
    }
  }
  return { slugs, dropped };
}

const { slugs: registrySlugs, dropped: droppedRegistryEntries } =
  extractFrameworkSlugs(registry);

export const REGISTRY_FRAMEWORK_SLUGS: Set<string> = registrySlugs;

/**
 * Loud guard (exported for tests): the old next.config build THREW when
 * registry.json was missing or corrupt in production. Middleware cannot
 * afford to throw at module load — that would 500 every request — so it
 * screams in the logs instead: an empty slug set silently disables every
 * /<framework-slug> docs-host redirect.
 */
export function warnIfNoFrameworkSlugs(slugs: ReadonlySet<string>): void {
  if (slugs.size > 0) return;
  const message =
    "[middleware] registry.json produced ZERO framework slugs — " +
    "/<framework-slug> docs-host redirects are DISABLED. The registry is " +
    "missing or corrupt; run generate-registry.ts before building (the " +
    "old next.config build failed loudly here).";
  if (process.env.NODE_ENV === "production") {
    // eslint-disable-next-line no-console
    console.error(message);
  } else {
    // eslint-disable-next-line no-console
    console.warn(message);
  }
}

warnIfNoFrameworkSlugs(REGISTRY_FRAMEWORK_SLUGS);
if (droppedRegistryEntries > 0) {
  // Companion to warnIfNoFrameworkSlugs (SU5-A1): a PARTIALLY corrupt
  // registry yields a non-empty set that sails past the zero-slug guard
  // while the malformed integrations silently lose their docs-host
  // redirects — same failure class, so it gets the same loud signal.
  // eslint-disable-next-line no-console
  console.warn(
    `[middleware] registry.json has ${droppedRegistryEntries} integration ` +
      "entry(ies) with a missing or non-string slug — they were dropped " +
      "from the framework-slug set, so their /<framework-slug> docs-host " +
      "redirects are DISABLED. The registry is corrupt; run " +
      "generate-registry.ts before building.",
  );
}

// Warn-once latch for the docs-redirects-disabled sentinel (per-isolate,
// like posthogKeyWarned — see the note above it). runtime-config already
// console.errors the FATAL-CONFIG diagnosis once; this is the
// middleware-side breadcrumb that the redirect steps are being skipped.
let docsRedirectsDisabledWarned = false;

export function middleware(request: NextRequest, event: NextFetchEvent) {
  const { pathname } = request.nextUrl;
  // Resolve the Edge-safe runtime config (live process.env at request
  // time, no `next/cache` import) ONCE per request and thread the
  // values through — see getRuntimeConfigForMiddleware in
  // src/lib/runtime-config.ts.
  const { docsHost, posthogHost, posthogKey } = getRuntimeConfigForMiddleware();
  // Surface a missing POSTHOG_KEY on the FIRST request through the
  // middleware — see warnIfPosthogKeyMissing (SU6-A5).
  warnIfPosthogKeyMissing(posthogKey);

  // Case-insensitive matching parity (SU3-A4): the next.config rules
  // this layer replaced were compiled by path-to-regexp with
  // sensitive:false, so /FAQ and /Mastra/quickstart matched. The ported
  // Map/startsWith lookups are case-sensitive and regressed those URLs
  // to 404. Lowercase ONCE here for MATCHING only — matchPath feeds the
  // namespace guard (step 0) and the SEO steps (2-3); the docs-host
  // resolver (step 1) deliberately receives the ORIGINAL-case collapsed
  // path and lowercases INTERNALLY, because it needs the original case
  // to preserve the matched remainder (SU4-A6). The ORIGINAL-case
  // pathname likewise provides the wildcard remainder (path-to-regexp
  // preserves matched-param case in destinations) and the PostHog
  // from_path. Lowercasing is length-preserving here: NextRequest
  // pathnames are percent-encoded ASCII, so positional slicing against
  // `strippedPath` with `matchPath`-derived offsets is safe.
  //
  // Leading-slash normalization (SU4-A3): "//docs/foo" and "//ag-ui/x"
  // fell through the docs-host step's strict ===/startsWith branches AND
  // missed the SEO wildcard scan (only the framework-slug branch's
  // /^\/+/ regex tolerated runs) → 404. Collapse the LEADING run exactly
  // ONCE, HERE — this is the single normalization point for every
  // matching step below: the docs-host resolver receives the collapsed
  // (original-case) path, and strippedPath/matchPath derive from it, so
  // positional slicing stays aligned. Interior runs are left alone for
  // matching; destinations collapse them via normalizeRedirectPath
  // (SU-18/SU-13).
  const collapsedPath = pathname.replace(/^\/{2,}/, "/");
  // Trailing-slash normalization (SU3-A5, hardened SU4-A3): "/faq/" used
  // to miss the exact map and detour through Next's own trailing-slash
  // 308 (an extra hop), and "/coagents/" mis-attributed to the wildcard
  // L12 instead of the exact L1. Strip the WHOLE trailing-slash run
  // (a single slice(0, -1) left "/faq//" matching nothing); root "/"
  // survives because the guard requires length > 1 and the leading
  // collapse already reduced all-slash paths to "/". The wildcard
  // remainder is sliced from the stripped ORIGINAL-case path so a
  // trailing slash never leaks into destinations either.
  const strippedPath =
    collapsedPath.length > 1 && collapsedPath.endsWith("/")
      ? collapsedPath.replace(/\/+$/, "")
      : collapsedPath;
  const matchPath = strippedPath.toLowerCase();

  // 0. Shell-owned namespace guard: /integrations/* hosts LIVE shell
  // product pages. It runs BEFORE the docs-host redirect (SU4-A1): when
  // the guard sat after it, "no redirect may ever fire under
  // /integrations" was only DATA-dependent — true while no registry slug
  // happened to be named "integrations", but a future slug with that
  // name would have let the docs-host step hijack live shell pages
  // before the guard executed. Hoisted above every redirect step, the
  // protection is structural: neither the docs-host enumeration nor any
  // SEO-table entry can match under /integrations, regardless of what
  // the registry or the table contains (R15/R17 once hijacked
  // /integrations/built-in-agent, a deployed page with internal links).
  if (matchPath === "/integrations" || matchPath.startsWith("/integrations/")) {
    return NextResponse.next();
  }

  // 1. Docs-host routes (/docs, /ag-ui, /reference, /<framework-slug>).
  // These permanent (308) redirects used to live in next.config.ts
  // `redirects()` (as `permanent: true`, which Next emits as 308) — which
  // runs BEFORE middleware, hence this check precedes the SEO table to
  // preserve the exact same precedence. They moved here so the
  // destination host resolves from the runtime config (DOCS_HOST env
  // var) at request time instead of being baked into the image.
  // Receives collapsedPath (NOT matchPath): the resolver lowercases
  // internally to preserve the remainder's original case, and it
  // handles trailing slashes itself via normalizeRedirectPath.
  //
  // Sentinel consumer (SU4-B2): when runtime-config could not find ANY
  // usable docs host (configured value self-hosts AND the default
  // fallback collides too), it returns DOCS_REDIRECTS_DISABLED_HOST
  // instead of a looping host. Honor the contract documented on the
  // constant: skip the docs-host redirect step — and the SEO steps (2-3)
  // below too, because resolveSeoDestination composes EVERY table
  // destination against this same docsHost. Issuing any redirect here
  // would trade a redirect loop for a guaranteed-dead `.invalid` host.
  // Pass through instead; runtime-config already console.errored the
  // FATAL-CONFIG diagnosis with the fix.
  if (docsHost === DOCS_REDIRECTS_DISABLED_HOST) {
    if (!docsRedirectsDisabledWarned) {
      docsRedirectsDisabledWarned = true;
      // eslint-disable-next-line no-console
      console.warn(
        "[middleware] docs redirects are DISABLED for this deploy " +
          `(docsHost is the ${DOCS_REDIRECTS_DISABLED_HOST} sentinel) — ` +
          "skipping the docs-host and SEO redirect steps. See the " +
          "FATAL-CONFIG error from runtime-config for the root cause.",
      );
    }
    return NextResponse.next();
  }
  const docsDestination = resolveDocsHostRedirect(
    collapsedPath,
    docsHost,
    REGISTRY_FRAMEWORK_SLUGS,
  );
  if (docsDestination) {
    const dest = new URL(docsDestination);
    // next.config redirects forward the query string by default — keep
    // that behavior.
    dest.search = request.nextUrl.search;
    // Parity choice: docs-host redirects are deliberately NOT tracked in
    // PostHog — the next.config `redirects()` rules they replace never
    // were either; only the SEO table below calls trackRedirect.
    //
    // 308, not 301: the old rules used `permanent: true`, which Next
    // emits as 308 (permanent, method-preserving).
    return NextResponse.redirect(dest, 308);
  }

  // 2. Exact match (O(1) Map lookup)
  //
  // The SEO table's destinations target the DOCS routing surface
  // (shell-docs serves at the docs host root), NOT the shell. Resolving
  // them against `request.url` (the shell origin) made self-referential
  // entries (e.g. /faq -> /faq) 301 to themselves forever
  // (ERR_TOO_MANY_REDIRECTS) and sent everything else to a shell 404 or
  // through a needless double hop — so resolve against the docs host.
  const exact = exactMap.get(matchPath);
  if (exact) {
    const dest = resolveSeoDestination(exact.destination, docsHost);
    // Forward the query string, matching the docs-host step (and
    // next.config redirects' default behavior).
    dest.search = request.nextUrl.search;
    trackRedirect(event, posthogHost, posthogKey, exact.id, pathname, dest);
    return NextResponse.redirect(dest, 301);
  }

  // 3. Wildcard match (linear scan — short-circuits on first match).
  // Destinations resolve against the docs host — see step 2.
  //
  // next.config `:path*` semantics are ZERO or more segments: a source
  // `/x/:path*` also matches the bare `/x` (rest = ""), so e.g.
  // /backend, /guides, /learn keep redirecting instead of 404ing.
  // resolveSeoDestination collapses the trailing slash a zero-segment
  // substitution leaves behind.
  for (const wc of wildcardEntries) {
    // Builder invariant: every wildcard prefix ends with "/" —
    // buildRedirectLookup skips sources without the "/" boundary as
    // malformedWildcards — so the bare (zero-segment) source is always
    // the prefix minus exactly that one slash (SU4-A6).
    const bareSource = wc.prefix.slice(0, -1);
    if (matchPath.startsWith(wc.prefix) || matchPath === bareSource) {
      // Sliced from the ORIGINAL-case (trailing-slash-stripped) path —
      // only the prefix match is case-insensitive; the remainder
      // forwards verbatim.
      const rest =
        matchPath === bareSource ? "" : strippedPath.slice(wc.prefix.length);
      const destination = substituteWildcardTemplate(
        wc.destinationTemplate,
        rest,
      );
      const dest = resolveSeoDestination(destination, docsHost);
      dest.search = request.nextUrl.search;
      trackRedirect(event, posthogHost, posthogKey, wc.id, pathname, dest);
      return NextResponse.redirect(dest, 301);
    }
  }

  // 4. No match — pass through
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Exclusions, in order (SU4-A6 — prose kept in sync with the
    // pattern):
    //   - `api/.+`: real API routes only — /api/<anything>. The bare
    //     /api and prefix lookalikes like /api-reference are SEO
    //     sources (R1/R3) and must reach the middleware; the bare
    //     trailing-slash "/api/" must too (SU5-A4), so R1 redirects it
    //     in ONE hop instead of detouring through Next's own
    //     trailing-slash 308 (a double hop).
    //   - `_next/`: ALL Next.js internals, wholesale. The previous
    //     `_next/static|_next/image` pair let /_next/data and every
    //     other /_next/* path run the middleware for nothing — no table
    //     source or registry slug starts with `_next` (verified against
    //     seo-redirects.ts and registry.json).
    //   - `favicon\.ico`: PREFIX-based like every alternative here — it
    //     also excludes e.g. /favicon.ico.png; that's fine, nothing
    //     under that prefix is a redirect source.
    //   - `previews/`: the shell's preview-asset namespace; never a
    //     redirect source.
    "/((?!api/.+|_next/|favicon\\.ico|previews/).*)",
  ],
};
