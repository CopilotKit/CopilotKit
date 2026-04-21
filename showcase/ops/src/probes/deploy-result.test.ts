import { describe, it, expect } from "vitest";
import { deployEventToProbeResult } from "./deploy-result.js";
import { logger } from "../logger.js";

const ctx = { now: () => new Date("2026-04-20T00:00:00Z"), logger, env: {} };

describe("deploy-result probe transformer", () => {
  it("maps a successful all-services run to green", () => {
    const r = deployEventToProbeResult(
      {
        runId: "1",
        services: ["a", "b"],
        failed: [],
        succeeded: ["a", "b"],
        cancelled: false,
      },
      ctx,
    );
    expect(r.state).toBe("green");
    expect(r.key).toBe("deploy:overall");
    expect(r.signal.partial).toBe(false);
    expect(r.signal.failedCount).toBe(0);
    expect(r.signal.totalCount).toBe(2);
  });

  it("maps a full failure (0 succeeded) to red, partial=false", () => {
    const r = deployEventToProbeResult(
      {
        runId: "2",
        services: ["a", "b"],
        failed: ["a", "b"],
        succeeded: [],
        cancelled: false,
      },
      ctx,
    );
    expect(r.state).toBe("red");
    expect(r.signal.partial).toBe(false);
    expect(r.signal.failedCount).toBe(2);
  });

  it("maps a partial failure to red, partial=true", () => {
    const r = deployEventToProbeResult(
      {
        runId: "3",
        services: ["a", "b", "c"],
        failed: ["a"],
        succeeded: ["b", "c"],
        cancelled: false,
      },
      ctx,
    );
    expect(r.state).toBe("red");
    expect(r.signal.partial).toBe(true);
    expect(r.signal.failedCount).toBe(1);
    expect(r.signal.succeededCount).toBe(2);
  });

  it("flags cancelled_prebuild when cancelled with no legs complete", () => {
    const r = deployEventToProbeResult(
      {
        runId: "4",
        services: ["a", "b"],
        failed: [],
        succeeded: [],
        cancelled: true,
      },
      ctx,
    );
    expect(r.signal.cancelledPreBuild).toBe(true);
    expect(r.signal.cancelledMidMatrix).toBe(false);
    expect(r.state).toBe("green");
  });

  it("flags cancelled_midmatrix when cancelled with ≥1 completed leg and no failures", () => {
    const r = deployEventToProbeResult(
      {
        runId: "5",
        services: ["a", "b"],
        failed: [],
        succeeded: ["a"],
        cancelled: true,
      },
      ctx,
    );
    expect(r.signal.cancelledMidMatrix).toBe(true);
    expect(r.signal.cancelledPreBuild).toBe(false);
    expect(r.state).toBe("green");
  });

  it("cancelled with failures is red AND midmatrix (both signals surface independently)", () => {
    // Spec (deploy-result probe cancelled semantics):
    //   cancelled && failedCount > 0 => red with cancelledMidMatrix: true.
    // The failure determines state, but cancelledMidMatrix still fires so
    // alert rules can distinguish "cancelled mid-run with failures" from a
    // plain failed deploy (different remediation paths).
    const r = deployEventToProbeResult(
      {
        runId: "5b",
        services: ["a", "b", "c"],
        failed: ["a"],
        succeeded: ["b"],
        cancelled: true,
      },
      ctx,
    );
    expect(r.state).toBe("red");
    expect(r.signal.cancelled).toBe(true);
    expect(r.signal.cancelledMidMatrix).toBe(true);
    expect(r.signal.cancelledPreBuild).toBe(false);
    expect(r.signal.failedCount).toBe(1);
  });

  it("cancelled with failures and zero succeeded is red AND midmatrix (failures alone count as mid-matrix progress)", () => {
    const r = deployEventToProbeResult(
      {
        runId: "5c",
        services: ["a", "b"],
        failed: ["a", "b"],
        succeeded: [],
        cancelled: true,
      },
      ctx,
    );
    expect(r.state).toBe("red");
    expect(r.signal.cancelledMidMatrix).toBe(true);
    expect(r.signal.cancelledPreBuild).toBe(false);
  });

  it("surfaces gateSkipped on the signal when the event carries it", () => {
    const r = deployEventToProbeResult(
      {
        runId: "gate-1",
        services: ["a", "b"],
        failed: [],
        succeeded: [],
        cancelled: false,
        gateSkipped: true,
      },
      ctx,
    );
    expect(r.signal.gateSkipped).toBe(true);
    // gateSkipped is neutral wrt state: no failures + not cancelled => green.
    expect(r.state).toBe("green");
    expect(r.signal.cancelledPreBuild).toBe(false);
    expect(r.signal.cancelledMidMatrix).toBe(false);
  });

  it("defaults gateSkipped to false when the event omits it", () => {
    const r = deployEventToProbeResult(
      {
        runId: "gate-2",
        services: ["a"],
        failed: [],
        succeeded: ["a"],
        cancelled: false,
      },
      ctx,
    );
    expect(r.signal.gateSkipped).toBe(false);
  });

  it("surfaces runId explicitly on signal for template use", () => {
    const r = deployEventToProbeResult(
      {
        runId: "abc123",
        services: ["a"],
        failed: [],
        succeeded: ["a"],
        cancelled: false,
      },
      ctx,
    );
    expect(r.signal.runId).toBe("abc123");
  });

  it("preserves runUrl on the signal", () => {
    const r = deployEventToProbeResult(
      {
        runId: "6",
        runUrl: "https://github.com/x/y/actions/runs/6",
        services: ["a"],
        failed: [],
        succeeded: ["a"],
        cancelled: false,
      },
      ctx,
    );
    expect(r.signal.runUrl).toBe("https://github.com/x/y/actions/runs/6");
  });
});
