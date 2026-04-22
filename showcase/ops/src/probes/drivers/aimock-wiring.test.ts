import { describe, it, expect } from "vitest";
import { aimockWiringDriver } from "./aimock-wiring.js";
import { logger } from "../../logger.js";

// Driver-level tests. Deep behavioural coverage for the aimock-wiring probe
// lives in `../aimock-wiring.test.ts` (491 lines); this file only verifies
// the driver adapter layer — schema shape, env-missing fail path, and the
// (ctx, input) call-order — without duplicating the probe test matrix.

const BASE_CTX = {
  now: () => new Date("2026-04-20T00:00:00Z"),
  logger,
};

describe("aimockWiringDriver", () => {
  it("exposes kind === 'aimock_wiring'", () => {
    expect(aimockWiringDriver.kind).toBe("aimock_wiring");
  });

  it("inputSchema accepts { key } (single-target YAML shape)", () => {
    const parsed = aimockWiringDriver.inputSchema.safeParse({
      key: "aimock_wiring:global",
    });
    expect(parsed.success).toBe(true);
  });

  it("inputSchema rejects input without a key", () => {
    const parsed = aimockWiringDriver.inputSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });

  it("inputSchema rejects empty key", () => {
    const parsed = aimockWiringDriver.inputSchema.safeParse({ key: "" });
    expect(parsed.success).toBe(false);
  });

  it("returns state:'error' when RAILWAY_TOKEN missing", async () => {
    const r = await aimockWiringDriver.run(
      { ...BASE_CTX, env: { AIMOCK_URL: "https://aimock.example" } },
      { key: "aimock_wiring:global" },
    );
    expect(r.state).toBe("error");
    expect(r.key).toBe("aimock_wiring:global");
  });

  it("returns state:'error' when AIMOCK_URL missing", async () => {
    const r = await aimockWiringDriver.run(
      {
        ...BASE_CTX,
        env: {
          RAILWAY_TOKEN: "x",
          RAILWAY_PROJECT_ID: "p",
          RAILWAY_ENVIRONMENT_ID: "e",
        },
      },
      { key: "aimock_wiring:global" },
    );
    expect(r.state).toBe("error");
  });

  it("returns state:'error' when all four env vars missing", async () => {
    const r = await aimockWiringDriver.run(
      { ...BASE_CTX, env: {} },
      { key: "aimock_wiring:global" },
    );
    expect(r.state).toBe("error");
  });
});
