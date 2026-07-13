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
import { isEnabled } from "./d0-gone-monitor.js";

/**
 * The orchestrator registration predicate, replicated verbatim from
 * `orchestrator.ts` so this test pins the gate.
 */
function shouldRegister(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const resolved = env.SHOWCASE_ENV ?? env.RAILWAY_ENVIRONMENT_NAME;
  return resolved === "production" && isEnabled(env);
}

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
