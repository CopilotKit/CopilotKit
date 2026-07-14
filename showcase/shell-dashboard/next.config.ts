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
 * === Resolving the shared cell-model fold's internal `.js` specifiers ===
 *
 * The dashboard re-exports the shared cell-model fold from the harness
 * (`src/lib/{cell-model,live-status,staleness,format-ts}.ts` →
 * `../../../harness/src/shared/cell-model/*`). Those fold files are authored
 * for the harness's pure-Node-ESM runtime, so their INTERNAL relative imports
 * carry explicit `.js` extensions (e.g. `import { formatTs } from
 * "./format-ts.js"`). `export *` does NOT rewrite those internal edges, so a
 * bundler sees a literal `./x.js` specifier that only exists on disk as
 * `./x.ts` and fails to resolve. Both bundler paths must be handled:
 *
 * `webpack.resolve.extensionAlias` — covers the `next build` (webpack) path
 * that CI uses. It tells webpack to try the TypeScript sources when a `.js`
 * specifier is requested — the standard bundler complement to TS's NodeNext
 * `.js`-import convention.
 *
 * `turbopack.rules` loader — covers the `next dev --turbopack` path (Turbopack
 * is this package's dev server; see the `dev` script). Turbopack IGNORES the
 * webpack callback AND has NO `extensionAlias` equivalent: mapping a relative
 * `.js` specifier to its `.ts` source is an open, unimplemented feature
 * request (vercel/next.js#82945), and neither `turbopack.resolveAlias` nor
 * `turbopack.resolveExtensions` matches relative specifiers (verified
 * empirically — both leave `Can't resolve './live-status.js'`). The documented
 * community workaround is a transform loader that strips the trailing `.js`
 * from relative specifiers so Turbopack's normal `.ts`/`.tsx`/`.js` extension
 * resolution takes over. The glob scopes the loader to the fold sources ONLY;
 * the fold's on-disk `.js` specifiers are left untouched (they stay correct
 * for the harness's Node-ESM runtime). Remove once #82945 ships parity.
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
  turbopack: {
    rules: {
      // Scope the loader to ONLY the 4 fold module files the dashboard
      // re-exports — NOT the `*.test.ts` / `*.equivalence-fixtures.ts`
      // siblings in the same dir, whose `.js`-bearing string data would be
      // the likeliest corruption target under a source-rewriting loader.
      "**/harness/src/shared/cell-model/{cell-model,live-status,staleness,format-ts}.ts":
        {
          loaders: ["./turbopack-strip-js-ext-loader.cjs"],
        },
    },
  },
};

export default nextConfig;
