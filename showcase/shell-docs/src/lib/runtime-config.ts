// Server-only runtime config reader for shell-docs. Reads from
// process.env at REQUEST time (not at module load) so a single built
// artifact can serve different URL/key values across staging vs prod by
// changing the Railway service's env vars — no rebuild required.
//
// `unstable_noStore()` opts the calling segment out of Next.js's static
// cache so reads always reflect the live env. Without it, a server
// component that uses this could be statically rendered at build time
// and freeze the URLs back into the artifact (the exact bug Option B
// fixes).
//
// This module MUST NOT be imported from client components. The matching
// client-side reader lives in runtime-config.client.ts and reads from
// window.__SHOWCASE_CONFIG__ which the root layout injects.

import { unstable_noStore as noStore } from "next/cache";

export interface RuntimeConfig {
  /** Canonical docs base URL — sitemap, robots, canonical links. */
  baseUrl: string;
  /** Showcase shell host — search-modal, integration-grid, cross-host hrefs. */
  shellUrl: string;
  /** Intelligence platform signup URL — signup-link, ops-platform-cta. */
  intelligenceSignupUrl: string;
  /** Analytics keys (empty string = analytics disabled in that channel). */
  posthogKey: string;
  posthogHost: string;
  scarfPixelId: string;
  googleAnalyticsTrackingId: string;
  reb2bKey: string;
  reoKey: string;
}

const PROD_BASE_URL_FALLBACK = "https://docs.copilotkit.ai";
const PROD_INVALID_SHELL_URL = "about:blank#shell-url-missing";
const PROD_DEFAULT_SIGNUP_URL = "https://dashboard.operations.copilotkit.ai/";
const PROD_DEFAULT_POSTHOG_HOST = "https://eu.i.posthog.com";

/**
 * Resolve the runtime config for shell-docs. Called once per request by
 * the root layout and by any other server component / route that needs
 * it (sitemap, robots, middleware via the Edge wrapper).
 *
 * Fail-loud strategy:
 *   - URL fields in production: missing env vars produce sentinel
 *     URLs (or, for `baseUrl`, the canonical prod host — preserves
 *     existing sitemap behavior) AND a console.error.
 *   - URL fields in dev: localhost fallbacks + console.warn.
 *   - Analytics keys: empty string fallback in BOTH envs with no log —
 *     analytics keys are legitimately absent in non-production envs and
 *     consumers already no-op on empty.
 *
 * `opts.noStore` (default `true`) controls whether to call
 * `unstable_noStore()`. The Node.js server runtime needs the opt-out
 * so Next.js does not statically prerender callers and freeze the URLs
 * into the build artifact. The Edge runtime (middleware) MUST pass
 * `{ noStore: false }` — `unstable_noStore()` is unavailable there,
 * and middleware always runs per-request by definition so there is no
 * static cache to opt out of. The thin `getRuntimeConfigEdge()`
 * wrapper below makes this explicit at the call site.
 */
export function getRuntimeConfig(
  opts: { noStore?: boolean } = {},
): RuntimeConfig {
  if (opts.noStore !== false) noStore();
  const isProd = process.env.NODE_ENV === "production";

  const baseUrl = readUrl(
    "NEXT_PUBLIC_BASE_URL",
    // baseUrl preserves the prior `https://docs.copilotkit.ai` prod
    // fallback (matches the legacy getBaseUrl() behavior in
    // sitemap-helpers.ts) so a misconfigured deploy still emits a
    // reasonable sitemap rather than a sentinel URL. Logged either way.
    isProd ? PROD_BASE_URL_FALLBACK : "http://localhost:3003",
    isProd,
  );
  const shellUrl = readUrl(
    "NEXT_PUBLIC_SHELL_URL",
    isProd ? PROD_INVALID_SHELL_URL : "http://localhost:3000",
    isProd,
  );
  const intelligenceSignupUrl = readUrl(
    "NEXT_PUBLIC_INTELLIGENCE_SIGNUP_URL",
    // Both prod and dev fall back to the canonical signup host — the
    // historical behavior of the consumer modules (signup-link.tsx,
    // ops-platform-cta.tsx) was to use this URL whenever the env was
    // unset. Logged in prod only.
    PROD_DEFAULT_SIGNUP_URL,
    isProd,
  );
  const posthogHost = readUrl(
    "NEXT_PUBLIC_POSTHOG_HOST",
    PROD_DEFAULT_POSTHOG_HOST,
    isProd,
  );

  return {
    baseUrl,
    shellUrl,
    intelligenceSignupUrl,
    posthogKey: readKey("NEXT_PUBLIC_POSTHOG_KEY"),
    posthogHost,
    scarfPixelId: readKey("NEXT_PUBLIC_SCARF_PIXEL_ID"),
    googleAnalyticsTrackingId: readKey(
      "NEXT_PUBLIC_GOOGLE_ANALYTICS_TRACKING_ID",
    ),
    reb2bKey: readKey("NEXT_PUBLIC_REB2B_KEY"),
    reoKey: readKey("NEXT_PUBLIC_REO_KEY"),
  };
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
export function getRuntimeConfigEdge(): RuntimeConfig {
  return getRuntimeConfig({ noStore: false });
}

function readUrl(envKey: string, fallback: string, isProd: boolean): string {
  const value = process.env[envKey];
  if (value && value.length > 0) return value.replace(/\/+$/, "");
  if (isProd) {
    // eslint-disable-next-line no-console
    console.error(
      `[runtime-config] FATAL-CONFIG: ${envKey} is unset in a production deploy; ` +
        `using fallback ${fallback}. Set the env var on the Railway service.`,
    );
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      `[runtime-config] ${envKey} unset; using dev fallback ${fallback}`,
    );
  }
  return fallback.replace(/\/+$/, "");
}

/**
 * Read an analytics key. Empty/missing values are returned as the empty
 * string with NO log — analytics keys are legitimately absent in
 * non-production envs (the consumer providers no-op when the key is
 * empty), and the existing shell-docs/Dockerfile documents the same
 * behavior. Adding a prod warn here would create alert noise on
 * intentionally analytics-disabled environments.
 */
function readKey(envKey: string): string {
  const value = process.env[envKey];
  return value && value.length > 0 ? value : "";
}
