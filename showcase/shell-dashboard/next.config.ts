import type { NextConfig } from "next";

/**
 * Next.js config for the dashboard shell.
 *
 * The Status tab calls the showcase-ops HTTP API at the relative path
 * `/api/ops/*`. There is no /api/ops route handler in this app — the path
 * is a deterministic same-origin proxy that this rewrite forwards to the
 * real showcase-ops service. Going same-origin sidesteps two production
 * blockers:
 *   1. showcase-ops has no CORS allowlist for cross-origin browser calls.
 *   2. We don't want the ops base URL inlined into the client bundle (it
 *      would also force `NEXT_PUBLIC_*` exposure semantics).
 *
 * `OPS_BASE_URL` is required at build/start. Without it the rewrite cannot
 * be constructed and the dashboard would silently render "All probes idle"
 * because every `/api/ops/probes` call would 404 against this app.
 */
const nextConfig: NextConfig = {
  async rewrites() {
    const opsBase = process.env.OPS_BASE_URL;
    if (!opsBase) {
      throw new Error(
        "OPS_BASE_URL must be set — see showcase/RAILWAY.md " +
          "(without it, /api/ops/* requests cannot proxy to showcase-ops)",
      );
    }
    // Strip trailing slashes so we never produce `https://host//api/...`
    // (some servers reject the double slash). Mirrors the same
    // normalization in `src/lib/ops-api.ts:resolveBaseUrl` so the
    // server-side rewrite and client-side fetch agree on the URL shape.
    const normalized = opsBase.replace(/\/+$/, "");
    return [
      { source: "/api/ops/:path*", destination: `${normalized}/api/:path*` },
    ];
  },
};

export default nextConfig;
