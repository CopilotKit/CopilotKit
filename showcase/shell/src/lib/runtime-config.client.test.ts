import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRuntimeConfig } from "./runtime-config.client";

describe("client getRuntimeConfig (shell)", () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    // jsdom provides `window` by default in this vitest config — but a
    // prior test that deleted `window` and failed before its restore
    // would leave it undefined, and an unguarded dereference here turns
    // that one failure into a cascade across the whole file. Restore
    // first, then guard the delete.
    (globalThis as { window?: Window }).window = originalWindow;
    if (globalThis.window) {
      delete (globalThis.window as Window & { __SHOWCASE_CONFIG__?: unknown })
        .__SHOWCASE_CONFIG__;
    }
  });

  afterEach(() => {
    // Restore BEFORE the delete: if the test under teardown removed
    // `window` (the SSR test), the unguarded dereference would throw
    // inside the hook and mask the real failure.
    (globalThis as { window?: Window }).window = originalWindow;
    // Clean up the injected config HERE, not only in the next test's
    // beforeEach — the last test in this file must not leak
    // __SHOWCASE_CONFIG__ into other test files under worker reuse.
    if (globalThis.window) {
      delete (globalThis.window as Window & { __SHOWCASE_CONFIG__?: unknown })
        .__SHOWCASE_CONFIG__;
    }
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

  it("throws when the injection ran with empty inputs (incomplete config)", () => {
    // `!cfg` alone would accept a truthy-but-useless object — the
    // fail-loud contract covers empty injected fields too. ALL FOUR
    // URL-bearing fields are checked symmetrically (docsHost feeds
    // docs links, posthogHost feeds capture — an empty value in either
    // is the same wiring bug as an empty baseUrl).
    for (const broken of [
      { baseUrl: "" },
      { backendHostPattern: "" },
      { docsHost: "" },
      { posthogHost: "" },
    ]) {
      (
        window as Window & { __SHOWCASE_CONFIG__?: unknown }
      ).__SHOWCASE_CONFIG__ = {
        baseUrl: "https://showcase.example.com",
        posthogHost: "https://eu.i.posthog.com",
        backendHostPattern: "showcase-{slug}.example.com",
        docsHost: "https://docs.showcase.copilotkit.ai",
        ...broken,
      };
      expect(
        () => getRuntimeConfig(),
        `empty ${Object.keys(broken)[0]} should throw`,
      ).toThrow(/__SHOWCASE_CONFIG__ is incomplete/);
    }
  });

  it("throws (naming the field) when an injected field is not a string", () => {
    // A layout bug injecting a number previously sailed through the
    // truthiness check and exploded far from the cause (e.g. inside a
    // consumer's replaceAll).
    for (const [field, value] of [
      ["baseUrl", 42],
      ["backendHostPattern", null],
      ["docsHost", { url: "https://docs.example.com" }],
      ["posthogHost", 1],
    ] as const) {
      (
        window as Window & { __SHOWCASE_CONFIG__?: unknown }
      ).__SHOWCASE_CONFIG__ = {
        baseUrl: "https://showcase.example.com",
        posthogHost: "https://eu.i.posthog.com",
        backendHostPattern: "showcase-{slug}.example.com",
        docsHost: "https://docs.showcase.copilotkit.ai",
        [field]: value,
      };
      expect(
        () => getRuntimeConfig(),
        `non-string ${field} should throw`,
      ).toThrow(new RegExp(`"${field}"`));
    }
  });

  it("accepts a config without posthogKey (optional field)", () => {
    // posthogKey is legitimately absent off-prod — it must NOT be part
    // of the fail-loud required set.
    (window as Window & { __SHOWCASE_CONFIG__?: unknown }).__SHOWCASE_CONFIG__ =
      {
        baseUrl: "https://showcase.example.com",
        posthogHost: "https://eu.i.posthog.com",
        backendHostPattern: "showcase-{slug}-production.up.railway.app",
        docsHost: "https://docs.showcase.copilotkit.ai",
      };
    expect(getRuntimeConfig().posthogKey).toBeUndefined();
  });

  it("throws (naming posthogKey) when a PRESENT posthogKey is not a string", () => {
    // posthogKey's absence exemption (legitimately unset off-prod) must
    // not exempt wrong TYPES: a layout bug injecting a number would
    // sail through and explode far from the cause in a capture consumer.
    for (const bad of [42, null, { key: "phc_x" }]) {
      // Full-replacement cast (not an intersection): the global Window
      // augmentation types the field as RuntimeConfig, which would
      // reject the deliberately-wrong posthogKey at compile time.
      (
        window as unknown as { __SHOWCASE_CONFIG__?: unknown }
      ).__SHOWCASE_CONFIG__ = {
        baseUrl: "https://showcase.example.com",
        posthogHost: "https://eu.i.posthog.com",
        backendHostPattern: "showcase-{slug}-production.up.railway.app",
        docsHost: "https://docs.showcase.copilotkit.ai",
        posthogKey: bad,
      };
      expect(
        () => getRuntimeConfig(),
        `posthogKey ${JSON.stringify(bad)} should throw`,
      ).toThrow(/"posthogKey"/);
    }
    // A present STRING key still passes.
    (window as Window & { __SHOWCASE_CONFIG__?: unknown }).__SHOWCASE_CONFIG__ =
      {
        baseUrl: "https://showcase.example.com",
        posthogHost: "https://eu.i.posthog.com",
        backendHostPattern: "showcase-{slug}-production.up.railway.app",
        docsHost: "https://docs.showcase.copilotkit.ai",
        posthogKey: "phc_x",
      };
    expect(getRuntimeConfig().posthogKey).toBe("phc_x");
  });

  it("throws (naming posthogKey) when a PRESENT posthogKey is an empty string", () => {
    // The server reader can never produce "" (readEnvPair maps empty to
    // undefined), so a present-but-empty key is the same wiring-bug
    // class as a wrong type — NOT the legitimate absence case.
    (
      window as unknown as { __SHOWCASE_CONFIG__?: unknown }
    ).__SHOWCASE_CONFIG__ = {
      baseUrl: "https://showcase.example.com",
      posthogHost: "https://eu.i.posthog.com",
      backendHostPattern: "showcase-{slug}-production.up.railway.app",
      docsHost: "https://docs.showcase.copilotkit.ai",
      posthogKey: "",
    };
    expect(() => getRuntimeConfig()).toThrow(/"posthogKey"/);
  });

  it("returns a frozen object so consumers cannot mutate the shared config", () => {
    (window as Window & { __SHOWCASE_CONFIG__?: unknown }).__SHOWCASE_CONFIG__ =
      {
        baseUrl: "https://showcase.example.com",
        posthogHost: "https://eu.i.posthog.com",
        backendHostPattern: "showcase-{slug}-production.up.railway.app",
        docsHost: "https://docs.showcase.copilotkit.ai",
      };
    const cfg = getRuntimeConfig();
    expect(Object.isFrozen(cfg)).toBe(true);
    // window.__SHOWCASE_CONFIG__ is a process-wide singleton; a strict-
    // mode write must throw instead of silently changing it for everyone.
    expect(() => {
      (cfg as { baseUrl: string }).baseUrl = "https://evil.example.com";
    }).toThrow(TypeError);
    expect(getRuntimeConfig().baseUrl).toBe("https://showcase.example.com");
  });

  it("returns SSR sentinel placeholder when window is undefined", () => {
    // Simulate SSR by stubbing window to undefined. "use client"
    // component bodies execute on the server during SSR, so this reader
    // MUST be SSR-safe (returns parseable-URL placeholders so
    // `new URL()` in consumers doesn't throw) and NOT throw —
    // otherwise the whole server-rendered HTML 500s. stubGlobal (not
    // delete/reassign) per repo discipline: vitest restores the
    // original even if an assertion throws mid-test (same pattern as
    // runtime-url-wiring.test.ts).
    vi.stubGlobal("window", undefined);
    try {
      const cfg = getRuntimeConfig();
      // URL fields must be parseable.
      expect(() => new URL(cfg.baseUrl)).not.toThrow();
      expect(() => new URL(cfg.posthogHost)).not.toThrow();
      expect(() => new URL(cfg.docsHost)).not.toThrow();
      // Structural parity with the server reader: every real value is
      // slashless (the server strips trailing slashes at every exit
      // path), so the SSR placeholder must be slashless too — consumers
      // string-compose against these values and must see ONE form.
      expect(cfg.baseUrl).not.toMatch(/\/$/);
      expect(cfg.posthogHost).not.toMatch(/\/$/);
      expect(cfg.docsHost).not.toMatch(/\/$/);
      // The host pattern is not a URL but must keep the {slug}
      // placeholder so substitution still yields a syntactically
      // valid (non-resolvable) host during SSR.
      expect(cfg.backendHostPattern).toContain("{slug}");
      // The placeholder is shared module state — must be frozen too.
      expect(Object.isFrozen(cfg)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
