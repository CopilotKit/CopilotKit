import { describe, it, expect, vi } from "vitest";
import {
  resolveRenderMetricsMode,
  createRenderTurnMetrics,
} from "./render-metrics.js";

/** Fake monotonic clock: each call returns the next queued reading. */
const clockOf = (readings: number[]): (() => number) => {
  let i = 0;
  return () => readings[Math.min(i++, readings.length - 1)] ?? 0;
};

describe("resolveRenderMetricsMode", () => {
  it("defaults to off when the env var is absent or falsy", () => {
    expect(resolveRenderMetricsMode({})).toBe("off");
    expect(
      resolveRenderMetricsMode({ COPILOTKIT_CHANNELS_RENDER_METRICS: "" }),
    ).toBe("off");
    expect(
      resolveRenderMetricsMode({ COPILOTKIT_CHANNELS_RENDER_METRICS: "0" }),
    ).toBe("off");
    expect(
      resolveRenderMetricsMode({ COPILOTKIT_CHANNELS_RENDER_METRICS: "false" }),
    ).toBe("off");
  });

  it("treats 1/true/summary as summary and frames as per-frame", () => {
    for (const v of ["1", "true", "summary", "SUMMARY", " true "]) {
      expect(
        resolveRenderMetricsMode({ COPILOTKIT_CHANNELS_RENDER_METRICS: v }),
      ).toBe("summary");
    }
    expect(
      resolveRenderMetricsMode({
        COPILOTKIT_CHANNELS_RENDER_METRICS: "frames",
      }),
    ).toBe("frames");
  });

  it("falls back to off for an unrecognized value", () => {
    expect(
      resolveRenderMetricsMode({ COPILOTKIT_CHANNELS_RENDER_METRICS: "loud" }),
    ).toBe("off");
  });
});

describe("createRenderTurnMetrics", () => {
  it("returns undefined when off, so callers pay nothing", () => {
    expect(
      createRenderTurnMetrics({
        mode: "off",
        turnId: "turn_1",
        deliveryId: "dlv_1",
        log: vi.fn(),
      }),
    ).toBeUndefined();
  });

  it("counts frames by kind and accumulates text_delta chars", () => {
    const log = vi.fn();
    const m = createRenderTurnMetrics({
      mode: "summary",
      turnId: "turn_1",
      deliveryId: "dlv_1",
      log,
      // start, then start/end per push, then finish
      now: clockOf([0, 0, 10, 10, 30, 30, 40, 100]),
    });
    if (!m) throw new Error("expected metrics");

    m.recordPush("text_delta", 0, 10, 5);
    m.recordPush("text_delta", 10, 30, 7);
    m.recordPush("finalize", 30, 40, 0);
    const s = m.finish();

    expect(s.frames).toBe(3);
    expect(s.framesByKind).toEqual({ text_delta: 2, finalize: 1 });
    expect(s.textDeltaFrames).toBe(2);
    expect(s.textDeltaChars).toBe(12);
    expect(s.charsPerTextFrame).toBe(6);
  });

  it("reports total/mean/p50/p95/max push latency and the blocked share of the turn", () => {
    const log = vi.fn();
    const m = createRenderTurnMetrics({
      mode: "summary",
      turnId: "turn_1",
      deliveryId: "dlv_1",
      log,
      now: clockOf([0, 200]),
    });
    if (!m) throw new Error("expected metrics");

    // Four pushes: 10ms, 20ms, 30ms, 40ms => total 100ms of a 200ms turn.
    m.recordPush("text_delta", 0, 10, 1);
    m.recordPush("text_delta", 10, 30, 1);
    m.recordPush("text_delta", 30, 60, 1);
    m.recordPush("text_delta", 60, 100, 1);
    const s = m.finish();

    expect(s.pushMsTotal).toBe(100);
    expect(s.pushMsMean).toBe(25);
    expect(s.pushMsP50).toBe(20);
    expect(s.pushMsP95).toBe(40);
    expect(s.pushMsMax).toBe(40);
    expect(s.turnWallMs).toBe(200);
    expect(s.pushBlockedPct).toBe(50);
  });

  it("emits exactly one summary log line even if finish is called twice", () => {
    const log = vi.fn();
    const m = createRenderTurnMetrics({
      mode: "summary",
      turnId: "turn_1",
      deliveryId: "dlv_1",
      log,
      now: clockOf([0, 50]),
    });
    if (!m) throw new Error("expected metrics");

    m.recordPush("text_delta", 0, 10, 3);
    m.finish();
    m.finish();

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toContain("channel render metrics");
    expect(log.mock.calls[0]?.[1]).toMatchObject({
      turnId: "turn_1",
      deliveryId: "dlv_1",
      frames: 1,
    });
  });

  it("logs a line per frame only in frames mode", () => {
    const summaryLog = vi.fn();
    const summary = createRenderTurnMetrics({
      mode: "summary",
      turnId: "t",
      deliveryId: "d",
      log: summaryLog,
      now: clockOf([0, 10]),
    });
    summary?.recordPush("text_delta", 0, 5, 1);
    expect(summaryLog).not.toHaveBeenCalled();

    const framesLog = vi.fn();
    const frames = createRenderTurnMetrics({
      mode: "frames",
      turnId: "t",
      deliveryId: "d",
      log: framesLog,
      now: clockOf([0, 10]),
    });
    frames?.recordPush("text_delta", 0, 5, 1);
    expect(framesLog).toHaveBeenCalledTimes(1);
    expect(framesLog.mock.calls[0]?.[1]).toMatchObject({
      kind: "text_delta",
      seq: 0,
      pushMs: 5,
    });
  });

  it("handles a turn with no frames without dividing by zero", () => {
    const log = vi.fn();
    const m = createRenderTurnMetrics({
      mode: "summary",
      turnId: "turn_1",
      deliveryId: "dlv_1",
      log,
      now: clockOf([0, 0]),
    });
    if (!m) throw new Error("expected metrics");

    const s = m.finish();
    expect(s.frames).toBe(0);
    expect(s.pushMsTotal).toBe(0);
    expect(s.pushMsMean).toBe(0);
    expect(s.charsPerTextFrame).toBeNull();
    expect(s.pushBlockedPct).toBe(0);
  });
});
