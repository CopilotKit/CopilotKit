import { describe, it, expect } from "vitest";
import {
  resolveFleetRoleConfig,
  isHarnessRole,
  DEFAULT_POOL_COUNT,
  HARNESS_ROLES,
} from "./role-config.js";

/**
 * Pins the fleet role-selection contract: HARNESS_ROLE selects the runtime
 * role (control-plane | worker), missing/invalid role errors clearly, and
 * HARNESS_POOL_COUNT parses + defaults to 1 + validates >= 1.
 *
 * Env is injected via `options.env` so these tests never touch process.env
 * (parallel-safe — mirrors the harness's env-injection idiom).
 */

describe("resolveFleetRoleConfig — role selection", () => {
  it("selects the worker role when HARNESS_ROLE=worker", () => {
    const cfg = resolveFleetRoleConfig({ env: { HARNESS_ROLE: "worker" } });
    expect(cfg.role).toBe("worker");
  });

  it("selects the control-plane role when HARNESS_ROLE=control-plane", () => {
    const cfg = resolveFleetRoleConfig({
      env: { HARNESS_ROLE: "control-plane" },
    });
    expect(cfg.role).toBe("control-plane");
  });

  it("trims surrounding whitespace on HARNESS_ROLE", () => {
    const cfg = resolveFleetRoleConfig({ env: { HARNESS_ROLE: "  worker  " } });
    expect(cfg.role).toBe("worker");
  });

  it("throws a fail-loud error naming valid roles when HARNESS_ROLE is unset", () => {
    expect(() => resolveFleetRoleConfig({ env: {} })).toThrowError(
      /HARNESS_ROLE must be set to one of: control-plane, worker \(got: <unset>\)\. Every fleet service must set HARNESS_ROLE explicitly\./,
    );
  });

  it("throws a fail-loud error when HARNESS_ROLE is empty/whitespace", () => {
    expect(() =>
      resolveFleetRoleConfig({ env: { HARNESS_ROLE: "   " } }),
    ).toThrowError(
      /HARNESS_ROLE must be set to one of: control-plane, worker \(got: <unset>\)\. Every fleet service must set HARNESS_ROLE explicitly\./,
    );
  });

  it("throws a clear error when HARNESS_ROLE is invalid", () => {
    expect(() =>
      resolveFleetRoleConfig({ env: { HARNESS_ROLE: "scheduler" } }),
    ).toThrowError(/HARNESS_ROLE "scheduler" is invalid/);
  });
});

describe("resolveFleetRoleConfig — HARNESS_POOL_COUNT", () => {
  it("defaults to 1 when unset", () => {
    const cfg = resolveFleetRoleConfig({ env: { HARNESS_ROLE: "worker" } });
    expect(cfg.poolCount).toBe(1);
    expect(cfg.poolCount).toBe(DEFAULT_POOL_COUNT);
  });

  it("defaults to 1 when empty", () => {
    const cfg = resolveFleetRoleConfig({
      env: { HARNESS_ROLE: "worker", HARNESS_POOL_COUNT: "  " },
    });
    expect(cfg.poolCount).toBe(1);
  });

  it("parses a valid integer", () => {
    const cfg = resolveFleetRoleConfig({
      env: { HARNESS_ROLE: "control-plane", HARNESS_POOL_COUNT: "2" },
    });
    expect(cfg.poolCount).toBe(2);
  });

  it("throws on a value below 1", () => {
    expect(() =>
      resolveFleetRoleConfig({
        env: { HARNESS_ROLE: "worker", HARNESS_POOL_COUNT: "0" },
      }),
    ).toThrowError(/HARNESS_POOL_COUNT must be a positive integer/);
  });

  it("throws on a negative value", () => {
    expect(() =>
      resolveFleetRoleConfig({
        env: { HARNESS_ROLE: "worker", HARNESS_POOL_COUNT: "-3" },
      }),
    ).toThrowError(/HARNESS_POOL_COUNT must be a positive integer/);
  });

  it("throws on a non-numeric value", () => {
    expect(() =>
      resolveFleetRoleConfig({
        env: { HARNESS_ROLE: "worker", HARNESS_POOL_COUNT: "abc" },
      }),
    ).toThrowError(/HARNESS_POOL_COUNT must be a positive integer/);
  });

  it("throws on a partially-numeric value (no silent parseInt truncation)", () => {
    expect(() =>
      resolveFleetRoleConfig({
        env: { HARNESS_ROLE: "worker", HARNESS_POOL_COUNT: "2abc" },
      }),
    ).toThrowError(/HARNESS_POOL_COUNT must be a positive integer/);
  });

  it("throws on a fractional value", () => {
    expect(() =>
      resolveFleetRoleConfig({
        env: { HARNESS_ROLE: "worker", HARNESS_POOL_COUNT: "1.5" },
      }),
    ).toThrowError(/HARNESS_POOL_COUNT must be a positive integer/);
  });
});

describe("isHarnessRole", () => {
  it("accepts the known roles", () => {
    for (const role of HARNESS_ROLES) {
      expect(isHarnessRole(role)).toBe(true);
    }
  });

  it("rejects unknown / undefined values", () => {
    expect(isHarnessRole("scheduler")).toBe(false);
    expect(isHarnessRole(undefined)).toBe(false);
    expect(isHarnessRole("")).toBe(false);
  });
});
