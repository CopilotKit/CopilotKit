// Runtime derivation of integration backend URLs.
//
// The registry's `backend_url` is synthesized at Docker BUILD time by
// scripts/generate-registry.ts, which bakes the production hostnames
// into every image — so a staging shell iframed prod integrations.
// These helpers derive the backend host at REQUEST time from the
// `backendHostPattern` carried in RuntimeConfig (env var
// SHOWCASE_BACKEND_HOST_PATTERN, default = the prod pattern), keeping
// registry.json as the source for non-URL metadata only.
//
// Pattern semantics are IDENTICAL to generate-registry.ts: the pattern
// is a bare host with `{slug}` as the only placeholder, and `https://`
// is prepended. Keep the two in sync — they consume the same env var.
//
// This module is import-safe from client components, server components,
// and middleware (pure functions, no next/* imports).

// Matches an explicit URL scheme prefix (e.g. `https://`, `http://`).
// Exported as the single source of truth — runtime-config.ts shares it
// (this module is import-safe everywhere, so the dependency is free).
export const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

// Default backend host pattern — reproduces today's baked prod values
// exactly, so a deploy with the env var unset (i.e. current prod)
// behaves byte-identically. Lives HERE (not runtime-config.ts, which
// re-exports it) because normalizeBackendHostPattern falls back to it
// for degenerate values and runtime-config already imports this module
// — defining it there would create an import cycle.
export const DEFAULT_BACKEND_HOST_PATTERN =
  "showcase-{slug}-production.up.railway.app";

// Warn once per distinct (pattern, issue) — config is re-read every
// request, and per-request warn spam would drown real signal.
const patternWarnings = new Set<string>();

function warnPatternOnce(key: string, message: string): void {
  if (patternWarnings.has(key)) return;
  patternWarnings.add(key);
  // eslint-disable-next-line no-console
  console.warn(`[backend-url] SHOWCASE_BACKEND_HOST_PATTERN ${message}`);
}

// FATAL once per distinct degenerate pattern value — parity with the
// FATAL-CONFIG once-guards in runtime-config.ts (readUrl/readDocsHost).
const patternFatals = new Set<string>();

// Same dev-vs-prod branch as validateBaseUrl/readDocsHost
// (runtime-config.ts): in production this is a FATAL-CONFIG error with
// Railway guidance; in dev it degrades to a warn — Railway guidance is
// useless on a laptop, and the dev contract is frictionless iteration.
// NODE_ENV is read at CALL time (this module is import-safe everywhere;
// Next statically inlines the literal read in client bundles).
function fatalPatternOnce(key: string, message: string): void {
  if (patternFatals.has(key)) return;
  patternFatals.add(key);
  if (process.env.NODE_ENV === "production") {
    // eslint-disable-next-line no-console
    console.error(
      `[backend-url] FATAL-CONFIG: SHOWCASE_BACKEND_HOST_PATTERN ${message} ` +
        `Fix the SHOWCASE_BACKEND_HOST_PATTERN env var on the Railway service.`,
    );
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      `[backend-url] SHOWCASE_BACKEND_HOST_PATTERN ${message}`,
    );
  }
}

/**
 * Can the normalized pattern actually form a backend URL? Probe by
 * substituting a registry-shaped slug and parsing the consumer's exact
 * composition (`https://` + pattern). Catches the degenerate classes
 * the per-issue normalizations can't fix: empty results ("https://" or
 * "/" normalize to ""), internal whitespace, and anything else
 * `new URL` rejects or that parses without a real host.
 */
function isUsablePattern(normalized: string): boolean {
  if (normalized.length === 0) return false;
  try {
    const probe = new URL(
      `https://${normalized.replaceAll("{slug}", "probe")}`,
    );
    return probe.hostname.length > 0 && !/^https?$/i.test(probe.hostname);
  } catch {
    return false;
  }
}

