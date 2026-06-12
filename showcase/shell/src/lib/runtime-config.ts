// Server-side runtime config for the showcase shell.
//
// This module reads URL / analytics env values at REQUEST time. Note
// the import boundary is NOT the protective mechanism here: `next/cache`
// is imported at module top level, so any bundle that pulls in this
// module (including the Edge middleware bundle, via
// getRuntimeConfigForMiddleware below) already contains it — and the
// build succeeds. The real hazard is CALLING `unstable_noStore()` in a
// scope that has no Next.js request store (Edge middleware, or any
// non-render scope): the call throws at runtime. The middleware wrapper
// below therefore skips the CALL, not the import.
//
// Client components must use runtime-config.client.ts instead — not
// because this module fails their build, but because the server env
// vars it reads (BASE_URL, DOCS_HOST, ...) are not exposed to the
// browser (a client render would see the dev/sentinel fallbacks) and
// calling noStore() during a client render throws. The client reader
// consumes window.__SHOWCASE_CONFIG__ which the root layout injects.

// Build-time guard (mirror of the `client-only` import in
// runtime-config.client.ts): importing this module from a Client
// Component bundle previously failed SILENTLY — the browser doesn't
// have the server env vars, so a client consumer would render the
// dev/sentinel fallbacks with no signal. `server-only` turns that
// mistake into a Next.js build error. It only errors in CLIENT bundles:
// the RSC layer and the middleware/Edge layer resolve the package's
// empty `react-server` export (verified via `next build` — middleware
// imports this module through getRuntimeConfigForMiddleware). Vitest
// resolves it to the same empty marker via a resolve.alias in
// vitest.config.ts (plain Node hits the throwing `default` export).
import "server-only";

import { unstable_noStore as noStore } from "next/cache";
import {
  DEFAULT_BACKEND_HOST_PATTERN,
  SCHEME_RE,
  normalizeBackendHostPattern,
} from "./backend-url";

export interface RuntimeConfig {
  /** Canonical shell base URL — used for canonical hrefs, OG metadata, etc. */
  baseUrl: string;
  /** PostHog host — middleware ships seo_redirect events here. */
  posthogHost: string;
  /**
   * Backend host pattern — `{slug}` is the only placeholder. Used to
   * derive each integration's backend URL at request time instead of
   * trusting the registry value baked at Docker build (which froze
   * prod hostnames into every image — staging iframed prod). Same
   * semantics as SHOWCASE_BACKEND_HOST_PATTERN in
   * scripts/generate-registry.ts: host only, `https://` is prepended
   * by the consumer (see lib/backend-url.ts).
   */
  backendHostPattern: string;
  /** Docs shell host — middleware 308s /docs, /ag-ui, /reference and framework-slug routes here. */
  docsHost: string;
  /**
   * PostHog project API key — middleware authenticates capture calls
   * with it. Optional: legitimately absent on non-production deploys
   * (capture is disabled, with a warn in middleware). PostHog project
   * keys are public-by-design (they ship in client bundles), so this
   * field riding along in the root layout's window.__SHOWCASE_CONFIG__
   * injection is safe. Optional in the type for the same reason —
   * absence is a valid state, not a wiring bug.
   */
  posthogKey?: string;
}

// Sentinel for a missing prod BASE_URL. Must be a normal hierarchical
// https URL (parity with the client reader's `.invalid` sentinel) — the
// previous `about:blank#...` form was an opaque-path URL, and
// `new URL(path, baseUrl)` THROWS on opaque bases, so the sentinel
// itself would 500 any consumer composing URLs. `.invalid` is reserved
// by RFC 2606, so the breakage stays visible without resolving anywhere.
// Declared WITHOUT a trailing slash — consumers receive it exactly as
// written (the previous slash-bearing form was stripped at every exit
// path, so the declared value never appeared anywhere).
const PROD_INVALID_BASE_URL = "https://shell-base-url-missing.invalid";

// Defaults reproduce today's baked prod values exactly, so a deploy
// with neither env var set (i.e. current prod) behaves byte-identically.
// DEFAULT_BACKEND_HOST_PATTERN moved to backend-url.ts (its normalizer
// falls back to it, and defining it here would create an import cycle)
// — re-exported to keep this module's public surface unchanged.
export { DEFAULT_BACKEND_HOST_PATTERN };
export const DEFAULT_DOCS_HOST = "https://docs.showcase.copilotkit.ai";

