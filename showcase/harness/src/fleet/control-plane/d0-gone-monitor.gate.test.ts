/**
 * Prod-only / kill-switch registration gate (spec §10.7).
 *
 * The monitor's cron is registered in `orchestrator.ts` `runControlPlane()`
 * (control-plane role only — worker roles never enter that path) gated on:
 *   env === "production"   (via SHOWCASE_ENV ?? RAILWAY_ENVIRONMENT_NAME)
 *   AND PROD_D0_MONITOR_ENABLED !== "false"
 *
 * That exact predicate is exercised here as a pure unit (the same expression
 * the orchestrator uses), so a regression in the gate — registering on staging,
 * or ignoring the kill-switch — fails a test rather than shipping the monitor to
 * the wrong environment.
 */

import { describe, it, expect } from "vitest";
import {
  isEnabled,
  resolveConfig,
  resolveMonitorEnv,
  shouldRegister,
  DEFAULT_CONFIRM_DELAY_MS,
  DEFAULT_REPOST_MINUTES,
  DEFAULT_MAX_SLUGS_IN_MESSAGE,
} from "./d0-gone-monitor.js";

// B-gatetest: this test exercises the REAL orchestrator registration predicate
// (`shouldRegister`, imported from the monitor module — the SAME function
// `orchestrator.ts` calls), NOT a hand-copied replica. So any env-precedence,
// kill-switch, or normalization drift fails HERE instead of shipping the
// monitor to the wrong environment (or silently disabling it in prod).

describe("prod-d0-gone monitor registration gate (§10.7)", () => {
  it("registers when SHOWCASE_ENV=production", () => {
    expect(shouldRegister({ SHOWCASE_ENV: "production" })).toBe(true);
  });

  it("registers when RAILWAY_ENVIRONMENT_NAME=production (no SHOWCASE_ENV)", () => {
    expect(shouldRegister({ RAILWAY_ENVIRONMENT_NAME: "production" })).toBe(
      true,
    );
  });

  it("does NOT register on staging", () => {
    expect(shouldRegister({ SHOWCASE_ENV: "staging" })).toBe(false);
    expect(shouldRegister({ RAILWAY_ENVIRONMENT_NAME: "staging" })).toBe(false);
  });

  it("does NOT register when env is unset", () => {
    expect(shouldRegister({})).toBe(false);
  });

  it("SHOWCASE_ENV takes precedence over RAILWAY_ENVIRONMENT_NAME", () => {
    // Explicit local/CI override to non-prod wins even if Railway injects prod.
    expect(
      shouldRegister({
        SHOWCASE_ENV: "staging",
        RAILWAY_ENVIRONMENT_NAME: "production",
      }),
    ).toBe(false);
  });

  it("kill-switch: PROD_D0_MONITOR_ENABLED=false suppresses even in production", () => {
    expect(
      shouldRegister({
        SHOWCASE_ENV: "production",
        PROD_D0_MONITOR_ENABLED: "false",
      }),
    ).toBe(false);
  });

  it("kill-switch defaults enabled (absent / true / any-non-false)", () => {
    expect(isEnabled({})).toBe(true);
    expect(isEnabled({ PROD_D0_MONITOR_ENABLED: "true" })).toBe(true);
    expect(isEnabled({ PROD_D0_MONITOR_ENABLED: "1" })).toBe(true);
    expect(isEnabled({ PROD_D0_MONITOR_ENABLED: "false" })).toBe(false);
    expect(isEnabled({ PROD_D0_MONITOR_ENABLED: "FALSE" })).toBe(false);
  });
});

describe("B-env — env resolution normalizes and treats empty as unset", () => {
  it("empty-string SHOWCASE_ENV does NOT shadow a prod Railway env (falls through)", () => {
    // The `??` bug: SHOWCASE_ENV="" is SET (not nullish), so the old
    // `SHOWCASE_ENV ?? RAILWAY_ENVIRONMENT_NAME` returned "" and disabled the
    // monitor on a real prod Railway service. Empty must be treated as unset.
    expect(
      resolveMonitorEnv({
        SHOWCASE_ENV: "",
        RAILWAY_ENVIRONMENT_NAME: "production",
      }),
    ).toBe("production");
    expect(
      shouldRegister({
        SHOWCASE_ENV: "",
        RAILWAY_ENVIRONMENT_NAME: "production",
      }),
    ).toBe(true);
  });

  it("whitespace-only SHOWCASE_ENV also falls through to Railway", () => {
    expect(
      shouldRegister({
        SHOWCASE_ENV: "   ",
        RAILWAY_ENVIRONMENT_NAME: "production",
      }),
    ).toBe(true);
  });

  it("mis-cased / space-padded 'production' still registers (normalized)", () => {
    expect(shouldRegister({ SHOWCASE_ENV: "Production" })).toBe(true);
    expect(shouldRegister({ SHOWCASE_ENV: " production " })).toBe(true);
    expect(shouldRegister({ RAILWAY_ENVIRONMENT_NAME: "PRODUCTION" })).toBe(
      true,
    );
  });

  it("both unset / both empty → not registered", () => {
    expect(resolveMonitorEnv({})).toBeUndefined();
    expect(
      resolveMonitorEnv({ SHOWCASE_ENV: "", RAILWAY_ENVIRONMENT_NAME: "" }),
    ).toBeUndefined();
    expect(shouldRegister({})).toBe(false);
  });
});

