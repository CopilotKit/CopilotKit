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
// ONE EXCEPTION to "ignore the registry" was added for the unified
// frontend migration: the pattern is a BARE HOST, so it structurally
// cannot express `https://<one-shared-host>/<slug>` — the shape a slug
// takes once its demos move to the unified Next.js app. The only
// in-tree way to say "this slug moved" is a manifest-set `backend_url`
// (showcase/shared/manifest.schema.json), which generate-registry.ts
// lets win over the synthesized pattern value. resolveBackendUrl now
// honors such a value, but ONLY under the two gates in
// registryBackendOverride below — which is what keeps the staging
// reasoning above intact. Read that function before touching this.
//
// This module is import-safe from client components, server components,
// and middleware (pure functions, no next/* imports). In particular it
// must NEVER import ./registry (and therefore @/data/registry.json):
// src/middleware.ts imports SCHEME_RE from here, so a registry import
// would drag the whole registry into the Edge bundle. The caller passes
// the slug's registry `backend_url` in as an argument instead.

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
    console.warn(`[backend-url] SHOWCASE_BACKEND_HOST_PATTERN ${message}`);
  }
}

/**
 * Can the normalized pattern actually form a backend URL? Probe by
 * substituting a registry-shaped slug and parsing the consumer's exact
 * composition (`https://` + pattern). Catches the degenerate classes
 * the per-issue normalizations can't fix: empty results ("https://" or
 * "/" normalize to ""), internal whitespace, and anything else
 * `new URL` rejects or that parses without a real host.
 *
 * Returns `undefined` when usable, otherwise a reason discriminant so
 * the FATAL can be honest: a probe whose HOST is literally
 * "http"/"https" (e.g. `https:/host` — one slash short, so SCHEME_RE
 * never strips it) DOES parse — calling it "unparseable" would hide
 * the actual problem (a stray scheme fragment in host position).
 */
function patternUsabilityProblem(
  normalized: string,
): "unparseable" | "stray-scheme-fragment" | undefined {
  if (normalized.length === 0) return "unparseable";
  try {
    const probe = new URL(
      `https://${normalized.replaceAll("{slug}", "probe")}`,
    );
    if (probe.hostname.length === 0) return "unparseable";
    if (/^https?$/i.test(probe.hostname)) return "stray-scheme-fragment";
    return undefined;
  } catch {
    return "unparseable";
  }
}

/**
 * Does the pattern carry a component no backend base URL may have?
 * Detected on the LITERAL delimiter characters (see inline comments —
 * the WHATWG getters return "" for present-but-empty components, so a
 * probe-based check leaks bare `?`/`#`/`@`).
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
 */
