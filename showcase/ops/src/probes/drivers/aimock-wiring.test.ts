import { describe, it, expect } from "vitest";
import { aimockWiringDriver } from "./aimock-wiring.js";
import { logger } from "../../logger.js";

// Thin driver-adapter tests. Deep behavioural coverage lives in
// `../aimock-wiring.test.ts` (491 lines); this file only confirms the
// adapter (1) exposes the right `kind`, (2) accepts well-shaped inputs via
// `inputSchema`, (3) rejects malformed inputs, and (4) preserves probe
// behaviour across the `(input, ctx) -> (ctx, input)` call-order flip.
//
// NOTE: Duplicating the 491-line probe test suite verbatim here was
// considered and rejected — it would double test runtime without adding
// any new verification surface. The driver IS a wrapper; the probe IS
// covered. Keeping them separate.

const ctx = {
  now: () => new Date("2026-04-20T00:00:00Z"),
  logger,
  env: {},
};
const AIMOCK_URL = "https://showcase-aimock-production.up.railway.app";

describe("aimockWiringDriver", () => {
  it("exposes kind === 'aimock_wiring'", () => {
    expect(aimockWiringDriver.kind).toBe("aimock_wiring");
  });

  it("inputSchema accepts { aimockUrl, listServices, getServiceEnv }", () => {
    const parsed = aimockWiringDriver.inputSchema.safeParse({
      aimockUrl: AIMOCK_URL,
      listServices: async () => [],
      getServiceEnv: async () => ({}),
    });
    expect(parsed.success).toBe(true);
  });

  it("inputSchema rejects input missing getServiceEnv", () => {
    const parsed = aimockWiringDriver.inputSchema.safeParse({
      aimockUrl: AIMOCK_URL,
      listServices: async () => [],
    });
    expect(parsed.success).toBe(false);
  });

  it("inputSchema rejects non-function listServices", () => {
    const parsed = aimockWiringDriver.inputSchema.safeParse({
      aimockUrl: AIMOCK_URL,
      listServices: "not-a-function",
      getServiceEnv: async () => ({}),
    });
    expect(parsed.success).toBe(false);
  });

  it("inputSchema rejects empty aimockUrl", () => {
    const parsed = aimockWiringDriver.inputSchema.safeParse({
      aimockUrl: "",
      listServices: async () => [],
      getServiceEnv: async () => ({}),
    });
    expect(parsed.success).toBe(false);
  });

  it("returns green when every service routes through aimock (ctx, input) call order", async () => {
    // Smoke-level end-to-end that confirms the (ctx, input) adapter
    // correctly hands (input, ctx) to the underlying probe and returns
    // the probe's ProbeResult verbatim. Deep behavioural tests live in
    // `../aimock-wiring.test.ts`.
    const r = await aimockWiringDriver.run(ctx, {
      aimockUrl: AIMOCK_URL,
      listServices: async () => [
        { name: "showcase-sales-dashboard" },
        { name: "showcase-quickstart" },
      ],
      getServiceEnv: async (name) =>
        name === "showcase-sales-dashboard" || name === "showcase-quickstart"
          ? { OPENAI_BASE_URL: AIMOCK_URL }
          : {},
    });
    expect(r.state).toBe("green");
    expect(r.key).toBe("aimock_wiring:global");
    expect(r.signal.wiredCount).toBe(2);
    expect(r.signal.unwiredCount).toBe(0);
  });

  it("propagates red state + unwired list from the underlying probe", async () => {
    const r = await aimockWiringDriver.run(ctx, {
      aimockUrl: AIMOCK_URL,
      listServices: async () => [
        { name: "showcase-sales-dashboard" },
        { name: "showcase-quickstart" },
      ],
      getServiceEnv: async (name) =>
        name === "showcase-sales-dashboard"
          ? { OPENAI_BASE_URL: AIMOCK_URL }
          : {},
    });
    expect(r.state).toBe("red");
    expect(r.signal.unwired).toEqual(["showcase-quickstart"]);
  });
});