/**
 * Sentinel docs host meaning "docs redirects are DISABLED for this
 * deploy". Returned by readDocsHost when NO usable docs host exists:
 * the configured value was rejected for pointing at the shell's own
 * host AND the DEFAULT_DOCS_HOST fallback has the same defect (the
 * shell is deployed AT the docs host — e.g. DOCS_HOST unset on that
 * very service). Falling back to the default there would re-create the
 * exact redirect loop the self-host guard exists to prevent.
 *
 * CONSUMER CONTRACT (middleware / docs-redirects): when
 * `config.docsHost === DOCS_REDIRECTS_DISABLED_HOST`, skip the
 * docs-host redirect step entirely (resolveDocsHostRedirect's callers
 * must not issue 308s to this host). The value is a normal parseable
 * https URL so incidental `new URL(docsHost)` consumers don't throw,
 * and uses the RFC-2606-reserved `.invalid` TLD so it can never
 * resolve if a redirect slips through anyway.
 */
export const DOCS_REDIRECTS_DISABLED_HOST =
  "https://docs-redirects-disabled.invalid";
// Historic default — matches the previous middleware behavior.
export const DEFAULT_POSTHOG_HOST = "https://eu.i.posthog.com";

/**
 * Resolve the runtime config for shell. Called by the root layout and
 * by middleware (via the wrapper below) — both on every request, and
 * each CALL re-reads process.env (no value caching; the only module
 * state is the warn-once log guards).
 *
 * Fail-loud strategy mirrors shell-dashboard: in production, missing
 * URL env vars produce sentinel URLs (visible breakage) AND a
 * console.error; in dev, we fall back to localhost so iteration is
 * frictionless. Analytics keys (posthogHost) use the dev fallback
 * unconditionally — historic POSTHOG_HOST default is the EU cloud.
 *
 * `opts.noStore` (default `true`) controls whether to call
 * `unstable_noStore()`. The Node.js server runtime needs the opt-out so
 * Next.js does not statically prerender callers and freeze the URLs into
 * the build artifact. Middleware MUST pass `{ noStore: false }`: the
 * `next/cache` IMPORT is fine in the Edge bundle (the build proves it),
 * but CALLING `unstable_noStore()` outside a Node.js render scope
 * throws at runtime — and middleware always runs per-request by
 * definition, so there is no static cache to opt out of anyway. The
 * thin `getRuntimeConfigForMiddleware()` wrapper below makes this
 * explicit at the call site.
 */
export function getRuntimeConfig(
  opts: { noStore?: boolean } = {},
): RuntimeConfig {
  if (opts.noStore !== false) noStore();
  const isProd = process.env.NODE_ENV === "production";

  const baseUrl = validateBaseUrl(
    readUrl(
      "BASE_URL",
      isProd ? PROD_INVALID_BASE_URL : "http://localhost:3000",
      isProd,
    ),
    isProd,
  );
  // PostHog host: legitimately absent on non-production deploys; never
  // log a FATAL-CONFIG when UNSET. A SET-but-broken value is still
  // validated (scheme prepend, degenerate-host rejection) — see
  // readPosthogHost.
  const posthogHost = readPosthogHost(isProd);
  // PostHog project key: same readEnvPair semantics as every other env
  // value (trim + NEXT_PUBLIC_ fallback). Middleware previously read
  // process.env.POSTHOG_KEY raw, bypassing both.
  const posthogKey = readEnvPair("POSTHOG_KEY");

  // Both URL-routing values have legitimate prod defaults — unset env
  // means "production behavior", so (like POSTHOG_HOST) they never log
  // FATAL-CONFIG. Staging/preview deploys override them per-request via
  // SHOWCASE_BACKEND_HOST_PATTERN / DOCS_HOST service variables.
  //
  // backendHostPattern is a host *pattern*, not a URL — don't run it
  // through readKey/readUrl (`{slug}` must survive untouched). It IS
  // normalized against common env misconfigs (leading scheme, trailing
  // slash, missing `{slug}`) with warn-once guards — see
  // normalizeBackendHostPattern in lib/backend-url.ts.
  const backendHostPattern = normalizeBackendHostPattern(
    readEnvPair("SHOWCASE_BACKEND_HOST_PATTERN") ??
      DEFAULT_BACKEND_HOST_PATTERN,
  );
  const docsHost = readDocsHost(baseUrl, isProd);

  return { baseUrl, posthogHost, backendHostPattern, docsHost, posthogKey };
}

