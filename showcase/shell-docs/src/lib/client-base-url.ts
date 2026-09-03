import { getRuntimeConfig } from "@/lib/runtime-config.client";

/**
 * Resolve the canonical base URL on the client. Reads from
 * window.__SHOWCASE_CONFIG__ (populated by the root layout's inline
 * <script>) so non-production can reflect its runtime base URL without
 * rebuilding the artifact. Production runtime config always injects the
 * public canonical docs origin. The reader strips trailing slashes so callers
 * can concatenate `${BASE}${path}` safely.
 *
 * Not folded into `@/lib/runtime-config.client` itself: that module's
 * `getRuntimeConfig()` is the mockable seam every consuming test stubs
 * directly, and its SSR placeholder intentionally carries a trailing
 * slash (see the comment on `SSR_PLACEHOLDER_URL`) so `new URL()` calls
 * elsewhere in that module's contract keep working. Stripping belongs at
 * this call site, not there.
 *
 * Not reached into from `@/lib/sitemap-helpers` either — that module also
 * pulls in `fs` / `path` / `gray-matter` for sitemap generation, Node-only
 * deps that fail the client bundle when a `"use client"` component reaches
 * for them.
 */
export function getClientBaseUrl(): string {
  return getRuntimeConfig().baseUrl.replace(/\/+$/, "");
}
