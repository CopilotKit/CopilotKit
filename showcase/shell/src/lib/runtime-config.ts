// Server-side runtime config for the showcase shell.
//
// This module reads URL / analytics env values at REQUEST time. It must
// only be imported from server components (and from middleware via the
// Edge-safe wrapper below). Importing it from a client component would
// cause Next.js to inline `next/cache` into the client bundle (build
// fails) and would freeze the URLs back into the artifact — defeating
// the runtime switch. See Next.js App Router docs on Dynamic Rendering.
//
// This module MUST NOT be imported from client components. The matching
// client-side reader lives in runtime-config.client.ts and reads from
// window.__SHOWCASE_CONFIG__ which the root layout injects.

import { unstable_noStore as noStore } from "next/cache";
import { normalizeBackendHostPattern } from "./backend-url";

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
  /** Docs shell host — middleware 301s /docs, /ag-ui, /reference and framework-slug routes here. */
  docsHost: string;
}

const PROD_INVALID_BASE_URL = "about:blank#shell-base-url-missing";

// Defaults reproduce today's baked prod values exactly, so a deploy
// with neither env var set (i.e. current prod) behaves byte-identically.
export const DEFAULT_BACKEND_HOST_PATTERN =
  "showcase-{slug}-production.up.railway.app";
export const DEFAULT_DOCS_HOST = "https://docs.showcase.copilotkit.ai";

/**
 * Resolve the runtime config for shell. Called once per request by the
 * root layout and by middleware (via the Edge wrapper below).
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
 * the build artifact. The Edge runtime (middleware) MUST pass
 * `{ noStore: false }` — `unstable_noStore()` is unavailable there, and
 * middleware always runs per-request by definition so there is no
 * static cache to opt out of. The thin `getRuntimeConfigForMiddleware()` wrapper
 * below makes this explicit at the call site.
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
  // matches the previous middleware behavior.
  const posthogHost = readKey("POSTHOG_HOST", "https://eu.i.posthog.com");

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

// Matches an explicit URL scheme prefix (e.g. `https://`, `http://`).
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

// One loud log per distinct bad DOCS_HOST value — not per request.
const docsHostFallbackLogged = new Set<string>();

/**
 * Read DOCS_HOST defensively. Middleware calls `new URL(docsHost)` on
 * every docs-host route, so an unparseable value would 500 ALL docs
 * traffic. Two hardening steps:
 *
 * 1. A scheme-less, host-only value (e.g. `docs-staging.example.com`)
 *    gets `https://` prepended. This is a likely misconfig: the sibling
 *    SHOWCASE_BACKEND_HOST_PATTERN var is documented as scheme-less,
 *    and an operator can easily carry that format over.
 * 2. If the value still isn't parseable as a URL, log loudly once and
 *    fall back to the default docs host — degraded-but-working docs
 *    redirects beat a sitewide docs 500.
 */
function readDocsHost(): string {
  const raw = readKey("DOCS_HOST", DEFAULT_DOCS_HOST);
  const candidate = SCHEME_RE.test(raw) ? raw : `https://${raw}`;
  try {
    // Parse for validation only — return the string form so trailing-slash
    // stripping (readKey) is preserved.
    new URL(candidate);
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
 * Edge-runtime variant. Identical semantics to `getRuntimeConfig()`
 * except `unstable_noStore()` is skipped — `next/cache`'s no-store
 * helper is not available in the Edge runtime, and middleware always
 * runs per-request by definition so there is no static cache to opt
 * out of. Thin wrapper to keep the body single-sourced.
 *
 * Middleware (`src/middleware.ts`) MUST import this rather than
 * `getRuntimeConfig` — otherwise the Edge bundle pulls in `next/cache`
 * and the build fails with "module not found in edge runtime."
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
// the alternate.
function readEnvPair(envKey: string): string | undefined {
  const primary = process.env[envKey];
  if (primary && primary.length > 0) return primary;
  const alt = process.env[altEnvName(envKey)];
  if (alt && alt.length > 0) return alt;
  return undefined;
}

function readUrl(envKey: string, fallback: string, isProd: boolean): string {
  const value = readEnvPair(envKey);
  if (value !== undefined) return value.replace(/\/+$/, "");
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
  return fallback.replace(/\/+$/, "");
}

// Analytics keys (POSTHOG_HOST etc.) are legitimately absent on
// non-production envs; do NOT log a FATAL-CONFIG warning when missing.
function readKey(envKey: string, fallback: string): string {
  const value = readEnvPair(envKey);
  if (value !== undefined) return value.replace(/\/+$/, "");
  return fallback.replace(/\/+$/, "");
}