// Loopback hostnames that can never serve TLS on a local dev port —
// scheme-less values pointing at them get http:// prepended instead of
// https:// (see ensureScheme). The WHATWG URL hostname for an IPv6
// literal keeps its brackets, hence the `[::1]` form.
const LOOPBACK_HOSTNAME_RE = /^(localhost|127\.0\.0\.1|\[::1\])$/i;

function isLoopbackHostValue(value: string): boolean {
  // Probe-parse with https:// to extract the hostname; an unparseable
  // value is not loopback (the caller's validation rejects it later).
  try {
    return LOOPBACK_HOSTNAME_RE.test(new URL(`https://${value}`).hostname);
  } catch {
    return false;
  }
}

// Prepend a scheme to scheme-less host values so downstream
// `new URL(...)` / fetch consumers don't throw on a host-only env value.
// https:// by default; http:// for loopback hosts — the documented
// local-dev DOCS_HOST wiring (`localhost:3005`) would otherwise become
// a TLS-failing https destination with zero warn. The loopback prepend
// serves DEV only: validateBaseUrl/readDocsHost reject loopback hosts
// outright in production (POSTHOG_HOST deliberately keeps them — a
// loopback capture proxy degrades analytics, not the site).
function ensureScheme(value: string): string {
  if (SCHEME_RE.test(value)) return value;
  return isLoopbackHostValue(value) ? `http://${value}` : `https://${value}`;
}

// NOTE on once-guard scope: every warn/error once-guard Set in this
// module is per-ISOLATE module state. The Node server and the Edge
// middleware runtime each instantiate their own copy (and a restart
// resets them), so a misconfig can log once per isolate rather than
// once globally. Intended: bounded repetition beats lost signal.

// One loud log per distinct (mode, malformed BASE_URL value) — not per
// request.
const baseUrlInvalidLogged = new Set<string>();
// One warn per distinct (mode, origin-normalized BASE_URL value) —
// mode-prefixed for consistency with every other guard key in this
// module, even though the warn's text is mode-independent.
const baseUrlNormalizedLogged = new Set<string>();

/**
 * Validate the BASE_URL value AFTER the unset-fallback resolution.
 * readUrl only covers the UNSET case — a SET-but-malformed value
 * (scheme-less `shell.copilotkit.ai`, or a bare `https://` that the
 * trailing-slash strip reduces to `https:`) previously passed through
 * unvalidated, and every consumer composing `new URL(path, baseUrl)`
 * threw: opaque 500s with NO log, because the env var IS set so the
 * unset-fallback (and its FATAL-CONFIG log) never fires. Same hardening
 * as its siblings (readDocsHost / readPosthogHost) — the scheme and
 * degenerate-host rejections originated there; the userinfo rejection
 * (3) originated HERE and is mirrored into both siblings:
 *
 * 1. scheme-less host-only values get `https://` prepended (fixable
 *    misconfig — no log);
 * 2. non-http(s) schemes are rejected: `ftp://x` parses fine, and the
 *    SCHEME_RE dot-scheme edge (`example.com://oops`) parses with
 *    protocol "example.com:" — neither can serve consumers composing
 *    http(s) URLs;
 * 3. userinfo-bearing values are rejected: `mailto:ops@x` lacks `://`
 *    so the prepend yields `https://mailto:ops@x` (userinfo
 *    "mailto:ops") — a base URL carrying credentials is always a
 *    misconfig;
 * 4. degenerate values that parse but carry no real host (`https://` →
 *    `https:` → hostname "https") are rejected — and in PRODUCTION,
 *    loopback hosts are rejected too: the dev-only http:// prepend
 *    (ensureScheme) must not silently point a prod deploy's canonical
 *    URLs at localhost;
 * 5. a path/query/fragment is normalized to the origin with one warn —
 *    consumers compose paths against this value, so subpath deploys
 *    are deliberately UNSUPPORTED (composition would drop the subpath
 *    silently anyway);
 * 6. anything unusable falls back with a once-guarded log NAMING the
 *    bad value — in production the `.invalid` sentinel plus a
 *    FATAL-CONFIG error (Railway guidance); in dev the localhost
 *    fallback plus a console.warn (the module's frictionless-dev
 *    contract — the prod sentinel and Railway guidance are useless on
 *    a laptop).
 */
