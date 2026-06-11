import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getRuntimeConfig } from "./runtime-config.client";

describe("client getRuntimeConfig (shell)", () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    // jsdom provides `window` by default in this vitest config.
    // Reset any prior injection.
    delete (globalThis.window as Window & { __SHOWCASE_CONFIG__?: unknown })
      .__SHOWCASE_CONFIG__;
  });

  afterEach(() => {
    (globalThis as { window?: Window }).window = originalWindow;
    // Clean up the injected config HERE, not only in the next test's
    // beforeEach — the last test in this file must not leak
    // __SHOWCASE_CONFIG__ into other test files under worker reuse.
    delete (globalThis.window as Window & { __SHOWCASE_CONFIG__?: unknown })
      .__SHOWCASE_CONFIG__;
  });

  it("returns the injected config", () => {
    (window as Window & { __SHOWCASE_CONFIG__?: unknown }).__SHOWCASE_CONFIG__ =
      {
        baseUrl: "https://showcase.example.com",
        posthogHost: "https://eu.i.posthog.com",
        backendHostPattern: "showcase-{slug}-production.up.railway.app",
        docsHost: "https://docs.showcase.copilotkit.ai",
      };
    expect(getRuntimeConfig()).toEqual({
      baseUrl: "https://showcase.example.com",
      posthogHost: "https://eu.i.posthog.com",
      backendHostPattern: "showcase-{slug}-production.up.railway.app",
      docsHost: "https://docs.showcase.copilotkit.ai",
    });
  });

  it("throws when __SHOWCASE_CONFIG__ is missing (wiring bug)", () => {
    expect(() => getRuntimeConfig()).toThrow(
      /window\.__SHOWCASE_CONFIG__ is missing/,
    );
  });

  it("returns SSR sentinel placeholder when window is undefined", () => {
    // Simulate SSR by removing window. "use client" component
    // bodies execute on the server during SSR, so this reader
    // MUST be SSR-safe (returns parseable-URL placeholders so
    // `new URL()` in consumers doesn't throw) and NOT throw —
    // otherwise the whole server-rendered HTML 500s.
    const w = globalThis.window;
    // @ts-expect-error — deliberately removing window for the test
    delete globalThis.window;
    try {
      const cfg = getRuntimeConfig();
      // URL fields must be parseable.
      expect(() => new URL(cfg.baseUrl)).not.toThrow();
      expect(() => new URL(cfg.posthogHost)).not.toThrow();
      expect(() => new URL(cfg.docsHost)).not.toThrow();
      // The host pattern is not a URL but must keep the {slug}
      // placeholder so substitution still yields a syntactically
      // valid (non-resolvable) host during SSR.
      expect(cfg.backendHostPattern).toContain("{slug}");
    } finally {
      (globalThis as { window?: typeof w }).window = w;
    }
  });
});
