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
 *
 * `webpack.resolve.extensionAlias`: the dashboard re-exports the shared
 * cell-model fold from the harness (`src/lib/{cell-model,live-status,
 * staleness,format-ts}.ts` → `../../../harness/src/shared/cell-model/*`).
 * Those fold files are authored for the harness's pure-Node-ESM runtime, so
 * their INTERNAL relative imports carry explicit `.js` extensions (e.g.
 * `import { formatTs } from "./format-ts.js"`). `export *` does NOT rewrite
 * those internal edges, so `next build`'s webpack sees a literal `./x.js`
 * specifier that only exists on disk as `./x.ts` and fails to resolve. The
 * extensionAlias tells webpack to try the TypeScript sources when a `.js`
 * specifier is requested — the standard bundler complement to TS's
 * NodeNext `.js`-import convention. This covers the `next build` (webpack)
 * path that CI uses.
 *
 * NOTE ON DEV: the `dev` script runs plain `next dev` (WEBPACK), not
 * `next dev --turbopack`. Turbopack has no `resolve.extensionAlias` parity
 * (Next #82945), so it can't resolve the shared cell-model fold's `.js`→`.ts`
 * specifiers and dev fails with `Can't resolve './live-status.js'`. Webpack
 * dev honours the alias above, so `pnpm dev` resolves the fold and serves.
 * Switch dev back to Turbopack once it ships extensionAlias parity.
 */
const nextConfig: NextConfig = {
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;