function patternForbiddenComponent(normalized: string): string | undefined {
  // Query/fragment are detected on the LITERAL characters, not the
  // probe getters: WHATWG getters return "" for a present-but-EMPTY
  // component (`https://host?` has search === ""), so a bare trailing
  // `?`/`#` would slip a getter check while the raw character still
  // ships in the pattern — and route concatenation then swallows every
  // demo route into the query/fragment. The literal check is strictly
  // stronger than the getter check (a non-empty search/hash implies the
  // literal character), so the getters aren't consulted at all. Which
  // component a literal introduces follows URL precedence: `#` starts
  // the fragment; `?` starts a query only when no `#` precedes it.
  const hashAt = normalized.indexOf("#");
  const queryAt = normalized.indexOf("?");
  if (queryAt !== -1 && (hashAt === -1 || queryAt < hashAt)) {
    return "a query component";
  }
  if (hashAt !== -1) return "a fragment component";
  // Userinfo is a literal check too: `https://@host` and
  // `https://:@host` parse with username === "" AND password === ""
  // (present-but-EMPTY userinfo), so the getter check let the raw
  // `@`-bearing string ship. Any `@` in the AUTHORITY (the part before
  // the first `/` — query/fragment are already rejected above) is a
  // userinfo delimiter; it is never valid inside a hostname.
  const slashAt = normalized.indexOf("/");
  const authority = slashAt === -1 ? normalized : normalized.slice(0, slashAt);
  if (authority.includes("@")) return "userinfo credentials";
  return undefined;
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
    // the ends (fixable) and strip internal tab/CR/LF (the WHATWG URL
    // parser deletes \t\r\n pre-parse, so a tab-bearing pattern would
    // pass the usability gate while the RAW control character shipped
    // in every iframe src — stripping matches what the parser does
    // anyway). Internal SPACES split by position: a host-position
    // space makes the pattern unparseable, so the usability gate below
    // falls back to the DEFAULT (it never ships); a path-position
    // space parses and genuinely ships broken.
    warnPatternOnce(
      `whitespace:${pattern}`,
      `"${pattern}" contains whitespace — trimming the ends and stripping internal tab/CR/LF (the URL parser ignores them anyway). An internal space in the host cannot form a usable pattern (falls back to the default); a space in a path segment ships in every backend URL.`,
    );
    normalized = normalized.replace(/[\t\r\n]/g, "").trim();
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
  //
  // DESIGN DECISION — degenerate/forbidden patterns fail OPEN to
  // DEFAULT_BACKEND_HOST_PATTERN, which is the PROD host pattern. On a
  // staging deploy, a mistyped SHOWCASE_BACKEND_HOST_PATTERN therefore
  // silently (FATAL log aside) iframes PROD integrations — the exact
  // staging→prod leakage this module exists to prevent. The
  // alternative (fail CLOSED: ship "" and break every integration
  // pane) was rejected because a hard outage is worse than serving
  // prod content with a FATAL-CONFIG log; revisit if staging/prod
  // divergence ever becomes load-bearing for correctness.
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
  // Fails OPEN to the prod pattern too — see the DESIGN DECISION note
  // above the forbidden-component gate.
  const usabilityProblem = patternUsabilityProblem(normalized);
  if (usabilityProblem !== undefined) {
    fatalPatternOnce(
      `degenerate:${pattern}`,
      usabilityProblem === "stray-scheme-fragment"
        ? `${JSON.stringify(pattern)} normalizes to ` +
            `${JSON.stringify(normalized)}, whose host is literally ` +
            `"http"/"https" — it looks like a stray scheme fragment, not ` +
            `a backend host; falling back to the default pattern ` +
            `${DEFAULT_BACKEND_HOST_PATTERN}.`
        : `${JSON.stringify(pattern)} normalizes to ` +
            `${JSON.stringify(normalized)}, which cannot form a parseable ` +
            `backend URL; falling back to the default pattern ` +
            `${DEFAULT_BACKEND_HOST_PATTERN}.`,
    );
    return DEFAULT_BACKEND_HOST_PATTERN;
  }
  // Canonicalize the authority for parity with the override path,
  // which returns the parsed-normalized form (lowercase host, default
  // port elided) — the pattern path ships this string RAW into iframe
  // srcs, leaking uppercase hosts and an explicit :443. Hosts are
  // case-insensitive and the consumer always prepends https://, so
  // lowercasing the authority and stripping a trailing :443 (the https
  // default — :80 is a REAL port under https and must survive) matches
  // what the URL parser does to the composed URL anyway. The path part
  // (from the first "/") is case-SENSITIVE and stays untouched; the
  // lowercase {slug} placeholder survives lowercasing verbatim.
  const pathAt = normalized.indexOf("/");
  const authority = pathAt === -1 ? normalized : normalized.slice(0, pathAt);
  const pathPart = pathAt === -1 ? "" : normalized.slice(pathAt);
  normalized = authority.toLowerCase().replace(/:443$/, "") + pathPart;
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
    // Compute FIRST, then commit key and value together: committing
    // the key before the value meant a throw mid-compute (console.warn
    // is a foreign call — a logging shim CAN throw) left the memo
    // poisoned, and the next call with the same raw returned the
    // PREVIOUS raw's value.
    const backends = Object.freeze(parseLocalBackendsUncached(raw));
    lastLocalBackendsRaw = raw;
    lastLocalBackends = backends;
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
      //
      // Null-prototype accumulator: on a plain `{}`, assigning a
      // "__proto__" key hits the Object.prototype setter and is a
      // silent no-op — the entry would vanish with no warning (every
      // other rejected entry warns). With no prototype it lands as an
      // ordinary own data property.
      const backends: Record<string, string> = Object.create(null);
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
 * Validate a candidate backend BASE URL (a local-dev override or a
 * registry `backend_url`) and return the parsed form, or undefined when
 * it is unusable. The value lands verbatim in an iframe src, so require
 * a scheme-bearing, parseable URL (`localhost:4111` without a scheme
 * parses as scheme "localhost:"!) whose protocol is http(s):
 * `javascript://...` and `ftp://...` are scheme-bearing AND parseable,
 * but have no business in an iframe src. Userinfo, query, and fragment
 * components are rejected too (same gates the pattern path has):
 * Chromium silently blocks credentialed iframe srcs, and a
 * query/fragment corrupts every composed URL when consumers concatenate
 * demo routes.
 */
function parseBackendBaseUrl(value: string): URL | undefined {
  const parsed = parseUrl(value);
  if (
    parsed !== undefined &&
    SCHEME_RE.test(value) &&
    /^https?:$/i.test(parsed.protocol) &&
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.search === "" &&
    parsed.hash === ""
  ) {
    return parsed;
  }
  return undefined;
}

/**
 * Render a validated base URL for consumers. Returns the
 * parsed-normalized form (origin + path), not the raw string: the parse
 * already happened, and the raw form leaks un-normalized values
 * (uppercase hosts, explicit default ports) into iframe srcs. The PATH
 * is preserved — that is what makes `https://<host>/<slug>` (the
 * unified-frontend shape) survive. The trailing-slash trim matches the
 * normalization the pattern path guarantees
 * (normalizeBackendHostPattern): a base ending in "/" yields
 * `host//route` when consumers concatenate demo routes, which start
 * with "/". Query, fragment, and userinfo are empty here (gated in
 * parseBackendBaseUrl), so origin + pathname IS the whole URL.
 */
function backendBaseUrlString(parsed: URL): string {
  return (parsed.origin + parsed.pathname).replace(/\/+$/, "");
}

/**
 * Local-dev override from NEXT_PUBLIC_LOCAL_BACKENDS, or undefined when
 * absent/unusable (warning once per distinct bad value). Highest
 * precedence — it preserves the pre-existing `SHOWCASE_LOCAL=1`
 * behavior, and a developer pointing a slug at localhost must win over
 * everything derived from deployed config.
 */
function localBackendOverride(slug: string): string | undefined {
  // ASSUMPTION: the server must never SET NEXT_PUBLIC_LOCAL_BACKENDS at
  // runtime post-build — the client bundle bakes the build-time value,
  // so a live server-side value would silently diverge from what client
  // components resolve.
  const local = parseLocalBackends(process.env.NEXT_PUBLIC_LOCAL_BACKENDS);
  const rawOverride = local[slug];
  if (rawOverride !== undefined) {
    // Trim before validating — the same paste-artifact tolerance the
    // pattern path applies (normalizeBackendHostPattern trims the
    // ends): a leading-space override otherwise fails the SCHEME_RE
    // anchor even though the URL parser accepts the value.
    const override = rawOverride.trim();
    // Length-aware: an empty/whitespace-only override (e.g.
    // `{"mastra": ""}`) is not a usable URL — `??` would accept it and
    // yield an empty base. The emptiness check lives INSIDE the
    // override block so it warns like every other bad override:
    // skipping it in the outer condition ignored the dead override
    // with zero signal.
    if (override.length === 0) {
      warnLocalBackendsOnce(
        `bad-override:${slug}:empty`,
        `override for "${slug}" is empty (or whitespace-only) — ignoring it.`,
      );
      return undefined;
    }
    const parsed = parseBackendBaseUrl(override);
    if (parsed !== undefined) return backendBaseUrlString(parsed);
    // Name the actual requirements instead of "not parseable":
    // `http:localhost:4111` IS parseable (special schemes tolerate
    // missing slashes), but it fails the explicit `scheme://`
    // requirement — a "not parseable" claim sends the developer
    // chasing a parse problem that doesn't exist.
    warnLocalBackendsOnce(
      `bad-override:${slug}:${override}`,
      `override for "${slug}" (${JSON.stringify(override)}) must be an ` +
        `http(s) URL with an explicit "scheme://" and no userinfo, query, ` +
        `or fragment — ignoring it.`,
    );
  }
  return undefined;
}

// Warn once per distinct (slug, raw value) — resolveBackendUrl runs on
// every render, same rationale as the two warn sets above.
const registryBackendWarnings = new Set<string>();

function warnRegistryBackendOnce(key: string, message: string): void {
  if (registryBackendWarnings.has(key)) return;
  registryBackendWarnings.add(key);
  // eslint-disable-next-line no-console
  console.warn(`[backend-url] registry backend_url ${message}`);
}

/**
 * A slug's registry `backend_url`, honored ONLY when it is a deliberate
 * migration override — otherwise undefined, so the caller falls through
 * to the host pattern exactly as before.
 *
 * WHY this exists: DEFAULT_BACKEND_HOST_PATTERN is a bare host with
 * `{slug}` as its only placeholder, so it cannot express the shape a
 * slug takes once its demos move to the unified Next.js frontend —
 * `https://<one-shared-host>/<slug>`, where the host is the same for
 * every migrated slug and the slug is a PATH segment. A manifest-set
 * `backend_url` is the only in-tree way to express that.
 *
 * TWO GATES, both load-bearing:
 *
 * 1. STAGING SAFETY. The registry value is baked at Docker BUILD time
 *    with PRODUCTION hosts (scripts/generate-registry.ts) — that is the
 *    whole reason this module derives URLs from the runtime pattern
 *    instead (see the module header). So the preference applies ONLY
 *    when this shell would ALREADY resolve this slug to the default
 *    production host, i.e. when the effective pattern reproduces
 *    DEFAULT_BACKEND_HOST_PATTERN for this slug. A staging shell (which
 *    sets SHOWCASE_BACKEND_HOST_PATTERN to non-prod hosts) therefore
 *    behaves BYTE-IDENTICALLY to today for every slug, migrated or not,
 *    and can never be talked into iframing production.
 *
 *    Without this gate the regression is not subtle: on staging the
 *    pattern host (`showcase-<slug>-staging…`) differs from the baked
 *    registry host (`showcase-<slug>-production…`) for ALL 20 slugs, so
 *    a bare "prefer backend_url when it differs from the pattern host"
 *    rule would send the entire staging shell to production — exactly
 *    the bug this module was written to fix.
 *
 *    Accepted cost: a staging shell shows a MIGRATED slug's old
 *    per-slug backend, which may 404 once that backend is retired. A
 *    visibly-broken staging cell is strictly better than a staging
 *    shell silently serving production. Giving staging real coverage of
 *    migrated slugs needs a staging unified host expressed in the
 *    environment (a second env var), which is deliberately NOT invented
 *    here.
 *
 *    Note the fail-open behavior of normalizeBackendHostPattern is
 *    unchanged and consistent with this: a degenerate pattern already
 *    falls back to the prod pattern, so such a deploy is treated as
 *    production here too.
 *
 * 2. NO-NEW-INFORMATION. A `backend_url` whose host is still the
 *    per-slug default host is just the value generate-registry.ts
 *    synthesized from the pattern; it says nothing the pattern does not.
 *    Ignoring it keeps the existing precedence — and today EVERY slug is
 *    in this state (no manifest sets backend_url), so nothing changes
 *    until a slug actually migrates.
 */
function registryBackendOverride(
  slug: string,
  pattern: string,
  registryBackendUrl: string | undefined,
): string | undefined {
  if (registryBackendUrl === undefined) return undefined;
  // Same paste-artifact tolerance the other two paths apply.
  const raw = registryBackendUrl.trim();
  if (raw.length === 0) return undefined;

  // Called BEFORE any early return so the SLUG_RE host-injection assert
  // inside backendUrlFromPattern still covers this precedence path — a
  // path that returns early would otherwise skip the one choke point
  // every backend URL was supposed to flow through.
  const patternUrl = backendUrlFromPattern(pattern, slug);

  // GATE 1 — staging safety. String equality (not host equality) on
  // purpose: it also catches a path-bearing pattern, whose operator
  // intent would be silently discarded by preferring the registry value.
  const defaultUrl = backendUrlFromPattern(DEFAULT_BACKEND_HOST_PATTERN, slug);
  if (patternUrl !== defaultUrl) return undefined;

  const parsed = parseBackendBaseUrl(raw);
  if (parsed === undefined) {
    warnRegistryBackendOnce(
      `bad:${slug}:${raw}`,
      `for "${slug}" (${JSON.stringify(raw)}) must be an http(s) URL with ` +
        `an explicit "scheme://" and no userinfo, query, or fragment — ` +
        `ignoring it and deriving from the host pattern instead.`,
    );
    return undefined;
  }

  // GATE 2 — no new information. `defaultUrl` parses by construction
  // (DEFAULT_BACKEND_HOST_PATTERN is a literal bare host and the slug
  // passed SLUG_RE), so the optional chain is belt-and-braces.
  if (parsed.host === parseUrl(defaultUrl)?.host) return undefined;

  return backendBaseUrlString(parsed);
}

/**
 * Resolve an integration's backend base URL. Precedence:
 *
 * 1. a local-dev override from NEXT_PUBLIC_LOCAL_BACKENDS;
 * 2. the slug's registry `backend_url`, but ONLY when it is a deliberate
 *    migration override — see registryBackendOverride for the two gates
 *    and the staging reasoning;
 * 3. the runtime host pattern.
 *
 * `registryBackendUrl` is OPTIONAL: callers that do not have the
 * registry entry to hand (and every caller that predates the unified
 * frontend) omit it and get the pattern-derived URL, unchanged.
 *
 * The returned base may carry a PATH (`https://<host>/<slug>`), and
 * never a trailing slash — consumers concatenate demo routes that start
 * with "/", so exactly one slash lands at the join.
 */
export function resolveBackendUrl(
  slug: string,
  pattern: string,
  registryBackendUrl?: string,
): string {
  const local = localBackendOverride(slug);
  if (local !== undefined) return local;
  return (
    registryBackendOverride(slug, pattern, registryBackendUrl) ??
    backendUrlFromPattern(pattern, slug)
  );
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
