import type { NextConfig } from "next";

/**
 * Next.js config for the dashboard shell.
 *
 * The Status tab calls the showcase-harness HTTP API at the relative path
 * `/api/ops/*`. That path is served at REQUEST time by the Route Handler at
 * `src/app/api/ops/[...path]/route.ts`, which reads `OPS_BASE_URL` from the
 * live process env and proxies to `${OPS_BASE_URL}/api/*`.
 *
 * It used to be a `rewrites()` entry, but `next build` freezes `rewrites()`
 * into the prebuilt Docker image — so the placeholder `OPS_BASE_URL` baked at
 * build time was frozen too, and every deploy proxied to a dead host
 * regardless of its runtime env. Moving the proxy into a Route Handler makes
 * `OPS_BASE_URL` runtime-resolved: the single shared image serves each
 * environment's own harness URL with no rebuild. As a result this config no
 * longer reads `OPS_BASE_URL` and `next build` no longer depends on it.
 *
 * Going same-origin (vs. a direct cross-origin browser call) sidesteps two
 * production blockers that remain relevant to the Route Handler too:
 *   1. showcase-harness has no CORS allowlist for cross-origin browser calls.
 *   2. The ops base URL stays out of the client bundle (no `NEXT_PUBLIC_*`
 *      exposure).
 */
const nextConfig: NextConfig = {};

export default nextConfig;
