import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub next/cache.unstable_noStore — vitest runs outside Next's runtime
// so the real implementation throws ("called outside a Server
// Component"). The function is a no-op for our purposes (it tells Next
// not to cache; in a unit test there is no cache to opt out of).
vi.mock("next/cache", () => ({
  unstable_noStore: () => {},
}));

import {
  getRuntimeConfig,
  getRuntimeConfigForMiddleware,
} from "./runtime-config";

const URL_KEYS = [
  "NEXT_PUBLIC_BASE_URL",
  "NEXT_PUBLIC_SHELL_URL",
  "NEXT_PUBLIC_INTELLIGENCE_SIGNUP_URL",
  "NEXT_PUBLIC_POSTHOG_HOST",
  // Alt (bare) names — shell-docs tolerates these as a fallback so a
  // Railway service following the shell / shell-dashboard naming
  // convention still wires through.
  "BASE_URL",
  "SHELL_URL",
  "INTELLIGENCE_SIGNUP_URL",
  "POSTHOG_HOST",
] as const;
const ANALYTICS_KEYS = [
  "NEXT_PUBLIC_POSTHOG_KEY",
  "NEXT_PUBLIC_SCARF_PIXEL_ID",
  "NEXT_PUBLIC_GOOGLE_ANALYTICS_TRACKING_ID",
  "NEXT_PUBLIC_REB2B_KEY",
  "NEXT_PUBLIC_REO_KEY",
] as const;