describe("resolveConfig — negative / NaN / empty parse falls back (§8, slot3 F3)", () => {
  it("defaults when env vars are absent", () => {
    const c = resolveConfig({});
    expect(c.confirmDelayMs).toBe(DEFAULT_CONFIRM_DELAY_MS);
    expect(c.repostMinutes).toBe(DEFAULT_REPOST_MINUTES);
    expect(c.maxSlugsInMessage).toBe(DEFAULT_MAX_SLUGS_IN_MESSAGE);
  });

  it("empty / whitespace-only values fall back to defaults", () => {
    const c = resolveConfig({
      PROD_D0_MONITOR_CONFIRM_DELAY_MS: "",
      PROD_D0_MONITOR_REPOST_MINUTES: "   ",
      PROD_D0_MONITOR_MAX_SLUGS_IN_MESSAGE: "",
    });
    expect(c.confirmDelayMs).toBe(DEFAULT_CONFIRM_DELAY_MS);
    expect(c.repostMinutes).toBe(DEFAULT_REPOST_MINUTES);
    expect(c.maxSlugsInMessage).toBe(DEFAULT_MAX_SLUGS_IN_MESSAGE);
  });

  it("NaN / non-numeric values fall back to defaults", () => {
    const c = resolveConfig({
      PROD_D0_MONITOR_CONFIRM_DELAY_MS: "abc",
      PROD_D0_MONITOR_REPOST_MINUTES: "1e",
      PROD_D0_MONITOR_MAX_SLUGS_IN_MESSAGE: "NaN",
    });
    expect(c.confirmDelayMs).toBe(DEFAULT_CONFIRM_DELAY_MS);
    expect(c.repostMinutes).toBe(DEFAULT_REPOST_MINUTES);
    expect(c.maxSlugsInMessage).toBe(DEFAULT_MAX_SLUGS_IN_MESSAGE);
  });

  it("negative and non-finite values fall back to defaults", () => {
    const c = resolveConfig({
      PROD_D0_MONITOR_CONFIRM_DELAY_MS: "-1",
      PROD_D0_MONITOR_REPOST_MINUTES: "-60",
      PROD_D0_MONITOR_MAX_SLUGS_IN_MESSAGE: "Infinity",
    });
    expect(c.confirmDelayMs).toBe(DEFAULT_CONFIRM_DELAY_MS);
    expect(c.repostMinutes).toBe(DEFAULT_REPOST_MINUTES);
    expect(c.maxSlugsInMessage).toBe(DEFAULT_MAX_SLUGS_IN_MESSAGE);
  });

  it("valid non-negative numbers are respected", () => {
    const c = resolveConfig({
      PROD_D0_MONITOR_CONFIRM_DELAY_MS: "30000",
      PROD_D0_MONITOR_REPOST_MINUTES: "30",
      PROD_D0_MONITOR_MAX_SLUGS_IN_MESSAGE: "10",
    });
    expect(c.confirmDelayMs).toBe(30000);
    expect(c.repostMinutes).toBe(30);
    expect(c.maxSlugsInMessage).toBe(10);
  });

  it("C4: repostMinutes = 0 falls back (min 1 — a 0-minute window re-posts every tick)", () => {
    // A `repostMinutes: 0` yields `repostMs = 0`, so `ageMs >= 0` is ALWAYS true
    // → every open slug is "due" on every 15m tick → the outage re-posts every
    // tick, defeating the hourly dedup. Floor it at 1 (mirroring the
    // maxSlugsInMessage min-1 fix). A degenerate 0 falls back to the default.
    expect(
      resolveConfig({ PROD_D0_MONITOR_REPOST_MINUTES: "0" }).repostMinutes,
    ).toBe(DEFAULT_REPOST_MINUTES);
    // But 1 (the floor) is accepted.
    expect(
      resolveConfig({ PROD_D0_MONITOR_REPOST_MINUTES: "1" }).repostMinutes,
    ).toBe(1);
  });

  it("maxSlugsInMessage = 0 falls back (min 1 — a 0-slug page is useless)", () => {
    // Unlike the time windows (min 0), maxSlugsInMessage below 1 would render
    // an outage message naming ZERO slugs, so it floors at 1.
    const c = resolveConfig({ PROD_D0_MONITOR_MAX_SLUGS_IN_MESSAGE: "0" });
    expect(c.maxSlugsInMessage).toBe(DEFAULT_MAX_SLUGS_IN_MESSAGE);
    // But 1 is accepted.
    expect(
      resolveConfig({ PROD_D0_MONITOR_MAX_SLUGS_IN_MESSAGE: "1" })
        .maxSlugsInMessage,
    ).toBe(1);
  });
});