function validateBaseUrl(value: string, isProd: boolean): string {
  const candidate = ensureScheme(value);
  let reason: string;
  try {
    const parsed = new URL(candidate);
    if (!/^https?:$/i.test(parsed.protocol)) {
      reason = `uses unsupported scheme "${parsed.protocol}" (consumers compose http(s) URLs against it)`;
    } else if (parsed.username !== "" || parsed.password !== "") {
      reason = `carries userinfo credentials after the https:// prepend (e.g. a mailto: value)`;
    } else if (!parsed.hostname || /^https?$/i.test(parsed.hostname)) {
      reason = `carries no usable host (a bare scheme like "https://")`;
    } else if (isProd && LOOPBACK_HOSTNAME_RE.test(parsed.hostname)) {
      // The loopback http:// prepend (ensureScheme) exists for
      // frictionless DEV — in production it would silently "fix"
      // BASE_URL=localhost:3000 and run canonical hrefs, OG metadata,
      // and the docs loop guard against localhost with zero log.
      reason =
        `points at loopback host "${parsed.hostname}" in a production ` +
        `deploy (canonical URLs, OG metadata, and the docs loop guard ` +
        `would all target localhost)`;
    } else if (
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      const normalizedLogKey = `${isProd ? "prod" : "dev"}:${value}`;
      if (!baseUrlNormalizedLogged.has(normalizedLogKey)) {
        baseUrlNormalizedLogged.add(normalizedLogKey);
        // eslint-disable-next-line no-console
        console.warn(
          `[shell runtime-config] BASE_URL ${JSON.stringify(value)} carries a ` +
            `path/query/fragment — consumers compose paths against this value ` +
            `(subpath deploys are unsupported), so the extra parts would ` +
            `corrupt every composed URL; using origin ${parsed.origin}.`,
        );
      }
      return parsed.origin;
    } else {
      // Parsed-normalized form, not the raw candidate: the value is
      // guaranteed origin-only here (path/query/fragment branch above),
      // and the raw form leaks un-normalized spellings (uppercase
      // hosts, explicit default ports) to every consumer while internal
      // comparisons use parsed forms.
      return parsed.origin;
    }
  } catch {
    reason = "is not a parseable URL (even after prepending https://)";
  }
  const fallback = isProd ? PROD_INVALID_BASE_URL : "http://localhost:3000";
  const logKey = `${isProd ? "prod" : "dev"}:${value}`;
  if (!baseUrlInvalidLogged.has(logKey)) {
    baseUrlInvalidLogged.add(logKey);
    if (isProd) {
      // eslint-disable-next-line no-console
      console.error(
        `[shell runtime-config] FATAL-CONFIG: BASE_URL ${JSON.stringify(value)} ${reason}; ` +
          `using sentinel ${fallback}. Fix the BASE_URL env var on the Railway service.`,
      );
    } else {
      // eslint-disable-next-line no-console
      console.warn(
        `[shell runtime-config] BASE_URL ${JSON.stringify(value)} ${reason}; ` +
          `using dev fallback ${fallback}.`,
      );
    }
  }
  return fallback;
}

// One warn per distinct (mode, bad POSTHOG_HOST value) — not per
// request. Mode-prefixed for consistency with every other guard key in
// this module (the warn's text is mode-independent).
const posthogHostInvalidLogged = new Set<string>();
// One warn per distinct (mode, query/fragment-normalized POSTHOG_HOST
// value).
const posthogHostNormalizedLogged = new Set<string>();

/**
 * Read POSTHOG_HOST with the same degenerate-host rejection readDocsHost
 * has: `POSTHOG_HOST="https://"` strips to `https:`, ensureScheme yields
 * `https://https:`, and that PARSES (hostname "https") — every capture
 * fetch then dies on DNS. Middleware warn-onces per capture-failure
 * class (see warnCaptureFailureOnce in src/middleware.ts), so the
 * breakage would be LOGGED — but capture stays down until the value is
 * fixed, hence the validation here. Differences from readDocsHost,
 * both deliberate:
 *
 * - a non-root PATH is preserved: path-based PostHog reverse proxies
 *   (e.g. `https://proxy.example.com/ingest`) are a documented pattern,
 *   so a path here is legitimate config — but a query/fragment IS
 *   stripped (with one warn), since it corrupts every composed capture
 *   URL;
 * - the fallback logs console.warn, not FATAL-CONFIG console.error —
 *   broken analytics degrade reporting, they don't break the site.
 */
