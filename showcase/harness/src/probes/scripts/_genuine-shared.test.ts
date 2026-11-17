import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchResumedRun } from "./_genuine-shared.js";
import type { RunLifecycle } from "./_genuine-shared.js";

/** Pill 1's paused run stopped here; the slot click comes 2 s later. */
const PAUSED_RUN_STOPPED_AT_MS = 1_800_000_000_000;

/** The lifecycle before the click: one run started and stopped. */
function lifecycle(overrides: Partial<RunLifecycle> = {}): RunLifecycle {
  return {
    runningNow: false,
    runStartCount: 1,
    lastStoppedAtMs: PAUSED_RUN_STOPPED_AT_MS,
    runsFinished: 1,
    ...overrides,
  };
}

describe("watchResumedRun", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(PAUSED_RUN_STOPPED_AT_MS + 2_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays false until a run starts after the baseline", () => {
    const isResumedRunFinished = watchResumedRun(lifecycle());

    vi.advanceTimersByTime(10_000);
    expect(isResumedRunFinished(lifecycle())).toBe(false);
  });

  it("stays false while the resumed run is still running", () => {
    const isResumedRunFinished = watchResumedRun(lifecycle());

    vi.advanceTimersByTime(10_000);
    expect(
      isResumedRunFinished(lifecycle({ runningNow: true, runStartCount: 2 })),
    ).toBe(false);
  });

  it("waits for the resumed run's RUN_FINISHED event, not the chat's earlier stop", () => {
    const isResumedRunFinished = watchResumedRun(lifecycle());
    // The chat reports the run stopped while its stream is still open.
    const stoppedStillStreaming = lifecycle({
      runStartCount: 2,
      lastStoppedAtMs: Date.now(),
    });

    vi.advanceTimersByTime(2_000);
    expect(isResumedRunFinished(stoppedStillStreaming)).toBe(false);

    const finished = { ...stoppedStillStreaming, runsFinished: 2 };
    expect(isResumedRunFinished(finished)).toBe(false);
    vi.advanceTimersByTime(500);
    expect(isResumedRunFinished(finished)).toBe(true);
  });

  it("falls back to the chat's stop when the page has counted no RUN_FINISHED event", () => {
    const isResumedRunFinished = watchResumedRun(
      lifecycle({ runsFinished: 0 }),
    );
    const stopped = lifecycle({
      runsFinished: 0,
      runStartCount: 2,
      lastStoppedAtMs: Date.now(),
    });

    vi.advanceTimersByTime(499);
    expect(isResumedRunFinished(stopped)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(isResumedRunFinished(stopped)).toBe(true);
  });
});
