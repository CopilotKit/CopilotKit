import { createMDX } from "fumadocs-mdx/next";
import { nextConfigRedirects } from "./src/lib/redirects/next-config-redirects.mjs";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,

  // --- Legacy URL redirects (ported from showcase/shell-docs) -------------
  // The table lives in src/lib/redirects/next-config-redirects.mjs; the
  // middleware-side table runs in src/proxy.ts after these.
  async redirects() {
    return nextConfigRedirects;
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