function readPosthogHost(isProd: boolean): string {
  const raw = readKey("POSTHOG_HOST", DEFAULT_POSTHOG_HOST);
  const candidate = ensureScheme(raw);
  // isProd feeds only the guard keys (the module-wide mode-prefixed
  // convention) — the warn level and text are mode-independent here.
  const logKey = `${isProd ? "prod" : "dev"}:${raw}`;
  // Branched rejection reason (same labeling readDocsHost has): the
  // previous catch-all warn claimed every rejected value "is not a
  // usable http(s) URL (even after prepending https://)" — false twice
  // for `ftp://ph.x` (it parsed fine, and no prepend happened) and for
  // the degenerate bare-scheme value (it parses too).
  let reason: string;
  try {
    const parsed = new URL(candidate);
    if (!/^https?:$/i.test(parsed.protocol)) {
      reason = `uses unsupported scheme "${parsed.protocol}" (capture calls must target an http(s) host)`;
    } else if (parsed.username !== "" || parsed.password !== "") {
      // Same userinfo rejection validateBaseUrl/readDocsHost have: the
      // Fetch spec forbids credentialed request URLs, so a userinfo-
      // bearing host makes EVERY capture fetch throw a TypeError that
      // middleware misattributes as a net-class failure.
      reason =
        `carries userinfo credentials after the https:// prepend (e.g. a ` +
        `mailto: value) — the Fetch spec forbids credentialed URLs, so ` +
        `every capture call would throw`;
    } else if (!parsed.hostname || /^https?$/i.test(parsed.hostname)) {
      reason = `carries no usable host (a bare scheme like "https://")`;
    } else if (parsed.search !== "" || parsed.hash !== "") {
      // Strip query/fragment but KEEP the path (reverse-proxy ingest
      // paths are documented config) — capture URLs are composed
      // against this value, and a `?x=1`/`#frag` corrupts every
      // capture into a persistent root-POST with misattributed
      // http-class warns from middleware.
      if (!posthogHostNormalizedLogged.has(logKey)) {
        posthogHostNormalizedLogged.add(logKey);
        // eslint-disable-next-line no-console
        console.warn(
          `[shell runtime-config] POSTHOG_HOST ${JSON.stringify(raw)} carries a ` +
            `query/fragment — capture URLs are composed against this value, ` +
            `so the extra parts would corrupt every capture call; using ` +
            `${(parsed.origin + parsed.pathname).replace(/\/+$/, "")} (path kept ` +
            `for reverse-proxy setups).`,
        );
      }
      return (parsed.origin + parsed.pathname).replace(/\/+$/, "");
    } else {
      // Parsed-normalized form (origin + path), not the raw candidate:
      // query/fragment are empty here, so this is the whole URL — and the
      // raw form leaks un-normalized spellings (uppercase hosts, explicit
      // default ports) into every composed capture URL. The trailing-slash
      // strip preserves the readKey contract for a bare "/" pathname.
      return (parsed.origin + parsed.pathname).replace(/\/+$/, "");
    }
  } catch {
    reason = "is not a parseable URL (even after prepending https://)";
  }
  if (!posthogHostInvalidLogged.has(logKey)) {
    posthogHostInvalidLogged.add(logKey);
    // eslint-disable-next-line no-console
    console.warn(
      `[shell runtime-config] POSTHOG_HOST ${JSON.stringify(raw)} ${reason}; ` +
        `falling back to ${DEFAULT_POSTHOG_HOST}. Fix the POSTHOG_HOST env ` +
        `var on the Railway service.`,
    );
  }
  return DEFAULT_POSTHOG_HOST;
}

// Strip the trailing dot of a fully-qualified (root-anchored) hostname
// from a URL authority for comparison purposes: `shell.example.com.`
// and `shell.example.com` are the SAME authority to DNS and browsers.
// The lookahead keeps a port intact (`shell.example.com.:8080` →
// `shell.example.com:8080`); only the hostname's terminal dot matches.
function stripTrailingHostDot(host: string): string {
  return host.replace(/\.(?=$|:)/, "");
}

// One loud log per distinct (mode, shell host, bad DOCS_HOST value) —
// not per request. The shell host is part of the key because the
// message AND the outcome (default fallback vs disabled sentinel)
// depend on it, and it re-reads live BASE_URL: a raw-only key would
// silently swallow an outcome flip to redirects-disabled.
const docsHostFallbackLogged = new Set<string>();
// One warn per distinct (mode, origin-normalized DOCS_HOST value).
const docsHostNormalizedLogged = new Set<string>();

