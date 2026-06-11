// Client-side runtime config reader. Reads from
// window.__SHOWCASE_CONFIG__ which the root layout injects via an
// inline <script> tag BEFORE React hydrates (see app/layout.tsx). This
// is the ONLY public API for these URLs in client code — never read
// process.env.NEXT_PUBLIC_* directly.

// Build-time guard: importing this module from a Server Component
// previously failed SILENTLY — the SSR branch below returns
// placeholders, so a server-side consumer would render permanent
// placeholder URLs with no signal. `client-only` turns that mistake
// into a Next.js build error.
import "client-only";

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
 * Hydration story: the inline <script> in the root layout runs BEFORE
 * React hydrates, so window.__SHOWCASE_CONFIG__ is already populated by
 * the time the hydration render executes — the FIRST client render sees
 * the real values (there is no "post-hydration next render"). The
 * hazard is the opposite direction: the server-rendered HTML was
 * produced with THIS placeholder, so a component that renders a config
 * value directly into markup (text/attribute) will hydrate with a
 * server/client MISMATCH (React warning, possible flash). Consumers
 * that inline config values at render time should read them in an
 * effect/state instead.
 */
// URL fields use a parseable `https://ssr-placeholder.invalid/` sentinel
// — NOT the empty string — because consumer components may call
// `new URL(cfg.someUrl)` inline during render, and `new URL("")` throws
// a TypeError that escapes the SSR response as a 500. The `.invalid`
// TLD is reserved by RFC 2606 so the URL also can't accidentally
// resolve.
const SSR_PLACEHOLDER_URL = "https://ssr-placeholder.invalid/";
const SSR_PLACEHOLDER: Readonly<RuntimeConfig> = Object.freeze({
  baseUrl: SSR_PLACEHOLDER_URL,
  posthogHost: SSR_PLACEHOLDER_URL,
  // Keep the {slug} placeholder so an SSR-phase substitution still
  // yields a parseable, RFC-2606-unresolvable host. No iframe ever
  // renders from this: backend-URL consumers gate on client state
  // that is only populated post-hydration.
  backendHostPattern: "showcase-{slug}.ssr-placeholder.invalid",
  docsHost: SSR_PLACEHOLDER_URL,
});

/**
 * Returns the runtime config injected by the root server layout.
 *
 * During SSR (no window) returns a sentinel placeholder; the inline
 * <script> runs before hydration, so every client render — including
 * the hydration render — sees the real values (see the hydration note
 * on SSR_PLACEHOLDER above). If the inline <script> never ran (a route
 * bypassed the layout) or injected an empty/incomplete object, this
 * read throws — surfacing the wiring bug loudly rather than silently
 * rendering empty URLs.
 *
 * The returned object is frozen: window.__SHOWCASE_CONFIG__ is a
 * process-wide singleton, so a consumer mutating its copy would change
 * the config for EVERY component.
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
    // value here is a wiring bug (e.g. a route bypassed the layout).
    // Surface it loudly rather than silently returning empty strings.
    throw new Error(
      "[runtime-config.client] window.__SHOWCASE_CONFIG__ is missing. " +
        "The root layout must inject runtime config before client mount.",
    );
  }
  // Minimal field validation: an injection that ran with empty inputs
  // (layout wired to a broken server read) yields an object that is
  // truthy but useless — fail loud instead of rendering empty URLs.
  if (!cfg.baseUrl || !cfg.backendHostPattern) {
    throw new Error(
      "[runtime-config.client] window.__SHOWCASE_CONFIG__ is incomplete " +
        "(empty baseUrl or backendHostPattern). The root layout injection " +
        "ran with empty inputs — check the server-side runtime config.",
    );
  }
  return Object.freeze(cfg);
}
