import { describe, expect, it } from "vitest";

import {
  FixedWindowLimiter,
  createSessionValue,
  getClientKey,
  getRuntimeSecurityConfiguration,
  verifyAccessCode,
  verifySessionValue,
} from "./runtimeSecurity";

const productionEnv = {
  NODE_ENV: "production",
  CLOUDPLOT_ACCESS_CODE: "correct horse",
  CLOUDPLOT_SESSION_SECRET: "a-session-secret-long-enough-for-tests",
};

describe("runtime security", () => {
  it("fails closed when production secrets are missing", () => {
    expect(getRuntimeSecurityConfiguration({ NODE_ENV: "production" })).toEqual(
      { mode: "misconfigured" },
    );
  });

  it("signs an expiring session and rejects tampering", () => {
    const configuration = getRuntimeSecurityConfiguration(productionEnv);
    expect(configuration.mode).toBe("protected");
    if (configuration.mode !== "protected") throw new Error("bad fixture");

    expect(verifyAccessCode("correct horse", configuration)).toBe(true);
    expect(verifyAccessCode("wrong", configuration)).toBe(false);
    const value = createSessionValue(configuration, 1_000);
    expect(verifySessionValue(value, configuration, 1_001)).toBe(true);
    expect(verifySessionValue(`${value}x`, configuration, 1_001)).toBe(false);
    expect(
      verifySessionValue(value, configuration, 1_000 + 8 * 60 * 60 * 1_000 + 1),
    ).toBe(false);
  });

  it("bounds fixed-window keys and resets expired windows", () => {
    const limiter = new FixedWindowLimiter({
      limit: 1,
      windowMs: 100,
      maxKeys: 2,
    });
    expect(limiter.consume("a", 0).allowed).toBe(true);
    expect(limiter.consume("a", 1).allowed).toBe(false);
    expect(limiter.consume("b", 1).allowed).toBe(true);
    expect(limiter.consume("c", 1).allowed).toBe(true);
    expect(limiter.size).toBeLessThanOrEqual(3);
    expect(limiter.consume("a", 101).allowed).toBe(true);
  });

  it("trusts Railway X-Real-IP only when valid", () => {
    expect(
      getClientKey(new Headers({ "x-real-ip": "198.51.100.7" }), true),
    ).toBe("railway:198.51.100.7");
    expect(getClientKey(new Headers({ "x-real-ip": "invalid" }), true)).toBe(
      "railway:unknown",
    );
    expect(getClientKey(new Headers(), false)).toBe("direct:unknown");
  });
});