/**
 * Does the pattern carry a component no backend base URL may have?
 * Probed via the same consumer-exact composition as isUsablePattern.
 * Returns a human-readable component name for the FATAL log, or
 * undefined when the pattern is clean. Three rejected classes (same
 * gates validateBaseUrl has in runtime-config.ts):
 *
 * - userinfo credentials: a credentialed pattern yields iframe srcs
 *   that Chromium silently blocks — the integration pane just never
 *   loads, with zero signal;
 * - query / fragment: consumers concatenate demo routes onto the
 *   composed URL, so `https://host?x=1` + `/route` yields
 *   `https://host?x=1/route` — every backend URL ships corrupted.
 *
 * An unparseable value returns undefined here; the usability gate
 * handles it.
 */
function patternForbiddenComponent(normalized: string): string | undefined {
  try {
    const probe = new URL(
      `https://${normalized.replaceAll("{slug}", "probe")}`,
    );
    if (probe.username !== "" || probe.password !== "") {
      return "userinfo credentials";
    }
    if (probe.search !== "") return "a query component";
    if (probe.hash !== "") return "a fragment component";
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Normalize a backend host pattern read from the environment. The
 * pattern contract (same as scripts/generate-registry.ts) is a bare
 * host with `{slug}` as the only placeholder — but env misconfigs are
 * easy and were previously silent:
 *
 * - a scheme-bearing value would yield `https://https://…` (consumer
 *   prepends the scheme) → strip it and warn;
 * - a trailing slash would yield `host//route` on concat → trim and warn;
 * - a missing `{slug}` placeholder silently sends EVERY integration to
 *   the same host → warn (can't fix it for the operator).
 *
 * Warnings fire once per distinct value, not per request.
 */
export function normalizeBackendHostPattern(pattern: string): string {
  let normalized = pattern;
  if (/\s/.test(normalized)) {
    // Whitespace was the ONE misconfig class with zero warning — a
    // pasted ` host` yields an iframe src like `https:// host`. Trim
    // the ends (fixable); internal whitespace splits by position:
    // host-position whitespace makes the pattern unparseable, so the
    // usability gate below falls back to the DEFAULT (it never ships);
    // path-position whitespace parses and genuinely ships broken.
    warnPatternOnce(
      `whitespace:${pattern}`,
      `"${pattern}" contains whitespace — trimming the ends. Internal whitespace in the host cannot form a usable pattern (falls back to the default); internal whitespace in a path segment ships in every backend URL.`,
    );
    normalized = normalized.trim();
  }
  // Loop the strip to convergence: a single pass left "https://https://
  // host" with a scheme that the consumer then double-prepends. Collect
  // every stripped scheme first so the once-guarded warn can name them
  // ALL — warning inside the loop swallowed every name after the first.
  const strippedSchemes: string[] = [];
  for (
    let scheme = SCHEME_RE.exec(normalized);
    scheme;
    scheme = SCHEME_RE.exec(normalized)
  ) {
    strippedSchemes.push(scheme[0]);
    normalized = normalized.slice(scheme[0].length);
  }
  if (strippedSchemes.length > 0) {
    warnPatternOnce(
      `scheme:${pattern}`,
      `"${pattern}" includes a scheme — the consumer prepends https://; stripping ${strippedSchemes
        .map((s) => `"${s}"`)
        .join(", ")}.`,
    );
  }
  if (/\/+$/.test(normalized)) {
    warnPatternOnce(
      `trailing-slash:${pattern}`,
      `"${pattern}" has a trailing slash — route concatenation would yield "//"; trimming.`,
    );
    normalized = normalized.replace(/\/+$/, "");
  }
  // Usability gate AFTER the fixable normalizations, BEFORE the
  // advisory warns ({slug}/path) — a degenerate value ("https://", "/",
  // whitespace) normalizes to "" or an unparseable host, and previously
  // flowed out with NO fallback: server-side iframe srcs became
  // "https://", and the injected "" failed the client reader's
  // REQUIRED_CONFIG_FIELDS check, crashing every client component with
  // a message blaming the layout injection instead of this env var.
  const forbidden = patternForbiddenComponent(normalized);
  if (forbidden !== undefined) {
    fatalPatternOnce(
      `forbidden:${forbidden}:${pattern}`,
      `${JSON.stringify(pattern)} carries ${forbidden} — userinfo makes ` +
        `Chromium silently block every iframe src formed from it, and a ` +
        `query/fragment corrupts every backend URL when consumers ` +
        `concatenate demo routes; falling back to the default pattern ` +
        `${DEFAULT_BACKEND_HOST_PATTERN}.`,
    );
    return DEFAULT_BACKEND_HOST_PATTERN;
  }
  if (!isUsablePattern(normalized)) {
    fatalPatternOnce(
      `degenerate:${pattern}`,
      `${JSON.stringify(pattern)} normalizes to ${JSON.stringify(normalized)}, ` +
        `which cannot form a parseable backend URL; falling back to the ` +
        `default pattern ${DEFAULT_BACKEND_HOST_PATTERN}.`,
    );
    return DEFAULT_BACKEND_HOST_PATTERN;
  }
  if (!normalized.includes("{slug}")) {
    warnPatternOnce(
      `no-slug:${pattern}`,
      `"${pattern}" lacks the {slug} placeholder — EVERY integration will resolve to the same backend host.`,
    );
  }
  if (normalized.includes("/")) {
    // The documented contract is a BARE host — an internal path segment
    // (`host.app/base/{slug}`) violates it silently: the consumer
    // prepends https:// and concatenates routes, so the base path lands
    // in every backend URL. Can't fix it for the operator (the intent
    // is ambiguous) — flag it.
    warnPatternOnce(
      `path:${pattern}`,
      `"${pattern}" contains a path segment — the contract is a bare host; the path will be embedded in every backend URL.`,
    );
  }
  return normalized;
}

// Registry slug contract — see scripts/generate-registry.ts manifests.
const SLUG_RE = /^[a-z0-9-]+$/;

/** Substitute `{slug}` into the host pattern and prepend `https://`. */
export function backendUrlFromPattern(pattern: string, slug: string): string {
  // Charset assert at the choke point: every backend URL flows through
  // here and the slug lands in the HOST of an iframe src — a slug
  // containing "." or "/" is host/path injection. All registry slugs
  // match [a-z0-9-]+; anything else is a contract violation upstream
  // (call sites resolve slugs from the registry), not data.
  if (!SLUG_RE.test(slug)) {
    throw new Error(
      `[backend-url] invalid integration slug ${JSON.stringify(slug)} — ` +
        `slugs must match ${String(SLUG_RE)} (host-injection guard).`,
    );
  }
  // Function replacer: a plain string replacement is subject to `$`
  // substitution patterns ("$&", "$'", ...), which would corrupt the
  // host for any slug containing `$` (defense in depth behind SLUG_RE).
  return `https://${pattern.replaceAll("{slug}", () => slug)}`;
}

// Warn once per distinct (raw value, issue) — resolveBackendUrl runs on
// every render, so per-call warns would spam exactly like the pattern
// warnings the patternWarnings set above exists to prevent.
const localBackendsWarnings = new Set<string>();

function warnLocalBackendsOnce(key: string, message: string): void {
  if (localBackendsWarnings.has(key)) return;
  localBackendsWarnings.add(key);
  // eslint-disable-next-line no-console
  console.warn(`[backend-url] NEXT_PUBLIC_LOCAL_BACKENDS ${message}`);
}

// Shared frozen empty map for the unset path — a fresh mutable {} per
// call would dodge the freeze guarantee below.
const NO_LOCAL_BACKENDS: Record<string, string> = Object.freeze({});

// Memoized on the raw string: the env value is baked at build time and
// effectively constant, so re-running JSON.parse on every render is
// pure waste.
let lastLocalBackendsRaw: string | undefined;
let lastLocalBackends: Record<string, string> = NO_LOCAL_BACKENDS;

/**
 * Parse the NEXT_PUBLIC_LOCAL_BACKENDS map (baked at build from
 * shared/local-ports.json — local-dev only, empty in deployed images).
 * Tolerant of unset/empty/corrupt values: local dev convenience must
 * never break rendering. The parse is memoized on the raw string and
 * warnings fire once per distinct (value, issue), not per call.
 *
 * The returned object is FROZEN: the memo is shared across every
 * caller, so a consumer mutating its "own" map would change the
 * local-backend overrides process-wide.
 */
export function parseLocalBackends(
  raw: string | undefined,
): Record<string, string> {
  if (!raw) return NO_LOCAL_BACKENDS;
  if (raw !== lastLocalBackendsRaw) {
    lastLocalBackendsRaw = raw;
    lastLocalBackends = Object.freeze(parseLocalBackendsUncached(raw));
  }
  return lastLocalBackends;
}

function parseLocalBackendsUncached(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      // Validate values instead of an unchecked `as Record<string,
      // string>` flow-through — a non-string value would otherwise
      // surface much later as a garbage iframe src.
      const backends: Record<string, string> = {};
      for (const [slug, url] of Object.entries(parsed)) {
        if (typeof url === "string") {
          backends[slug] = url;
        } else {
          warnLocalBackendsOnce(
            `non-string:${slug}:${raw}`,
            `value for "${slug}" is not a string — skipping it.`,
          );
        }
      }
      return backends;
    }
    warnLocalBackendsOnce(
      `non-object:${raw}`,
      "is not a JSON object — ignoring it.",
    );
  } catch {
    // Treat unparseable as unset (local-dev convenience must never
    // break rendering) — but say so, instead of silently eating it.
    warnLocalBackendsOnce(
      `invalid-json:${raw}`,
      "is not valid JSON — ignoring it.",
    );
  }
  return {};
}

/**
 * Resolve an integration's backend base URL: a local-dev override from
 * NEXT_PUBLIC_LOCAL_BACKENDS wins (preserving the pre-existing
 * `SHOWCASE_LOCAL=1` behavior), otherwise derive from the runtime host
 * pattern.
 */
export function resolveBackendUrl(slug: string, pattern: string): string {
  // ASSUMPTION: the server must never SET NEXT_PUBLIC_LOCAL_BACKENDS at
  // runtime post-build — the client bundle bakes the build-time value,
  // so a live server-side value would silently diverge from what client
  // components resolve.
  const local = parseLocalBackends(process.env.NEXT_PUBLIC_LOCAL_BACKENDS);
  // Length-aware: an empty-string override (e.g. `{"mastra": ""}`) is
  // not a usable URL — `??` would accept it and yield an empty base.
  const override = local[slug];
  if (override !== undefined && override.length > 0) {
    // The override lands verbatim in an iframe src — require a
    // scheme-bearing, parseable URL (`localhost:4111` without a scheme
    // parses as scheme "localhost:"!) whose protocol is http(s):
    // `javascript://...` and `ftp://...` are scheme-bearing AND
    // parseable, but have no business in an iframe src. Userinfo,
    // query, and fragment components are rejected too (same gates the
    // pattern path has): Chromium silently blocks credentialed iframe
    // srcs, and a query/fragment corrupts every composed URL when
    // consumers concatenate demo routes. Warn and fall back otherwise.
    const parsed = parseUrl(override);
    if (
      parsed !== undefined &&
      SCHEME_RE.test(override) &&
      /^https?:$/i.test(parsed.protocol) &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.search === "" &&
      parsed.hash === ""
    ) {
      // Return the parsed-normalized form (origin + path), not the raw
      // string: the parse already happened, and the raw form leaks
      // un-normalized values (uppercase hosts, explicit default ports)
      // into iframe srcs. The trailing-slash trim matches the
      // normalization the pattern path guarantees
      // (normalizeBackendHostPattern) — an override skipping it yields
      // `host//route` when consumers concatenate demo routes. Query,
      // fragment, and userinfo are empty here (gated above), so
      // origin + pathname IS the whole URL.
      return (parsed.origin + parsed.pathname).replace(/\/+$/, "");
    }
    warnLocalBackendsOnce(
      `bad-override:${slug}:${override}`,
      `override for "${slug}" (${JSON.stringify(override)}) is not a plain ` +
        `parseable http(s) base URL (no userinfo/query/fragment) — ignoring it.`,
    );
  }
  return backendUrlFromPattern(pattern, slug);
}

function parseUrl(value: string): URL | undefined {
  // URL.canParse needs Node 18.17+/modern browsers — try/catch keeps
  // this safe on every runtime the shell targets.
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}