/**
 * Read DOCS_HOST defensively. Middleware composes redirect destinations
 * from this value and hands them to `new URL(...)` (docs-redirects also
 * re-normalizes the host on its side — this is defense-in-depth, not
 * the only guard), so an unparseable value would 500 ALL docs traffic.
 * Hardening steps:
 *
 * 1. A scheme-less, host-only value (e.g. `docs-staging.example.com`)
 *    gets `https://` prepended. This is a likely misconfig: the sibling
 *    SHOWCASE_BACKEND_HOST_PATTERN var is documented as scheme-less,
 *    and an operator can easily carry that format over.
 * 2. Non-http(s) schemes (e.g. `ftp://docs.x`) parse fine but can never
 *    serve as a redirect destination — rejected.
 * 3. Degenerate values that parse but carry no real host (e.g.
 *    `DOCS_HOST="https://"`, which strips to `https:` and yields a
 *    "host" of `https`) are rejected. In PRODUCTION, loopback hosts are
 *    rejected too — the dev-only http:// prepend (ensureScheme) must
 *    not silently 308 a prod deploy's docs traffic to localhost.
 * 4. A value pointing at the shell's OWN host is rejected: the redirect
 *    table has self-referential path entries (/faq → /faq etc.) that
 *    terminate only because the destination host differs — same-host
 *    docs redirects loop (ERR_TOO_MANY_REDIRECTS) on ~15 paths. The
 *    comparison uses the full authority (URL.host, i.e. hostname:port),
 *    not the hostname: localhost:3000 → localhost:3005 is the
 *    documented local-dev wiring and must keep working. Both sides are
 *    normalized through stripTrailingHostDot — a trailing-dot FQDN
 *    spelling (`shell.example.com.`) is the same authority and loops
 *    the same.
 * 5. A value carrying a path, query, or fragment is normalized to its
 *    origin with one warn: docs-redirects composes destination paths
 *    against this value, so the extra parts would silently corrupt
 *    EVERY redirect (a `#frag` swallows the path entirely — all
 *    redirects land on the docs root).
 * 6. If the value isn't usable, log loudly once — with a reason that
 *    matches the actual rejection, not a catch-all "not parseable"
 *    mislabel — and fall back to the default docs host:
 *    degraded-but-working docs redirects beat a sitewide docs 500.
 *    Same dev-vs-prod branch as validateBaseUrl: in production the log
 *    is a FATAL-CONFIG console.error with Railway guidance; in dev it
 *    is a console.warn (the Railway guidance is useless on a laptop).
 *    The fallback VALUE is identical in both modes.
 */
