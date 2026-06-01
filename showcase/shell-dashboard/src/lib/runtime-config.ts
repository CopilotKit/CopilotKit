// Server-only runtime config reader. Reads from process.env at REQUEST
// time (not at module load) so a single built artifact can serve
// different URL values across staging vs prod by changing the Railway
// service's env vars — no rebuild required.
//
// `unstable_noStore()` opts the calling segment out of Next.js's static
// cache so reads always reflect the live env. Without it, a server
// component that uses this could be statically rendered at build time
// and freeze the URLs back into the artifact — defeating the runtime
// switch. See Next.js App Router docs on Dynamic Rendering.
//
// This module MUST NOT be imported from client components. The matching
// client-side reader lives in runtime-config.client.ts and reads from
// window.__SHOWCASE_CONFIG__ which the root layout injects.

import { unstable_noStore as noStore } from "next/cache";

export interface RuntimeConfig {
  /** PocketBase backend used by the Status tab live-readers. */
  pocketbaseUrl: string;
  /** Showcase shell host — used to build Demo / Code / docs-shell links. */
  shellUrl: string;
  /**
   * Client DIRECT ops base URL — an opt-in escape hatch for direct
   * cross-origin calls (e.g. local dev hitting a remote harness),
   * sourced from `NEXT_PUBLIC_OPS_DIRECT_BASE_URL`. Defaults to "" so
   * `ops-api.ts:resolveBaseUrl()` falls through to the same-origin
   * `/api/ops` proxy.
   *
   * This is DISTINCT from the server proxy target `OPS_BASE_URL`, which
   * is read directly (server-only) by the Route Handler at
   * `src/app/api/ops/[...path]/route.ts` and is intentionally NEVER
   * injected into the client config — leaking it makes the browser fetch
   * the harness cross-origin (CORS-blocked, wrong path).
   */
  opsBaseUrl: string;
}

const PROD_INVALID_POCKETBASE_URL = "http://pocketbase.invalid";
const PROD_INVALID_SHELL_URL = "about:blank#shell-url-missing";

/**
 * Resolve the runtime config for shell-dashboard. Called once per request
 * by the root layout and by any other server component that needs it.
 *
 * Fail-loud strategy mirrors the prior build-time pb.ts logic: in
 * production, missing env vars produce sentinel URLs (visible breakage)
 * AND a console.error; in dev, we fall back to localhost so iteration is
 * frictionless.
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

  const pocketbaseUrl = readUrl(
    "POCKETBASE_URL",
    isProd ? PROD_INVALID_POCKETBASE_URL : "http://127.0.0.1:8090",
    isProd,
  );
  const shellUrl = readUrl(
    "SHELL_URL",
    isProd ? PROD_INVALID_SHELL_URL : "http://localhost:3000",
    isProd,
  );
  // Client DIRECT ops override — opt-in escape hatch for direct
  // cross-origin calls. Sourced ONLY from the NEXT_PUBLIC_-prefixed
  // client-intended name (NOT the bare server proxy target OPS_BASE_URL,
  // which the Route Handler reads server-side). Defaults to "" in every
  // environment so the client falls through to the same-origin /api/ops
  // proxy unless a developer explicitly opts in. No sentinel and no
  // FATAL-CONFIG: an unset override is the normal production case, not a
  // misconfiguration.
  const opsBaseUrl = (process.env.NEXT_PUBLIC_OPS_DIRECT_BASE_URL ?? "")
    .trim()
    .replace(/\/+$/, "");

  return { pocketbaseUrl, shellUrl, opsBaseUrl };
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
// name (e.g. `OPS_BASE_URL`) or the `NEXT_PUBLIC_*`-prefixed name. We
// accept either — the primary (passed-in) name wins, with transparent
// fallback to the alternate so a Railway service variable set under
// the "wrong" name still works without redeploy.
function altEnvName(envKey: string): string {
  return envKey.startsWith("NEXT_PUBLIC_")
    ? envKey.slice("NEXT_PUBLIC_".length)
    : `NEXT_PUBLIC_${envKey}`;
}

// Length-aware env coalesce: a deliberately-empty primary (e.g. an
// operator clearing `OPS_BASE_URL=""` on a Railway service) must NOT
// mask a populated alternate. Treat empty-string as "unset" and fall
// through to the alternate.
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
      `[shell-dashboard runtime-config] FATAL-CONFIG: ${envKey} is unset in a production deploy; ` +
        `using sentinel ${fallback}. Set the env var on the Railway service.`,
    );
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      `[shell-dashboard runtime-config] ${envKey} unset; using dev fallback ${fallback}`,
    );
  }
  return fallback.replace(/\/+$/, "");
}
