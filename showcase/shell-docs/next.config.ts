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
const isNextBuild = process.argv.includes("build");

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

const nextConfig: NextConfig = {};

export default nextConfig;
