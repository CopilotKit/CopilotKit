import { describe, it, expect } from "vitest";
import { ProbeConfigSchema } from "./schema.js";

describe("ProbeConfigSchema", () => {
  it("accepts a valid static-targets probe", () => {
    const input = {
      kind: "smoke",
      id: "smoke",
      schedule: "*/15 * * * *",
      targets: [{ key: "smoke:mastra", url: "https://example.com/smoke" }],
    };
    expect(() => ProbeConfigSchema.parse(input)).not.toThrow();
  });

  it("accepts a valid discovery probe", () => {
    const input = {
      kind: "image_drift",
      id: "image-drift",
      schedule: "*/15 * * * *",
      discovery: {
        source: "railway-services",
        filter: { labels: { "smoke-enabled": "true" } },
        key_template: "image_drift:${service.name}",
      },
    };
    expect(() => ProbeConfigSchema.parse(input)).not.toThrow();
  });

  it("accepts a valid single-target probe", () => {
    const input = {
      kind: "pin_drift",
      id: "pin-drift-weekly",
      schedule: "0 10 * * 1",
      target: { key: "pin_drift:overall" },
    };
    expect(() => ProbeConfigSchema.parse(input)).not.toThrow();
  });

  it("rejects a probe with both targets and discovery", () => {
    const input = {
      kind: "smoke",
      id: "bad",
      schedule: "*/15 * * * *",
      targets: [{ key: "x", url: "https://x.example" }],
      discovery: {
        source: "railway-services",
        filter: {},
        key_template: "x",
      },
    };
    expect(() => ProbeConfigSchema.parse(input)).toThrow();
  });

  it("rejects a probe with no target source", () => {
    const input = { kind: "smoke", id: "bad", schedule: "*/15 * * * *" };
    expect(() => ProbeConfigSchema.parse(input)).toThrow();
  });

  it("rejects max_concurrency below 1", () => {
    const input = {
      kind: "smoke",
      id: "bad",
      schedule: "*/15 * * * *",
      targets: [{ key: "x", url: "https://x.example" }],
      max_concurrency: 0,
    };
    expect(() => ProbeConfigSchema.parse(input)).toThrow();
  });

  it("rejects max_concurrency above 32", () => {
    const input = {
      kind: "smoke",
      id: "bad",
      schedule: "*/15 * * * *",
      targets: [{ key: "x", url: "https://x.example" }],
      max_concurrency: 33,
    };
    expect(() => ProbeConfigSchema.parse(input)).toThrow();
  });

  it("defaults max_concurrency to 4", () => {
    const input = {
      kind: "smoke",
      id: "ok",
      schedule: "*/15 * * * *",
      targets: [{ key: "x", url: "https://x.example" }],
    };
    const parsed = ProbeConfigSchema.parse(input);
    expect(parsed.max_concurrency).toBe(4);
  });

  it("rejects an unknown kind", () => {
    const input = {
      kind: "nonexistent_kind",
      id: "bad",
      schedule: "*/15 * * * *",
      target: { key: "bad:overall" },
    };
    expect(() => ProbeConfigSchema.parse(input)).toThrow();
  });

  it("accepts timeout_ms up to 900_000 (15 min, e2e-smoke daily budget)", () => {
    const input = {
      kind: "e2e_smoke",
      id: "e2e-smoke-daily",
      schedule: "0 0 * * *",
      timeout_ms: 900000,
      target: { key: "e2e_smoke:l4", suite: "l4" },
    };
    expect(() => ProbeConfigSchema.parse(input)).not.toThrow();
  });

  it("rejects timeout_ms above 900_000", () => {
    const input = {
      kind: "e2e_smoke",
      id: "e2e-smoke-daily",
      schedule: "0 0 * * *",
      timeout_ms: 900001,
      target: { key: "e2e_smoke:l4" },
    };
    expect(() => ProbeConfigSchema.parse(input)).toThrow();
  });

  it("accepts any non-empty schedule string (cron validation happens at scheduler-register time)", () => {
    // Schema accepts any non-empty string; cron validation happens at
    // scheduler-register time so load-time validation stays simple and the
    // scheduler-level Croner instantiation is the single source of truth.
    const input = {
      kind: "smoke",
      id: "ok",
      schedule: "not a cron",
      targets: [{ key: "x", url: "https://x.example" }],
    };
    expect(() => ProbeConfigSchema.parse(input)).not.toThrow();
  });
});
