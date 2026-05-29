import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

/**
 * Next.js config for the dashboard shell.
 *
 * The Status tab calls the showcase-harness HTTP API at the relative path
 * `/api/ops/*`. There is no /api/ops route handler in this app — the path
 * is a deterministic same-origin proxy that this rewrite forwards to the
 * real showcase-harness service. Going same-origin sidesteps two production
 * blockers:
 *   1. showcase-harness has no CORS allowlist for cross-origin browser calls.
 *   2. We don't want the ops base URL inlined into the client bundle (it
 *      would also force `NEXT_PUBLIC_*` exposure semantics).
 *
 * `OPS_BASE_URL` is required at START — not at build. `next build`
 * evaluates `rewrites()` so route metadata can be persisted into the
 * artifact, AND `next start` evaluates it again at process boot.
 * Throwing at build time would prevent the runtime-injection deploy
 * pattern (single artifact, env supplied at start). So when invoked
 * under the build phase we accept the absence with a sentinel
 * destination — the rewrite is reconstructed with the real env value
 * at start. At start time, missing OPS_BASE_URL still throws loudly to
 * surface the wiring bug.
 *
 * The config is exported as a function `(phase) => NextConfig` so the
 * build-vs-start distinction is reliable without relying on the
 * `NEXT_PHASE` env (which Next.js does not always export to user code).
 */
const SENTINEL_OPS_BASE = "http://ops.invalid";

export default function nextConfig(phase: string): NextConfig {
  const isBuildPhase = phase === PHASE_PRODUCTION_BUILD;
  return {
    async rewrites() {
      const opsBase = process.env.OPS_BASE_URL;
      if (!opsBase) {
        if (isBuildPhase) {
          // Build phase: emit a parseable sentinel destination so
          // `next build` succeeds. `rewrites()` runs again at
          // `next start` with the real env value (or throws below).
          return [
            {
              source: "/api/ops/:path*",
              destination: `${SENTINEL_OPS_BASE}/api/:path*`,
            },
          ];
        }
        throw new Error(
          "OPS_BASE_URL must be set on this Railway service — see showcase/RAILWAY.md " +
            "(without it, /api/ops/* requests cannot proxy to showcase-harness)",
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
}
