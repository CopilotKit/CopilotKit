// Client-side runtime config reader. Reads from
// window.__SHOWCASE_CONFIG__ which the root layout injects via an
// inline <script> tag BEFORE React hydrates (see app/layout.tsx). This
// is the ONLY public API for these URLs in client code — never read
// process.env.NEXT_PUBLIC_* directly (an ESLint rule enforces this).

import type { RuntimeConfig } from "./runtime-config";

export type { RuntimeConfig };

declare global {
  interface Window {
    __SHOWCASE_CONFIG__?: RuntimeConfig;
  }
}

/**
 * Sentinel returned during SSR when `window` is unavailable. "use client"
 * components in the Next.js App Router are server-side rendered on the
 * initial request (that's how the HTML is streamed before hydration),
 * which means their function bodies execute on the server too. We can't
 * throw here without breaking SSR — instead we return a placeholder, and
 * post-hydration the next render reads the real values out of
 * window.__SHOWCASE_CONFIG__. Server components that need the live env
 * values MUST import getRuntimeConfig from runtime-config.ts (the server
 * variant), not this file.
 */
// URL fields use a parseable `https://ssr-placeholder.invalid/` sentinel
// — NOT the empty string — because consumer components may call
// `new URL(cfg.someUrl)` inline during render, and `new URL("")` throws
// a TypeError that escapes the SSR response as a 500. The `.invalid`
// TLD is reserved by RFC 2606 so the URL also can't accidentally
// resolve. Post-hydration the next render reads the real value out of
// window.__SHOWCASE_CONFIG__.
const SSR_PLACEHOLDER_URL = "https://ssr-placeholder.invalid/";
const SSR_PLACEHOLDER: RuntimeConfig = {
  pocketbaseUrl: SSR_PLACEHOLDER_URL,
  shellUrl: SSR_PLACEHOLDER_URL,
  opsBaseUrl: SSR_PLACEHOLDER_URL,
};

/**
 * Returns the runtime config injected by the root server layout.
 *
 * During SSR (no window) returns a sentinel placeholder; client code
 * re-reads after hydration and gets the real values. If the inline
 * <script> never runs (a route bypassed the layout, or injection ran
 * with empty inputs), the post-hydration read throws — surfacing the
 * wiring bug loudly rather than silently rendering empty URLs.
 */
export function getRuntimeConfig(): RuntimeConfig {
  if (typeof window === "undefined") {
    // SSR phase — "use client" component bodies execute here too.
    // Return placeholder; hydration will re-render with real values.
    return SSR_PLACEHOLDER;
  }
  const cfg = window.__SHOWCASE_CONFIG__;
  if (!cfg) {
    // The root layout always emits the <script> tag, so a missing
    // value here is a wiring bug (e.g. a route bypassed the layout,
    // or the injection script ran with empty inputs). Surface it
    // loudly rather than silently returning empty strings.
    throw new Error(
      "[runtime-config.client] window.__SHOWCASE_CONFIG__ is missing. " +
        "The root layout must inject runtime config before client mount.",
    );
  }
  return cfg;
}
