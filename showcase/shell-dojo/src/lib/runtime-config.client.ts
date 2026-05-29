// Client-side runtime config reader. Reads from
// window.__SHOWCASE_CONFIG__ which the root layout injects via an
// inline <script> tag BEFORE React hydrates (see app/layout.tsx). This
// is the ONLY public API for these URLs in client code — never read
// process.env.NEXT_PUBLIC_* directly (the ESLint rule in B12 enforces
// this).
//
// shell-dojo's `RuntimeConfig` is intentionally empty today (no URL
// consumers); the module exists to keep the pattern symmetric across
// shells. When a URL is added on the server side, this reader picks it
// up via the shared interface.

import type { RuntimeConfig } from "./runtime-config";

export type { RuntimeConfig };

declare global {
    interface Window {
        __SHOWCASE_CONFIG__?: RuntimeConfig;
    }
}

/**
 * Returns the runtime config injected by the root server layout.
 *
 * Throws when called during SSR (no window). The intended call sites
 * are client components and hooks ("use client"), which only execute
 * after hydration — by which point the inline <script> has populated
 * window.__SHOWCASE_CONFIG__. If a server component needs the same
 * values, it MUST import runtime-config.ts (the server variant) — not
 * this file.
 */
export function getRuntimeConfig(): RuntimeConfig {
    if (typeof window === "undefined") {
        throw new Error(
            "[runtime-config.client] getRuntimeConfig() called on the server. " +
                "Server code must import from './runtime-config' instead.",
        );
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