describe("server getRuntimeConfig (shell-docs)", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    for (const k of [...URL_KEYS, ...ANALYTICS_KEYS, "NODE_ENV"] as const) {
      delete (process.env as Record<string, string | undefined>)[k];
    }
  });

  afterEach(() => {
    // Restore the snapshot — replace, don't merge, so per-test sets
    // don't leak into the next test.
    for (const k of Object.keys(process.env)) {
      delete (process.env as Record<string, string | undefined>)[k];
    }
    Object.assign(process.env, ORIGINAL_ENV);
  });

  it("returns env values when all are set (production)", () => {
    // NODE_ENV is typed as `"development" | "production" | "test"` and
    // marked read-only in modern @types/node. The runtime-config reader
    // only checks the string value, so writing through a record cast is
    // safe and matches the pattern used in other shell-docs tests.
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.NEXT_PUBLIC_BASE_URL = "https://docs.copilotkit.ai";
    process.env.NEXT_PUBLIC_SHELL_URL = "https://showcase.copilotkit.ai";
    process.env.NEXT_PUBLIC_INTELLIGENCE_SIGNUP_URL =
      "https://dashboard.operations.copilotkit.ai/";
    process.env.NEXT_PUBLIC_POSTHOG_HOST = "https://eu.i.posthog.com";
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_real";
    process.env.NEXT_PUBLIC_SCARF_PIXEL_ID = "scarf-id";
    process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_TRACKING_ID = "G-XYZ";
    process.env.NEXT_PUBLIC_REB2B_KEY = "rb2b-key";
    process.env.NEXT_PUBLIC_REO_KEY = "reo-key";

    expect(getRuntimeConfig()).toEqual({
      baseUrl: "https://docs.copilotkit.ai",
      shellUrl: "https://showcase.copilotkit.ai",
      intelligenceSignupUrl: "https://dashboard.operations.copilotkit.ai",
      posthogKey: "phc_real",
      posthogHost: "https://eu.i.posthog.com",
      scarfPixelId: "scarf-id",
      googleAnalyticsTrackingId: "G-XYZ",
      reb2bKey: "rb2b-key",
      reoKey: "reo-key",
    });
  });

  it("strips trailing slashes from URLs", () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.NEXT_PUBLIC_BASE_URL = "https://docs.example.com/";
    process.env.NEXT_PUBLIC_SHELL_URL = "https://shell.example.com//";
    process.env.NEXT_PUBLIC_INTELLIGENCE_SIGNUP_URL =
      "https://signup.example.com///";
    process.env.NEXT_PUBLIC_POSTHOG_HOST = "https://posthog.example.com/";

    const cfg = getRuntimeConfig();
    expect(cfg.baseUrl).toBe("https://docs.example.com");
    expect(cfg.shellUrl).toBe("https://shell.example.com");
    expect(cfg.intelligenceSignupUrl).toBe("https://signup.example.com");
    expect(cfg.posthogHost).toBe("https://posthog.example.com");
  });

  it("falls back to dev defaults when URLs are unset in non-production", () => {
    (process.env as Record<string, string>).NODE_ENV = "development";
    const cfg = getRuntimeConfig();
    expect(cfg.baseUrl).toBe("http://localhost:3003");
    expect(cfg.shellUrl).toBe("http://localhost:3000");
    expect(cfg.intelligenceSignupUrl).toBe(
      "https://dashboard.operations.copilotkit.ai",
    );
    expect(cfg.posthogHost).toBe("https://eu.i.posthog.com");
  });

  it("falls back to prod sentinels and logs by severity when URLs unset in production", () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    const errs: string[] = [];
    const warns: string[] = [];
    const errSpy = vi
      .spyOn(console, "error")
      .mockImplementation((m: string) => {
        errs.push(m);
      });
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation((m: string) => {
        warns.push(m);
      });
    const cfg = getRuntimeConfig();
    errSpy.mockRestore();
    warnSpy.mockRestore();

    expect(cfg.baseUrl).toBe("https://docs.copilotkit.ai");
    expect(cfg.shellUrl).toBe("about:blank#shell-url-missing");
    expect(cfg.intelligenceSignupUrl).toBe(
      "https://dashboard.operations.copilotkit.ai",
    );
    expect(cfg.posthogHost).toBe("https://eu.i.posthog.com");
    // baseUrl + shellUrl are FATAL-CONFIG severity (no legitimate prod
    // default exists for shellUrl; baseUrl mismatches break sitemap+OG).
    expect(errs.some((m) => m.includes("NEXT_PUBLIC_BASE_URL"))).toBe(true);
    expect(errs.some((m) => m.includes("NEXT_PUBLIC_SHELL_URL"))).toBe(true);
    // intelligenceSignupUrl + posthogHost have working prod defaults
    // (dashboard.operations.copilotkit.ai, EU posthog cloud), so they
    // log via console.warn WITHOUT the `FATAL-CONFIG:` prefix — visible
    // in prod log streams but not raising ops alerts.
    expect(
      warns.some((m) => m.includes("NEXT_PUBLIC_INTELLIGENCE_SIGNUP_URL")),
    ).toBe(true);
    expect(warns.some((m) => m.includes("NEXT_PUBLIC_POSTHOG_HOST"))).toBe(
      true,
    );
    // The recoverable warns must NOT carry the `FATAL-CONFIG:` prefix —
    // that prefix is what ops alert routing pattern-matches on.
    expect(
      warns.some(
        (m) =>
          m.includes("FATAL-CONFIG:") &&
          (m.includes("NEXT_PUBLIC_INTELLIGENCE_SIGNUP_URL") ||
            m.includes("NEXT_PUBLIC_POSTHOG_HOST")),
      ),
    ).toBe(false);
    // Confirm NO false-positive FATAL-CONFIG was logged for the
    // recoverable cases.
    expect(
      errs.some((m) => m.includes("NEXT_PUBLIC_INTELLIGENCE_SIGNUP_URL")),
    ).toBe(false);
    expect(errs.some((m) => m.includes("NEXT_PUBLIC_POSTHOG_HOST"))).toBe(
      false,
    );
  });

  it("returns empty strings for missing analytics keys with no console output", () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.NEXT_PUBLIC_BASE_URL = "https://docs.copilotkit.ai";
    process.env.NEXT_PUBLIC_SHELL_URL = "https://showcase.copilotkit.ai";

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const cfg = getRuntimeConfig();
    warnSpy.mockRestore();
    errSpy.mockRestore();

    expect(cfg.posthogKey).toBe("");
    expect(cfg.scarfPixelId).toBe("");
    expect(cfg.googleAnalyticsTrackingId).toBe("");
    expect(cfg.reb2bKey).toBe("");
    expect(cfg.reoKey).toBe("");

    // None of the analytics-key env names should have produced a log.
    const allOutput = [
      ...warnSpy.mock.calls.flat(),
      ...errSpy.mock.calls.flat(),
    ]
      .map(String)
      .join("\n");
    for (const k of ANALYTICS_KEYS) {
      expect(allOutput).not.toContain(k);
    }
  });

  it("reads live process.env on each call (no module-load freeze)", () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.NEXT_PUBLIC_BASE_URL = "https://first.example.com";
    process.env.NEXT_PUBLIC_SHELL_URL = "https://shell.example.com";
    process.env.NEXT_PUBLIC_INTELLIGENCE_SIGNUP_URL =
      "https://signup.example.com";
    process.env.NEXT_PUBLIC_POSTHOG_HOST = "https://ph.example.com";

    expect(getRuntimeConfig().baseUrl).toBe("https://first.example.com");

    process.env.NEXT_PUBLIC_BASE_URL = "https://second.example.com";
    expect(getRuntimeConfig().baseUrl).toBe("https://second.example.com");
  });

  it("accepts bare-name fallbacks when NEXT_PUBLIC_* variants are unset", () => {
    // Deploy-config contract: shell-docs reads NEXT_PUBLIC_* first,
    // but tolerates the bare-name variant so a Railway service that
    // follows the shell / shell-dashboard naming convention still
    // wires through. See the readUrl fallback chain in
    // runtime-config.ts.
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.BASE_URL = "https://alt-docs.example.com";
    process.env.SHELL_URL = "https://alt-shell.example.com";
    process.env.INTELLIGENCE_SIGNUP_URL = "https://alt-signup.example.com";
    process.env.POSTHOG_HOST = "https://alt-ph.example.com";

    const cfg = getRuntimeConfig();
    expect(cfg.baseUrl).toBe("https://alt-docs.example.com");
    expect(cfg.shellUrl).toBe("https://alt-shell.example.com");
    expect(cfg.intelligenceSignupUrl).toBe("https://alt-signup.example.com");
    expect(cfg.posthogHost).toBe("https://alt-ph.example.com");
  });

  it("NEXT_PUBLIC_* takes precedence over bare-name when both set", () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.NEXT_PUBLIC_BASE_URL = "https://primary-docs.example.com";
    process.env.BASE_URL = "https://alt-docs.example.com";
    process.env.NEXT_PUBLIC_SHELL_URL = "https://primary-shell.example.com";
    process.env.SHELL_URL = "https://alt-shell.example.com";
    process.env.NEXT_PUBLIC_INTELLIGENCE_SIGNUP_URL =
      "https://primary-signup.example.com";
    process.env.INTELLIGENCE_SIGNUP_URL = "https://alt-signup.example.com";
    process.env.NEXT_PUBLIC_POSTHOG_HOST = "https://primary-ph.example.com";
    process.env.POSTHOG_HOST = "https://alt-ph.example.com";

    const cfg = getRuntimeConfig();
    expect(cfg.baseUrl).toBe("https://primary-docs.example.com");
    expect(cfg.shellUrl).toBe("https://primary-shell.example.com");
    expect(cfg.intelligenceSignupUrl).toBe(
      "https://primary-signup.example.com",
    );
    expect(cfg.posthogHost).toBe("https://primary-ph.example.com");
  });

  it("getRuntimeConfigForMiddleware skips noStore() (Edge runtime path)", async () => {
    const cacheMod = await import("next/cache");
    const noStoreSpy = vi.spyOn(cacheMod, "unstable_noStore");
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.NEXT_PUBLIC_BASE_URL = "https://edge.example.com";
    process.env.NEXT_PUBLIC_SHELL_URL = "https://edge-shell.example.com";
    process.env.NEXT_PUBLIC_INTELLIGENCE_SIGNUP_URL =
      "https://edge-signup.example.com";
    process.env.NEXT_PUBLIC_POSTHOG_HOST = "https://edge-ph.example.com";

    const cfg = getRuntimeConfigForMiddleware();
    expect(cfg.baseUrl).toBe("https://edge.example.com");
    expect(noStoreSpy).not.toHaveBeenCalled();

    // And confirm the default entrypoint DOES call noStore().
    noStoreSpy.mockClear();
    getRuntimeConfig();
    expect(noStoreSpy).toHaveBeenCalledTimes(1);
    noStoreSpy.mockRestore();
  });
});