function readDocsHost(baseUrl: string, isProd: boolean): string {
  // Best-effort shell authority for the loop guard — baseUrl has been
  // through validateBaseUrl, but guard the parse anyway. Normalized via
  // stripTrailingHostDot (as is every authority this is compared to):
  // a trailing-dot FQDN spelling on either side is the SAME authority
  // to DNS and browsers, so it loops the same.
  let shellHost: string | undefined;
  try {
    shellHost = stripTrailingHostDot(new URL(baseUrl).host);
  } catch {
    shellHost = undefined;
  }
  // Read the env pair directly (same trim/fallback semantics as
  // readKey) so the fallback path below can branch its FATAL message on
  // set-vs-unset — with DOCS_HOST unset on a shell deployed AT the docs
  // host, "DOCS_HOST <default> points at the shell's own host" sends
  // the operator hunting for an env var that does not exist.
  const envValue = readEnvPair("DOCS_HOST");
  const raw = (envValue ?? DEFAULT_DOCS_HOST).replace(/\/+$/, "");
  const candidate = ensureScheme(raw);
  // Branched rejection reason: the previous catch-all labeled values
  // that DID parse (degenerate host) as "not a parseable URL", sending
  // the operator hunting for a syntax error that isn't there.
  let reason: string;
  try {
    const parsed = new URL(candidate);
    if (!/^https?:$/i.test(parsed.protocol)) {
      reason = `uses unsupported scheme "${parsed.protocol}" (docs redirect destinations must be http/https)`;
    } else if (parsed.username !== "" || parsed.password !== "") {
      // Same userinfo rejection validateBaseUrl has: a credentialed
      // DOCS_HOST lands userinfo in every 308 Location header, which
      // browsers strip or silently block — docs redirects break with
      // zero signal.
      reason = `carries userinfo credentials after the https:// prepend (e.g. a mailto: value) — browsers strip or block credentialed redirect destinations`;
    } else if (!parsed.hostname || /^https?$/i.test(parsed.hostname)) {
      // `DOCS_HOST="https://"` slips through parsing: this function's
      // own trailing-slash strip (the `raw` computation above) reduces
      // it to "https:", ensureScheme yields "https://https:", and the
      // URL parses with hostname "https". Reject empty/scheme-word
      // hosts so the loud fallback fires instead.
      reason = `carries no usable host (a bare scheme like "https://")`;
    } else if (isProd && LOOPBACK_HOSTNAME_RE.test(parsed.hostname)) {
      // The loopback http:// prepend (ensureScheme) exists for the
      // documented local-dev wiring (`localhost:3005`) — in production
      // it would silently accept a loopback docs host and 308 every
      // docs visitor to localhost.
      reason =
        `points at loopback host "${parsed.hostname}" in a production ` +
        `deploy (every docs redirect would 308 visitors to localhost)`;
    } else if (
      shellHost !== undefined &&
      stripTrailingHostDot(parsed.host) === shellHost
    ) {
      // Authority-only compare, deliberately scheme-INSENSITIVE: an
      // http:// docs host on the shell's https authority hits the same
      // middleware again (one scheme hop, then the same-host loop), so
      // over-flagging the cross-scheme case is the safe direction.
      reason =
        `points at the shell's own host "${shellHost}" — the redirect table's ` +
        `self-referential paths would loop (ERR_TOO_MANY_REDIRECTS)`;
    } else if (
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      const normalizedLogKey = `${isProd ? "prod" : "dev"}:${raw}`;
      if (!docsHostNormalizedLogged.has(normalizedLogKey)) {
        docsHostNormalizedLogged.add(normalizedLogKey);
        // eslint-disable-next-line no-console
        console.warn(
          `[shell runtime-config] DOCS_HOST ${JSON.stringify(raw)} carries a ` +
            `path/query/fragment — docs redirects compose destination paths ` +
            `against this value, so the extra parts would corrupt every ` +
            `redirect; using origin ${parsed.origin}.`,
        );
      }
      return parsed.origin;
    } else {
      // Parsed-normalized form, not the raw candidate: the value is
      // guaranteed origin-only here (path/query/fragment branch above),
      // and the raw form leaks un-normalized spellings (uppercase
      // hosts, explicit default ports) into every redirect destination.
      // parsed.origin never carries a trailing slash, so the strip
      // applied to `raw` above is preserved too.
      return parsed.origin;
    }
  } catch {
    reason = "is not a parseable URL (even after prepending https://)";
  }
  // Re-check the FALLBACK against the shell host before handing it out:
  // the unconditional DEFAULT_DOCS_HOST fallback can carry the same
  // defect the configured value was just rejected for (shell deployed
  // AT the docs host). Without this, the unset-on-the-docs-host case
  // logged a self-contradictory "falling back to <the same looping
  // value>" AND returned the looping value.
  let fallbackCollides = false;
  if (shellHost !== undefined) {
    try {
      fallbackCollides =
        stripTrailingHostDot(new URL(DEFAULT_DOCS_HOST).host) === shellHost;
    } catch {
      fallbackCollides = false;
    }
  }
  const logKey = `${isProd ? "prod" : "dev"}:${shellHost ?? "<unparseable>"}:${raw}`;
  if (!docsHostFallbackLogged.has(logKey)) {
    docsHostFallbackLogged.add(logKey);
    // Core message without log-level dressing — the dev-vs-prod branch
    // below picks the level and (prod only) appends Railway guidance.
    let core: string;
    let guidance: string;
    if (fallbackCollides && envValue === undefined) {
      core =
        `DOCS_HOST is unset and the default ` +
        `docs host ${DEFAULT_DOCS_HOST} points at the shell's own host ` +
        `"${shellHost}" — docs redirects are disabled for this deploy ` +
        `(sentinel ${DOCS_REDIRECTS_DISABLED_HOST}).`;
      guidance = `Set DOCS_HOST on the Railway service to a host other than the shell's.`;
    } else if (fallbackCollides) {
      core =
        `DOCS_HOST ${JSON.stringify(raw)} ${reason}, ` +
        `and the default docs host ${DEFAULT_DOCS_HOST} ALSO points at the ` +
        `shell's own host "${shellHost}" — docs redirects are disabled for ` +
        `this deploy (sentinel ${DOCS_REDIRECTS_DISABLED_HOST}).`;
      guidance = `Fix the DOCS_HOST env var on the Railway service.`;
    } else {
      core =
        `DOCS_HOST ${JSON.stringify(raw)} ${reason}; ` +
        `falling back to ${DEFAULT_DOCS_HOST}.`;
      guidance = `Fix the DOCS_HOST env var on the Railway service.`;
    }
    if (isProd) {
      // eslint-disable-next-line no-console
      console.error(`[shell runtime-config] FATAL-CONFIG: ${core} ${guidance}`);
    } else {
      // eslint-disable-next-line no-console
      console.warn(`[shell runtime-config] ${core}`);
    }
  }
  return fallbackCollides ? DOCS_REDIRECTS_DISABLED_HOST : DEFAULT_DOCS_HOST;
}

