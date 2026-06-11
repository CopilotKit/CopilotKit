import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub next/cache.unstable_noStore — vitest runs outside Next's runtime
// so the real implementation throws ("called outside a Server
// Component"). The function is a no-op for our purposes (it tells Next
// not to cache; in a unit test there is no cache to opt out of).
vi.mock("next/cache", () => ({
  unstable_noStore: () => {},
}));

import { getRuntimeConfig } from "./runtime-config";

describe("server getRuntimeConfig (shell)", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    for (const k of [
      "BASE_URL",
      "POSTHOG_HOST",
      "DOCS_HOST",
      "SHOWCASE_BACKEND_HOST_PATTERN",
      "NEXT_PUBLIC_BASE_URL",
      "NEXT_PUBLIC_POSTHOG_HOST",
      "NEXT_PUBLIC_DOCS_HOST",
      "NEXT_PUBLIC_SHOWCASE_BACKEND_HOST_PATTERN",
      "NODE_ENV",
    ]) {
      delete (process.env as Record<string, string | undefined>)[k];
    }
  });

  afterEach(() => {
    // Full restore, not just value restore: Object.assign alone cannot
    // DELETE keys a test added (e.g. DOCS_HOST set by a test but absent
    // from the snapshot), which poisons other test FILES under vitest
    // worker reuse. Drop added keys first, then restore values.
    for (const key of Object.keys(process.env)) {
      if (!(key in ORIGINAL_ENV)) {
        delete (process.env as Record<string, string | undefined>)[key];
      }
    }
    Object.assign(process.env, ORIGINAL_ENV);
  });

  it("returns env values when all are set (production)", () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "https://showcase.copilotkit.ai";
    process.env.POSTHOG_HOST = "https://eu.i.posthog.com";
    expect(getRuntimeConfig()).toEqual({
      baseUrl: "https://showcase.copilotkit.ai",
      posthogHost: "https://eu.i.posthog.com",
      // Defaults preserved when the new env vars are unset — prod
      // requires NO env change.
      backendHostPattern: "showcase-{slug}-production.up.railway.app",
      docsHost: "https://docs.showcase.copilotkit.ai",
    });
  });

  it("backendHostPattern/docsHost default to prod values when unset (both envs, no FATAL log)", () => {
    for (const nodeEnv of ["production", "development"]) {
      (process.env as Record<string, string>).NODE_ENV = nodeEnv;
      process.env.BASE_URL = "https://showcase.copilotkit.ai";
      const errs: string[] = [];
      const spy = vi.spyOn(console, "error").mockImplementation((m: string) => {
        errs.push(m);
      });
      const cfg = getRuntimeConfig();
      spy.mockRestore();
      expect(cfg.backendHostPattern).toBe(
        "showcase-{slug}-production.up.railway.app",
      );
      expect(cfg.docsHost).toBe("https://docs.showcase.copilotkit.ai");
      // These have legitimate prod defaults — never FATAL-CONFIG noise.
      expect(errs.some((m) => m.includes("DOCS_HOST"))).toBe(false);
      expect(
        errs.some((m) => m.includes("SHOWCASE_BACKEND_HOST_PATTERN")),
      ).toBe(false);
    }
  });

  it("honors SHOWCASE_BACKEND_HOST_PATTERN and DOCS_HOST at request time", () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "https://staging.example.com";
    process.env.SHOWCASE_BACKEND_HOST_PATTERN =
      "showcase-{slug}-staging.up.railway.app";
    process.env.DOCS_HOST = "https://docs-staging.example.com/";
    const cfg = getRuntimeConfig();
    expect(cfg.backendHostPattern).toBe(
      "showcase-{slug}-staging.up.railway.app",
    );
    // docsHost is a URL — trailing slash stripped like the others.
    expect(cfg.docsHost).toBe("https://docs-staging.example.com");

    // Live re-read on each call (no module-load freeze).
    process.env.DOCS_HOST = "https://docs-staging2.example.com";
    expect(getRuntimeConfig().docsHost).toBe(
      "https://docs-staging2.example.com",
    );
  });

  it("normalizes a scheme-bearing / slash-trailing SHOWCASE_BACKEND_HOST_PATTERN", () => {
    // The consumer (backendUrlFromPattern) prepends `https://` and
    // concatenates routes — a scheme-bearing value would yield
    // `https://https://…` and a trailing slash would yield `//route`.
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "https://showcase.copilotkit.ai";
    process.env.SHOWCASE_BACKEND_HOST_PATTERN =
      "https://showcase-{slug}-staging.up.railway.app/";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(getRuntimeConfig().backendHostPattern).toBe(
        "showcase-{slug}-staging.up.railway.app",
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("prepends https:// when DOCS_HOST lacks a scheme (host-only misconfig)", () => {
    // Middleware does `new URL(docsHost)` on every docs route. A
    // host-only DOCS_HOST (the documented format of the sibling
    // SHOWCASE_BACKEND_HOST_PATTERN var, an easy misconfig) must NOT
    // produce an unparseable URL that 500s every docs request.
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "https://showcase.copilotkit.ai";
    process.env.DOCS_HOST = "docs-staging.example.com";
    const cfg = getRuntimeConfig();
    expect(cfg.docsHost).toBe("https://docs-staging.example.com");
    expect(() => new URL(cfg.docsHost)).not.toThrow();
  });

  it("preserves an explicit http:// scheme on DOCS_HOST", () => {
    (process.env as Record<string, string>).NODE_ENV = "development";
    process.env.DOCS_HOST = "http://localhost:3005";
    expect(getRuntimeConfig().docsHost).toBe("http://localhost:3005");
  });

  it("falls back to the default docs host (with one loud log) when DOCS_HOST is unparseable", () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "https://showcase.copilotkit.ai";
    // Spaces make the host unparseable even after prepending https://.
    process.env.DOCS_HOST = "not a parseable host";
    const errs: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((m: string) => {
      errs.push(m);
    });
    try {
      const cfg = getRuntimeConfig();
      expect(cfg.docsHost).toBe("https://docs.showcase.copilotkit.ai");
      expect(() => new URL(cfg.docsHost)).not.toThrow();
      expect(errs.some((m) => m.includes("DOCS_HOST"))).toBe(true);
      // Loud log fires ONCE per bad value, not per request.
      const before = errs.length;
      getRuntimeConfig();
      expect(errs.length).toBe(before);
    } finally {
      spy.mockRestore();
    }
  });

  it("strips trailing slashes", () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "https://showcase.example.com/";
    process.env.POSTHOG_HOST = "https://eu.i.posthog.com//";
    const cfg = getRuntimeConfig();
    expect(cfg.baseUrl).toBe("https://showcase.example.com");
    expect(cfg.posthogHost).toBe("https://eu.i.posthog.com");
  });

  it("falls back to dev defaults when unset in non-production", () => {
    (process.env as Record<string, string>).NODE_ENV = "development";
    const cfg = getRuntimeConfig();
    expect(cfg.baseUrl).toBe("http://localhost:3000");
    expect(cfg.posthogHost).toBe("https://eu.i.posthog.com");
  });

  it("falls back to sentinel and console.errors in production (BASE_URL only)", () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    const errs: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((m: string) => {
      errs.push(m);
    });
    const cfg = getRuntimeConfig();
    spy.mockRestore();
    expect(cfg.baseUrl).toBe("about:blank#shell-base-url-missing");
    // POSTHOG_HOST falls back silently (analytics key — legitimately absent in some envs).
    expect(cfg.posthogHost).toBe("https://eu.i.posthog.com");
    expect(errs.some((m) => m.includes("BASE_URL"))).toBe(true);
    expect(errs.some((m) => m.includes("POSTHOG_HOST"))).toBe(false);
  });

  it("reads live process.env on each call (no module-load freeze)", () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "https://first.example.com";
    process.env.POSTHOG_HOST = "https://eu.i.posthog.com";
    expect(getRuntimeConfig().baseUrl).toBe("https://first.example.com");
    process.env.BASE_URL = "https://second.example.com";
    expect(getRuntimeConfig().baseUrl).toBe("https://second.example.com");
  });

  it("accepts NEXT_PUBLIC_BASE_URL as a fallback when BASE_URL is unset", () => {
    // Deploy-config contract: the shell reads the bare name first,
    // but tolerates the NEXT_PUBLIC_-prefixed variant so a Railway
    // service that follows the shell-docs convention still wires
    // through. See the readUrl fallback chain in runtime-config.ts.
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.NEXT_PUBLIC_BASE_URL = "https://alt.example.com";
    // BASE_URL deliberately unset.
    const cfg = getRuntimeConfig();
    expect(cfg.baseUrl).toBe("https://alt.example.com");
  });

  it("BASE_URL takes precedence over NEXT_PUBLIC_BASE_URL when both set", () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "https://primary.example.com";
    process.env.NEXT_PUBLIC_BASE_URL = "https://alt.example.com";
    const cfg = getRuntimeConfig();
    expect(cfg.baseUrl).toBe("https://primary.example.com");
  });

  it("empty-string primary does not mask a set alternate (length-aware fallback)", () => {
    // A deliberately-empty BASE_URL must NOT win over a populated
    // NEXT_PUBLIC_BASE_URL. The prior `??` form treated `""` as
    // "set", masking the alternate; the length-aware form falls
    // through to the alternate when the primary is empty.
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "";
    process.env.NEXT_PUBLIC_BASE_URL = "https://alt.example.com";
    const cfg = getRuntimeConfig();
    expect(cfg.baseUrl).toBe("https://alt.example.com");
  });

  it("accepts NEXT_PUBLIC_POSTHOG_HOST as a fallback when POSTHOG_HOST is unset", () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.NEXT_PUBLIC_POSTHOG_HOST = "https://alt-ph.example.com";
    process.env.BASE_URL = "https://shell.example.com";
    const cfg = getRuntimeConfig();
    expect(cfg.posthogHost).toBe("https://alt-ph.example.com");
  });

  it("getRuntimeConfigForMiddleware skips noStore() (Edge runtime path)", async () => {
    const cacheMod = await import("next/cache");
    const noStoreSpy = vi.spyOn(cacheMod, "unstable_noStore");
    // try/finally so a failing assertion can't leak the spy into other
    // tests — mockRestore after the assertions alone never runs on failure.
    try {
      (process.env as Record<string, string>).NODE_ENV = "production";
      process.env.BASE_URL = "https://edge.example.com";
      process.env.POSTHOG_HOST = "https://edge-posthog.example.com";

      const { getRuntimeConfigForMiddleware } = await import(
        "./runtime-config"
      );
      const cfg = getRuntimeConfigForMiddleware();
      expect(cfg.baseUrl).toBe("https://edge.example.com");
      expect(noStoreSpy).not.toHaveBeenCalled();

      // And confirm the default entrypoint DOES call noStore().
      noStoreSpy.mockClear();
      getRuntimeConfig();
      expect(noStoreSpy).toHaveBeenCalledTimes(1);
    } finally {
      noStoreSpy.mockRestore();
    }
  });
});
