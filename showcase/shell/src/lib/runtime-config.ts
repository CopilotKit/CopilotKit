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

import { unstable_noStore as noStore } from "next/cache";
import { SCHEME_RE, normalizeBackendHostPattern } from "./backend-url";

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
}

// Sentinel for a missing prod BASE_URL. Must be a normal hierarchical
// https URL (parity with the client reader's `.invalid` sentinel) — the
// previous `about:blank#...` form was an opaque-path URL, and
// `new URL(path, baseUrl)` THROWS on opaque bases, so the sentinel
// itself would 500 any consumer composing URLs. `.invalid` is reserved
// by RFC 2606, so the breakage stays visible without resolving anywhere.
const PROD_INVALID_BASE_URL = "https://shell-base-url-missing.invalid/";

// Defaults reproduce today's baked prod values exactly, so a deploy
// with neither env var set (i.e. current prod) behaves byte-identically.
export const DEFAULT_BACKEND_HOST_PATTERN =
  "showcase-{slug}-production.up.railway.app";
export const DEFAULT_DOCS_HOST = "https://docs.showcase.copilotkit.ai";

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

  const baseUrl = readUrl(
    "BASE_URL",
    isProd ? PROD_INVALID_BASE_URL : "http://localhost:3000",
    isProd,
  );
  // PostHog host: legitimately absent on non-production deploys; never
  // log a FATAL-CONFIG for it. The historic default (`eu.i.posthog.com`)
  // matches the previous middleware behavior. Scheme-less operator
  // values get https:// prepended (same hardening as readDocsHost) — a
  // scheme-less host would make every middleware capture fetch throw on
  // an unparseable URL, and those failures are deliberately swallowed,
  // so analytics would fail forever and silently.
  const posthogHost = ensureScheme(
    readKey("POSTHOG_HOST", "https://eu.i.posthog.com"),
  );

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
  const docsHost = readDocsHost();

  return { baseUrl, posthogHost, backendHostPattern, docsHost };
}

// Prepend https:// to scheme-less host values so downstream
// `new URL(...)` / fetch consumers don't throw on a host-only env value.
function ensureScheme(value: string): string {
  return SCHEME_RE.test(value) ? value : `https://${value}`;
}

// One loud log per distinct bad DOCS_HOST value — not per request.
const docsHostFallbackLogged = new Set<string>();

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
 * 2. Degenerate values that parse but carry no real host (e.g.
 *    `DOCS_HOST="https://"`, which strips to `https:` and yields a
 *    "host" of `https`) are rejected.
 * 3. If the value isn't usable, log loudly once and fall back to the
 *    default docs host — degraded-but-working docs redirects beat a
 *    sitewide docs 500.
 */
function readDocsHost(): string {
  const raw = readKey("DOCS_HOST", DEFAULT_DOCS_HOST);
  const candidate = ensureScheme(raw);
  try {
    // Parse for validation only — return the string form so trailing-slash
    // stripping (readKey) is preserved.
    const parsed = new URL(candidate);
    // `DOCS_HOST="https://"` slips through parsing: readKey strips the
    // slashes to "https:", ensureScheme yields "https://https:", and
    // the URL parses with hostname "https". Reject empty/scheme-word
    // hosts so the loud fallback fires instead.
    if (!parsed.hostname || /^https?$/i.test(parsed.hostname)) {
      throw new Error("degenerate docs host");
    }
    return candidate;
  } catch {
    if (!docsHostFallbackLogged.has(raw)) {
      docsHostFallbackLogged.add(raw);
      // eslint-disable-next-line no-console
      console.error(
        `[shell runtime-config] FATAL-CONFIG: DOCS_HOST ${JSON.stringify(raw)} is not a ` +
          `parseable URL (even after prepending https://); falling back to ` +
          `${DEFAULT_DOCS_HOST}. Fix the DOCS_HOST env var on the Railway service.`,
      );
    }
    return DEFAULT_DOCS_HOST;
  }
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
  const logKey = `${isProd ? "prod" : "dev"}:${envKey}`;
  if (!urlFallbackLogged.has(logKey)) {
    urlFallbackLogged.add(logKey);
    if (isProd) {
      // eslint-disable-next-line no-console
      console.error(
        `[shell runtime-config] FATAL-CONFIG: ${envKey} is unset in a production deploy; ` +
          `using sentinel ${fallback}. Set the env var on the Railway service.`,
      );
    } else {
      // eslint-disable-next-line no-console
      console.warn(
        `[shell runtime-config] ${envKey} unset; using dev fallback ${fallback}`,
      );
    }
  }
  return fallback.replace(/\/+$/, "");
}

// Analytics keys (POSTHOG_HOST etc.) are legitimately absent on
// non-production envs; do NOT log a FATAL-CONFIG warning when missing.
function readKey(envKey: string, fallback: string): string {
  const value = readEnvPair(envKey);
  if (value !== undefined) return value.replace(/\/+$/, "");
  return fallback.replace(/\/+$/, "");
}
