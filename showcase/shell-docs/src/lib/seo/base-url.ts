import { withBasePath } from "@/lib/base-path";

// The docs' public origin for machine-facing URLs (llms.txt, llms-full.txt,
// sitemap, robots, social cards), ported from shell-docs' `getBaseUrl()`
// (`src/lib/runtime-config.ts`).
//
// Production always names docs.copilotkit.ai, whatever host serves it: a
// preview or provider hostname must never leak into what crawlers and agents
// index. Outside production, `NEXT_PUBLIC_BASE_URL` (or `BASE_URL`) points the
// URLs at a local or test server.

export const PRODUCTION_DOCS_ORIGIN = "https://docs.copilotkit.ai";

const DEV_ORIGIN = "http://localhost:3003";

export function getBaseUrl(): string {
  if (process.env.NODE_ENV === "production") return PRODUCTION_DOCS_ORIGIN;
  // Read with computed keys so Next doesn't inline them at build.
  for (const key of ["NEXT_PUBLIC_BASE_URL", "BASE_URL"]) {
    const value = process.env[key];
    if (value) return value.replace(/\/+$/, "");
  }
  return DEV_ORIGIN;
}

/**
 * An absolute URL on the docs origin for a root-relative path, under this
 * build's base path (`/v2/...` on the 2.x docs).
 */
export function absoluteUrl(path: string): string {
  return `${getBaseUrl()}${withBasePath(path)}`;
}
