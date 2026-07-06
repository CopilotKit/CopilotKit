import { describe, it, expect } from "vitest";
import { ɵestimateBytes, ɵINMEMORY_DEFAULTS } from "../in-memory";

describe("ɵestimateBytes", () => {
  it("approximates size from serialized content", () => {
    const small = ɵestimateBytes({ a: "x" });
    const large = ɵestimateBytes({ a: "x".repeat(1000) });
    expect(large).toBeGreaterThan(small);
    expect(large).toBeGreaterThanOrEqual(1000);
  });

  it("returns 0 and never throws on non-serializable input", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => ɵestimateBytes(circular)).not.toThrow();
    expect(ɵestimateBytes(circular)).toBe(0);
    expect(ɵestimateBytes(undefined)).toBe(0);
  });
});

describe("ɵINMEMORY_DEFAULTS", () => {
  it("matches the spec's default limits", () => {
    expect(ɵINMEMORY_DEFAULTS).toEqual({
      maxThreads: 1000,
      maxRunsPerThread: 100,
      maxBytes: 512 * 1024 ** 2,
    });
  });
});
