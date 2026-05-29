import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getRuntimeConfig, type RuntimeConfig } from "./runtime-config.client";

// shell-docs's vitest runs with `environment: "node"` (no jsdom) — we
// simulate the browser by attaching a minimal `window` to globalThis
// before each test and removing it after, so we exercise BOTH the
// server-path throw (no window) and the client-path read.

type WindowWithConfig = { __SHOWCASE_CONFIG__?: RuntimeConfig };

const FULL_CONFIG: RuntimeConfig = {
  baseUrl: "https://docs.example.com",
  shellUrl: "https://shell.example.com",
  intelligenceSignupUrl: "https://signup.example.com",
  posthogKey: "phc_test",
  posthogHost: "https://eu.i.posthog.com",
  scarfPixelId: "scarf-id",
  googleAnalyticsTrackingId: "G-TEST",
  reb2bKey: "rb2b-key",
  reoKey: "reo-key",
};

describe("client getRuntimeConfig (shell-docs)", () => {
  beforeEach(() => {
    // Attach a fresh stub `window` for each test. The cast is unavoidable
    // here because globalThis.window is typed against the DOM lib and we
    // are deliberately providing only the shape we need.
    (globalThis as { window?: WindowWithConfig }).window = {};
  });

  afterEach(() => {
    delete (globalThis as { window?: WindowWithConfig }).window;
  });

  it("returns the injected config", () => {
    (globalThis as { window?: WindowWithConfig }).window!.__SHOWCASE_CONFIG__ =
      FULL_CONFIG;
    expect(getRuntimeConfig()).toEqual(FULL_CONFIG);
  });

  it("throws when __SHOWCASE_CONFIG__ is missing (wiring bug)", () => {
    expect(() => getRuntimeConfig()).toThrow(
      /window\.__SHOWCASE_CONFIG__ is missing/,
    );
  });

  it("returns SSR sentinel placeholder when window is undefined", () => {
    // Simulate SSR by removing window. "use client" component bodies
    // execute on the server during SSR, so this reader MUST be SSR-safe
    // (returns parseable-URL placeholders for URL fields so `new URL()`
    // calls in consumers don't throw, and empty strings for analytics
    // keys so `if (key)` truthiness gates fail-closed) — NOT throw,
    // otherwise the whole server-rendered HTML 500s.
    delete (globalThis as { window?: WindowWithConfig }).window;
    const cfg = getRuntimeConfig();
    // URL fields must be parseable so `new URL()` in consumers doesn't throw.
    expect(() => new URL(cfg.baseUrl)).not.toThrow();
    expect(() => new URL(cfg.shellUrl)).not.toThrow();
    expect(() => new URL(cfg.intelligenceSignupUrl)).not.toThrow();
    expect(() => new URL(cfg.posthogHost)).not.toThrow();
    // Analytics keys stay empty so `if (key)` gates fail-closed on SSR.
    expect(cfg.posthogKey).toBe("");
    expect(cfg.scarfPixelId).toBe("");
    expect(cfg.googleAnalyticsTrackingId).toBe("");
    expect(cfg.reb2bKey).toBe("");
    expect(cfg.reoKey).toBe("");
  });
});
