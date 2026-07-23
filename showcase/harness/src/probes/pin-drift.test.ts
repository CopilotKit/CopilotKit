import { describe, it, expect } from "vitest";
import { pinDriftProbe } from "./pin-drift.js";
import { logger } from "../logger.js";

const ctx = { now: () => new Date("2026-04-20T00:00:00Z"), logger, env: {} };

describe("pin-drift probe", () => {
  it("stable when counts match", async () => {
    const r = await pinDriftProbe.run(
      { actualCount: 3, baselineCount: 3 },
      ctx,
    );
    // Invariant: pin-drift never goes red at the state-machine level —
    // weekly cron reporting branches on setStatus instead.
    expect(r.state).toBe("green");
    expect(r.signal.setStatus).toBe("stable");
    expect(r.signal.stable).toBe(true);
  });

  it("regressed when actual > baseline", async () => {
    const r = await pinDriftProbe.run(
      { actualCount: 5, baselineCount: 3 },
      ctx,
    );
    expect(r.state).toBe("green");
    expect(r.signal.setStatus).toBe("regressed");
    expect(r.signal.regressed).toBe(true);
  });

  it("improved when actual < baseline", async () => {
    const r = await pinDriftProbe.run(
      { actualCount: 1, baselineCount: 3 },
      ctx,
    );
    expect(r.state).toBe("green");
    expect(r.signal.setStatus).toBe("improved");
    expect(r.signal.improved).toBe(true);
  });

  it("emits no_baseline on first run (baselineCount === null)", async () => {
    // Regression: a missing baseline previously fell through to stable/regressed
    // logic depending on implicit zero, producing misleading weekly reports.
    const r = await pinDriftProbe.run(
      { actualCount: 7, baselineCount: null },
      ctx,
    );
    expect(r.state).toBe("green");
    expect(r.signal.setStatus).toBe("no_baseline");
    expect(r.signal.noBaseline).toBe(true);
    expect(r.signal.stable).toBe(false);
    expect(r.signal.regressed).toBe(false);
    expect(r.signal.improved).toBe(false);
  });
});
