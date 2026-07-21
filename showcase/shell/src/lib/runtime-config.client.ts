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
// URL fields use a parseable `https://ssr-placeholder.invalid` sentinel
// — NOT the empty string — because consumer components may call
// `new URL(cfg.someUrl)` inline during render, and `new URL("")` throws
// a TypeError that escapes the SSR response as a 500. The `.invalid`
// TLD is reserved by RFC 2606 so the URL also can't accidentally
// resolve. Declared WITHOUT a trailing slash: the server reader strips
// trailing slashes at every exit path, so every REAL value is slashless
// — the placeholder keeps the SSR and client forms structurally
// identical for consumers that string-compose against them.
const SSR_PLACEHOLDER_URL = "https://ssr-placeholder.invalid";
const SSR_PLACEHOLDER: Readonly<RuntimeConfig> = Object.freeze({
  baseUrl: SSR_PLACEHOLDER_URL,
  posthogHost: SSR_PLACEHOLDER_URL,
  // Keep the {slug} placeholder so an SSR-phase substitution still
  // yields a parseable, RFC-2606-unresolvable host. No iframe ever
  // renders from this: backend-URL consumers gate on client state
  // that is only populated post-hydration.
  backendHostPattern: "showcase-{slug}.ssr-placeholder.invalid",
  docsHost: SSR_PLACEHOLDER_URL,
  // Optional field (legitimately absent off-prod) — no placeholder
  // needed; client capture consumers must gate on it anyway.
  posthogKey: undefined,
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
  // Field validation: an injection that ran with empty inputs (layout
  // wired to a broken server read) yields an object that is truthy but
  // useless — fail loud instead of rendering empty URLs. ALL FOUR
  // URL-bearing fields are checked symmetrically (docsHost feeds docs
  // links, posthogHost feeds capture — an empty value in either is the
  // same wiring bug as an empty baseUrl). The typeof check catches a
  // layout bug injecting a non-string (e.g. a number), which previously
  // sailed through truthiness and exploded far from the cause inside a
  // consumer's replaceAll. posthogKey is deliberately NOT required —
  // it is legitimately absent off-prod.
  for (const field of REQUIRED_CONFIG_FIELDS) {
    const value = cfg[field];
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(
        `[runtime-config.client] window.__SHOWCASE_CONFIG__ is incomplete: ` +
          `field "${field}" is ${
            typeof value === "string" ? "empty" : `of type ${typeof value}`
          }. The root layout injection ran with broken inputs — check the ` +
          `server-side runtime config.`,
      );
    }
  }
  // posthogKey is exempt from the REQUIRED set because ABSENCE is a
  // valid state (legitimately unset off-prod) — but the absence
  // exemption must not exempt wrong TYPES or the empty string: a layout
  // bug injecting a number would sail through and explode far from the
  // cause inside a capture consumer, and the server reader can never
  // produce "" (readEnvPair maps empty to undefined), so a present-but-
  // empty key is the same wiring-bug class.
  if (
    cfg.posthogKey !== undefined &&
    (typeof cfg.posthogKey !== "string" || cfg.posthogKey.length === 0)
  ) {
    throw new Error(
      `[runtime-config.client] window.__SHOWCASE_CONFIG__ is malformed: ` +
        `field "posthogKey" is ${
          typeof cfg.posthogKey === "string"
            ? "empty"
            : `of type ${typeof cfg.posthogKey}`
        } (expected a non-empty string or absence). The root layout ` +
        `injection ran with broken inputs — check the server-side ` +
        `runtime config.`,
    );
  }
  if (cfg.angularHostUrl !== undefined) {
    let validAngularOrigin = false;
    if (
      typeof cfg.angularHostUrl === "string" &&
      cfg.angularHostUrl.length > 0
    ) {
      try {
        const parsed = new URL(cfg.angularHostUrl);
        validAngularOrigin =
          (parsed.protocol === "https:" || parsed.protocol === "http:") &&
          parsed.username === "" &&
          parsed.password === "" &&
          parsed.pathname === "/" &&
          parsed.search === "" &&
          parsed.hash === "" &&
          parsed.origin === cfg.angularHostUrl;
      } catch {
        validAngularOrigin = false;
      }
    }
    if (!validAngularOrigin) {
      throw new Error(
        `[runtime-config.client] window.__SHOWCASE_CONFIG__ is malformed: ` +
          `field "angularHostUrl" must be an absolute http(s) origin or be ` +
          `absent. The root layout injection ran with broken inputs — check ` +
          `the server-side runtime config.`,
      );
    }
  }
  return Object.freeze(cfg);
}

const REQUIRED_CONFIG_FIELDS = [
  "baseUrl",
  "posthogHost",
  "backendHostPattern",
  "docsHost",
] as const satisfies readonly (keyof RuntimeConfig)[];
