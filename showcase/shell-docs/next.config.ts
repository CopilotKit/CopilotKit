import type { NextConfig } from "next";

// NEXT_PUBLIC_BASE_URL is inlined automatically by Next.js at build time
// because of the NEXT_PUBLIC_ prefix. Do NOT re-declare it in an `env` block —
// doing so bakes the build-time value into server code and overrides runtime env.
//
// Fail fast during an actual `next build` if the variable is missing, so we
// never ship broken absolute URLs. Other invocations that also load this
// config (e.g. `next lint`, `next dev`) only warn, because failing them on a
// missing value would be noise — consumers are expected to handle the dev
// fallback themselves (e.g. `process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3003"`).
//
// Use NEXT_PHASE — the Next.js-canonical signal for production builds —
// rather than sniffing process.argv, which is fragile (e.g. broken under
// wrappers, turbo runs, or when invoked programmatically).
const isNextBuild = process.env.NEXT_PHASE === "phase-production-build";

if (!process.env.NEXT_PUBLIC_BASE_URL) {
  if (isNextBuild) {
    throw new Error(
      "NEXT_PUBLIC_BASE_URL is required for `next build` of showcase/shell-docs. " +
        "Set it in the environment (e.g. https://your-domain.example) before running the build.",
    );
  }
  // eslint-disable-next-line no-console
  console.warn(
    "[shell-docs] NEXT_PUBLIC_BASE_URL is not set; consumers should fall back to a sensible dev default (e.g. http://localhost:3003).",
  );
}

// NEXT_PUBLIC_SHELL_URL points at the shell (showcase) host, which owns
// `/integrations` and `/matrix` — the live integration explorer and
// feature-matrix pages. Components use it directly in cross-host hrefs
// (e.g. the top-nav "Integrations" link). Same validation pattern as
// NEXT_PUBLIC_BASE_URL above: fail at `next build` if missing; warn in dev.
if (!process.env.NEXT_PUBLIC_SHELL_URL) {
  if (isNextBuild) {
    throw new Error(
      "NEXT_PUBLIC_SHELL_URL is required for `next build` of showcase/shell-docs. " +
        "Set it to the shell host before running the build.",
    );
  }
  // eslint-disable-next-line no-console
  console.warn(
    "[shell-docs] NEXT_PUBLIC_SHELL_URL is not set; consumers should fall back to a sensible dev default (e.g. http://localhost:3000).",
  );
}

const nextConfig: NextConfig = {};

export default nextConfig;