/**
 * Middleware variant. Identical semantics to `getRuntimeConfig()`
 * except the `unstable_noStore()` CALL is skipped. To be precise about
 * the mechanism: importing this wrapper pulls `next/cache` into the
 * Edge bundle exactly as importing `getRuntimeConfig` would (the
 * top-level import above is unconditional) and the build succeeds
 * either way. What breaks is CALLING `unstable_noStore()` in a scope
 * with no Next.js request store — it throws at runtime. Middleware
 * always runs per-request by definition, so skipping the call loses
 * nothing. Thin wrapper to keep the body single-sourced.
 *
 * Middleware (`src/middleware.ts`) MUST call this rather than
 * `getRuntimeConfig()` so the noStore() call never executes in the
 * Edge scope.
 */
export function getRuntimeConfigForMiddleware(): RuntimeConfig {
  return getRuntimeConfig({ noStore: false });
}

// Env-name tolerance: deploy configs in the wild use either the bare
// name (e.g. `BASE_URL`) or the `NEXT_PUBLIC_*`-prefixed name. We accept
// either — the primary (passed-in) name wins, with transparent fallback
// to the alternate so a Railway service variable set under the "wrong"
// name still works without redeploy.
function altEnvName(envKey: string): string {
  return envKey.startsWith("NEXT_PUBLIC_")
    ? envKey.slice("NEXT_PUBLIC_".length)
    : `NEXT_PUBLIC_${envKey}`;
}

// Length-aware env coalesce: a deliberately-empty primary (e.g. an
// operator clearing `BASE_URL=""` on a Railway service) must NOT mask a
// populated alternate. Treat empty-string as "unset" and fall through to
// the alternate. Values are .trim()ed — whitespace paste artifacts in
// deploy config (e.g. `BASE_URL=" https://x "`) would otherwise survive
// into URLs/hosts; a whitespace-only value counts as unset.
//
// The dynamic `process.env[key]` reads assume a self-hosted Node runtime
// (next start / Docker): Edge platforms that statically inline only
// LITERAL `process.env.X` reads at build would see undefined here and
// silently fall back to defaults.
function readEnvPair(envKey: string): string | undefined {
  const primary = process.env[envKey]?.trim();
  if (primary && primary.length > 0) return primary;
  const alt = process.env[altEnvName(envKey)]?.trim();
  if (alt && alt.length > 0) return alt;
  return undefined;
}

// One loud log per distinct (mode, env key) — middleware and the root
// layout both call getRuntimeConfig() on EVERY request, so an unset
// BASE_URL in prod would otherwise console.error per request. Mirrors
// the once-guards in readDocsHost and normalizeBackendHostPattern.
const urlFallbackLogged = new Set<string>();

function readUrl(envKey: string, fallback: string, isProd: boolean): string {
  const value = readEnvPair(envKey);
  if (value !== undefined) return value.replace(/\/+$/, "");
  // Strip BEFORE logging so the message names the exact value callers
  // receive — the pre-strip form (trailing slash) never appears anywhere.
  const stripped = fallback.replace(/\/+$/, "");
  const logKey = `${isProd ? "prod" : "dev"}:${envKey}`;
  if (!urlFallbackLogged.has(logKey)) {
    urlFallbackLogged.add(logKey);
    if (isProd) {
      // eslint-disable-next-line no-console
      console.error(
        `[shell runtime-config] FATAL-CONFIG: ${envKey} is unset in a production deploy; ` +
          `using sentinel ${stripped}. Set the env var on the Railway service.`,
      );
    } else {
      // eslint-disable-next-line no-console
      console.warn(
        `[shell runtime-config] ${envKey} unset; using dev fallback ${stripped}`,
      );
    }
  }
  return stripped;
}

// Analytics keys (POSTHOG_HOST etc.) are legitimately absent on
// non-production envs; do NOT log a FATAL-CONFIG warning when missing.
function readKey(envKey: string, fallback: string): string {
  const value = readEnvPair(envKey);
  if (value !== undefined) return value.replace(/\/+$/, "");
  return fallback.replace(/\/+$/, "");
}
