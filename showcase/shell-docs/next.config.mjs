import path from "node:path";
import { createMDX } from "fumadocs-mdx/next";
import { nextConfigRedirects } from "./src/lib/redirects/next-config-redirects.mjs";
import { DOCS_VERSIONS, normalizeBasePath } from "./src/lib/docs-versions.mjs";

const withMDX = createMDX();

// The path this build is served under (src/lib/base-path.ts): "" for the
// stable docs, "/v2" for the 2.x docs. The stable build's proxy (src/proxy.ts)
// forwards the other versions' paths to their deployments at request time.
const basePath = normalizeBasePath(process.env.DOCS_BASE_PATH);
const isStableBuild = basePath === "";

/** The stable version's own prefix (`/v1/*` while 1.x is stable) to the root. */
const stableVersion = DOCS_VERSIONS.find((version) => version.path === "");
const stablePrefixRedirects =
  isStableBuild && stableVersion
    ? [
        { source: `/${stableVersion.id}`, destination: "/", permanent: false },
        {
          source: `/${stableVersion.id}/:path*`,
          destination: "/:path*",
          permanent: false,
        },
      ]
    : [];

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Baseline response headers. No frame or CSP rules: the docs embed live
  // demos and are embedded in turn, so those need their own review.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },

  // Under /v2 (or another version's path) when this build is not the stable
  // docs. Next.js adds it to links, router calls and assets; plain strings
  // use withBasePath (src/lib/base-path.ts).
  ...(basePath ? { basePath } : {}),

  // The build's base path, inlined for src/lib/base-path.ts.
  env: {
    DOCS_BASE_PATH: basePath,
  },

  // The standard catalog imports its samples from ../shared. The Docker build
  // (Dockerfile) has no monorepo lockfile for Turbopack to infer a root from,
  // so name the showcase folder as the root, as shell-docs does.
  turbopack: {
    root: path.join(import.meta.dirname, ".."),
  },

  // The Docker image runs the standalone server: server.js and only the files
  // it traced, not the whole app and its node_modules. Trace from the same
  // root, so the output keeps the showcase/ layout.
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, ".."),

  // --- Legacy URL redirects (ported from showcase/shell-docs) -------------
  // The table lives in src/lib/redirects/next-config-redirects.mjs; the
  // middleware-side table runs in src/proxy.ts after these.
  async redirects() {
    return [...stablePrefixRedirects, ...nextConfigRedirects];
  },
  // --- end legacy URL redirects --------------------------------------------

  // --- Telemetry: PostHog reverse proxy (ported from showcase/shell-docs) --
  // posthog-js posts to /ingest on this host (src/lib/telemetry/analytics.ts),
  // so blockers aimed at *.i.posthog.com don't drop it.
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/ingest/static/:path*",
          destination: "https://eu-assets.i.posthog.com/static/:path*",
        },
        {
          source: "/ingest/:path*",
          destination: "https://eu.i.posthog.com/:path*",
        },
      ],
    };
  },
  // --- end telemetry -------------------------------------------------------
};

export default withMDX(config);
