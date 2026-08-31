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
 * throw here without breaking SSR — instead we return a placeholder.
 *
 * The {slug} placeholder is preserved so an SSR-phase substitution still
 * yields a parseable, RFC-2606-unresolvable host (`.invalid`). No iframe
 * ever renders from this: the page gates its preview iframe on a
 * client-mounted flag, so backendHostPattern is only ever read after
 * hydration when window.__SHOWCASE_CONFIG__ carries the real value.
 * Server components that need the live env values MUST import
 * getRuntimeConfig from runtime-config.ts (the server variant).
 */
const SSR_PLACEHOLDER: Readonly<RuntimeConfig> = Object.freeze({
  backendHostPattern: "showcase-{slug}.ssr-placeholder.invalid",
});

/**
 * Returns the runtime config injected by the root server layout.
 *
 * During SSR (no window) returns a sentinel placeholder; the inline
 * <script> runs before hydration, so every client render — including
 * the hydration render — sees the real values. If the inline <script>
 * never ran (a route bypassed the layout) or injected an
 * empty/incomplete object, this read throws — surfacing the wiring bug
 * loudly rather than silently rendering empty URLs.
 */
export function getRuntimeConfig(): Readonly<RuntimeConfig> {
  if (typeof window === "undefined") {
    // SSR phase — "use client" component bodies execute here too.
    // Return placeholder; the hydration render reads the real values.
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
  // Field validation: an injection that ran with empty inputs (layout
  // wired to a broken server read) yields an object that is truthy but
  // useless — fail loud instead of resolving every preview iframe
  // against an empty pattern. The typeof check also catches a layout
  // bug injecting a non-string, which would otherwise explode far from
  // the cause inside backendUrlFromPattern's replaceAll.
  const value = cfg.backendHostPattern;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `[runtime-config.client] window.__SHOWCASE_CONFIG__ is incomplete: ` +
        `field "backendHostPattern" is ${
          typeof value === "string" ? "empty" : `of type ${typeof value}`
        }. The root layout injection ran with broken inputs — check the ` +
        `server-side runtime config.`,
    );
  }
  return Object.freeze(cfg);
}
