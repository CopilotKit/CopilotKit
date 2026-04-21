import { describe, it, expect } from "vitest";
import { e2eSmokeProbe } from "./e2e-smoke.js";
import { logger } from "../logger.js";

const ctx = { now: () => new Date("2026-04-20T00:00:00Z"), logger, env: {} };

describe("e2e-smoke probe", () => {
  it("reports green on pass with empty failureSummary", async () => {
    const r = await e2eSmokeProbe.run(
      { suite: "L1", runSuite: async () => ({ pass: true, log: "" }) },
      ctx,
    );
    expect(r.state).toBe("green");
    expect(r.key).toBe("e2e_smoke:L1");
    expect(r.signal.failureSummary).toBe("");
  });

  it("reports red on fail and captures first 15 lines of log", async () => {
    const log = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    const r = await e2eSmokeProbe.run(
      { suite: "L2", runSuite: async () => ({ pass: false, log }) },
      ctx,
    );
    expect(r.state).toBe("red");
    expect(r.signal.failureSummary.split("\n")).toHaveLength(15);
    expect(r.signal.failureSummary.startsWith("line 0")).toBe(true);
  });

  it("truncates at 1200 bytes when logs are huge", async () => {
    const log = "x".repeat(5000);
    const r = await e2eSmokeProbe.run(
      { suite: "L3", runSuite: async () => ({ pass: false, log }) },
      ctx,
    );
    expect(r.signal.failureSummary.length).toBeLessThanOrEqual(1200);
  });

  it("enforces UTF-8 byte budget (not code-unit budget) on multi-byte input", async () => {
    // Each 💥 is 4 bytes in UTF-8. 400 of them = 1600 bytes total — must be clipped.
    const line = "💥".repeat(400);
    const log = Array.from({ length: 15 }, () => line).join("\n");
    const r = await e2eSmokeProbe.run(
      { suite: "L4", runSuite: async () => ({ pass: false, log }) },
      ctx,
    );
    const byteLen = new TextEncoder().encode(r.signal.failureSummary).length;
    expect(byteLen).toBeLessThanOrEqual(1200);
  });
});
