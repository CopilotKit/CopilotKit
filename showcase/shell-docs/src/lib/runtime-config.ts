// Server-only runtime config reader for shell-docs. Reads from
// process.env at REQUEST time (not at module load) so a single built
// artifact can serve different URL/key values across staging vs prod by
// changing the Railway service's env vars — no rebuild required.
//
// `unstable_noStore()` opts the calling segment out of Next.js's static
// cache so reads always reflect the live env. Without it, a server
// component that uses this could be statically rendered at build time
// and freeze the URLs back into the artifact — which is the entire
// reason this module exists.
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
 *   - URL fields in production (severity=fatal): missing env vars
 *     produce sentinel URLs (or, for `baseUrl`, the canonical prod host
 *     — preserves existing sitemap behavior) AND a console.error
 *     prefixed `FATAL-CONFIG:` (the prefix is what Sentry pattern-
 *     matches for ops alerts).
 *   - URL fields in production with a working default (severity=info,
 *     e.g. intelligenceSignupUrl, posthogHost): console.warn WITHOUT
 *     the `FATAL-CONFIG:` prefix — visible in prod log streams (warn
 *     clears aggregation thresholds; info does not) but does not raise
 *     ops alerts.
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
 * static cache to opt out of. The thin `getRuntimeConfigForMiddleware()`
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
    "fatal",
  );
  const shellUrl = readUrl(
    "NEXT_PUBLIC_SHELL_URL",
    isProd ? PROD_INVALID_SHELL_URL : "http://localhost:3000",
    isProd,
    "fatal",
  );
  // intelligenceSignupUrl: prod fallback IS a real working host
  // (dashboard.operations.copilotkit.ai), not a sentinel — so absence is
  // recoverable. Demote from FATAL-CONFIG to a non-fatal warn (no
  // `FATAL-CONFIG:` prefix → no Sentry alert) so absence does not
  // generate false-positive alerts, but the line still clears prod
  // log-aggregation thresholds and stays operator-visible. Same logic
  // for posthogHost (EU cloud is the default).
  const intelligenceSignupUrl = readUrl(
    "NEXT_PUBLIC_INTELLIGENCE_SIGNUP_URL",
    PROD_DEFAULT_SIGNUP_URL,
    isProd,
    "info",
  );
  const posthogHost = readUrl(
    "NEXT_PUBLIC_POSTHOG_HOST",
    PROD_DEFAULT_POSTHOG_HOST,
    isProd,
    "info",
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
export function getRuntimeConfigForMiddleware(): RuntimeConfig {
  return getRuntimeConfig({ noStore: false });
}

// Env-name tolerance: deploy configs in the wild use either the bare
// name (e.g. `BASE_URL`) or the `NEXT_PUBLIC_*`-prefixed name. We accept
// either — the primary (passed-in) name wins, and we transparently fall
// back to the alternate so a Railway service variable set under the
// "wrong" name still works without redeploy. The pair is computed by
// stripping/adding the `NEXT_PUBLIC_` prefix.
function altEnvName(envKey: string): string {
  return envKey.startsWith("NEXT_PUBLIC_")
    ? envKey.slice("NEXT_PUBLIC_".length)
    : `NEXT_PUBLIC_${envKey}`;
}

// Length-aware env coalesce: a deliberately-empty primary (e.g. an
// operator clearing `NEXT_PUBLIC_SHELL_URL=""` on a Railway service)
// must NOT mask a populated alternate. Treat empty-string as "unset"
// and fall through to the alternate.
function readEnvPair(envKey: string): string | undefined {
  const primary = process.env[envKey];
  if (primary && primary.length > 0) return primary;
  const alt = process.env[altEnvName(envKey)];
  if (alt && alt.length > 0) return alt;
  return undefined;
}

function readUrl(
  envKey: string,
  fallback: string,
  isProd: boolean,
  severity: "fatal" | "info" = "fatal",
): string {
  const value = readEnvPair(envKey);
  if (value !== undefined) return value.replace(/\/+$/, "");
  if (isProd) {
    if (severity === "fatal") {
      // eslint-disable-next-line no-console
      console.error(
        `[shell-docs runtime-config] FATAL-CONFIG: ${envKey} is unset in a production deploy; ` +
          `using fallback ${fallback}. Set the env var on the Railway service.`,
      );
    } else {
      // warn-level: legitimate prod default exists; absence is
      // recoverable so we log but do not raise the FATAL-CONFIG flag
      // that triggers ops alerts. console.warn (not console.info) so
      // the line clears prod log-aggregation thresholds and stays
      // visible to operators.
      // eslint-disable-next-line no-console
      console.warn(
        `[shell-docs runtime-config] ${envKey} unset; using prod default ${fallback}`,
      );
    }
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      `[shell-docs runtime-config] ${envKey} unset; using dev fallback ${fallback}`,
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
  const value = readEnvPair(envKey);
  return value !== undefined ? value : "";
}
