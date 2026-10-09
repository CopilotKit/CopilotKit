import { describe, it, expect, vi, afterEach } from "vitest";
import {
  countTerminalStates,
  errorToTerminal,
  runDriverInputs,
} from "./runner.js";
import type { TerminalResult } from "./results.js";
import type { StatusWriter } from "../writers/status-writer.js";
import type { Logger, ProbeContext, ProbeResult } from "../types/index.js";

function fakeLogger(): Logger {
  return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
}

function fakeCtx(abort?: AbortSignal): ProbeContext {
  return {
    now: () => new Date(),
    logger: fakeLogger(),
    env: {},
    ...(abort && { abortSignal: abort }),
  };
}

// ---------------------------------------------------------------------------
// countTerminalStates — the RunResult counting contract (A5(i) round 7).
// `failed` must EXCLUDE degraded: degraded is a distinct durable state (the
// C3 split printSummary already honors), so counting it as failed made the
// CLI exit non-zero — and report "N failed" — for runs that merely degraded.
// ---------------------------------------------------------------------------
describe("countTerminalStates (A5(i) round 7)", () => {
  const results: TerminalResult[] = [
    { key: "smoke:a", state: "green", durationMs: 1 },
    { key: "smoke:b", state: "green", durationMs: 1 },
    { key: "smoke:c", state: "degraded", durationMs: 1 },
    { key: "smoke:d", state: "red", durationMs: 1 },
    { key: "smoke:e", state: "error", durationMs: 1 },
  ];

  it("excludes degraded from failed and counts it separately", () => {
    expect(countTerminalStates(results)).toEqual({
      passed: 2,
      degraded: 1,
      failed: 2,
    });
  });

  it("a degraded-only run reports zero failed", () => {
    expect(
      countTerminalStates([
        { key: "smoke:a", state: "degraded", durationMs: 1 },
      ]),
    ).toEqual({ passed: 0, degraded: 1, failed: 0 });
  });
});

// ---------------------------------------------------------------------------
// errorToTerminal — negative-duration clamp (A5(iii) round 7). A clock
// adjustment mid-run can make `Date.now() - startedAt` negative; the
// rendered duration must clamp to 0, matching probeResultToTerminal's A5(iv)
// posture.
// ---------------------------------------------------------------------------
describe("errorToTerminal (A5(iii) round 7)", () => {
  it("clamps a negative duration to 0", () => {
    const t = errorToTerminal("smoke:a", new Error("boom"), -250);
    expect(t.durationMs).toBe(0);
    expect(t.state).toBe("error");
    expect(t.error).toBe("boom");
  });

  it("passes a non-negative duration through", () => {
    expect(errorToTerminal("smoke:a", "boom", 42).durationMs).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// runDriverInputs — the shared per-level execution loop (A5(ii) round 7).
// The error path must record a thrown driver error under `input.key` — the
// SAME primary key the success path writes — not a reconstructed
// `<depth>:<slug>` string that drifts the moment an input keyspace differs
// (exactly the documented d5 fix, `d5-single-pill-e2e:<slug>`).
// ---------------------------------------------------------------------------
describe("runDriverInputs (A5(ii) round 7)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function silenceStdout(): void {
    vi.spyOn(console, "log").mockImplementation(() => {});
  }

  it("records a thrown driver error under input.key, including keys that differ from <depth>:<slug>", async () => {
    silenceStdout();
    const driver = {
      run: async (): Promise<ProbeResult<unknown>> => {
        throw new Error("driver boom");
      },
    };
    const results = await runDriverInputs(
      [{ key: "d5-single-pill-e2e:mastra" }],
      driver,
      fakeCtx(),
      null,
      fakeLogger(),
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.key).toBe("d5-single-pill-e2e:mastra");
    expect(results[0]!.state).toBe("error");
    expect(results[0]!.error).toBe("driver boom");
  });

  it("collects success results and best-effort persists them", async () => {
    silenceStdout();
    const written: string[] = [];
    const driver = {
      run: async (
        _ctx: ProbeContext,
        input: { key: string },
      ): Promise<ProbeResult<unknown>> => ({
        key: input.key,
        state: "green",
        signal: { latencyMs: 5 },
        observedAt: "2026-04-20T00:00:00Z",
      }),
    };
    // `: StatusWriter` (not call-site inference alone) so a drifting
    // WriteOutcome / OverlayWriteOutcome contract breaks THIS stub at
    // compile time, even if runDriverInputs's parameter type loosens.
    const writer: StatusWriter = {
      write: async (r: ProbeResult<unknown>) => {
        written.push(r.key);
        return {
          previousState: null,
          newState: "green" as const,
          transition: "first" as const,
          firstFailureAt: null,
          failCount: 0,
          persisted: true,
        };
      },
      writeOverlay: async () => ({
        applied: false,
        state: null,
        historyPersisted: false,
      }),
    };
    const results = await runDriverInputs(
      [{ key: "smoke:a" }, { key: "smoke:b" }],
      driver,
      fakeCtx(),
      writer,
      fakeLogger(),
    );
    expect(results.map((r) => r.key)).toEqual(["smoke:a", "smoke:b"]);
    expect(results.every((r) => r.state === "green")).toBe(true);
    expect(written).toEqual(["smoke:a", "smoke:b"]);
  });

  it("persists a thrown driver error through the PB writer under input.key (--live error rows)", async () => {
    // Red-green: the catch previously recorded a terminal line but skipped
    // bestEffortPbWrite — with --live an errored probe left NO PB row (stale
    // dashboard state) and was excluded from the dropped-write count.
    silenceStdout();
    const written: Array<ProbeResult<unknown>> = [];
    const writer: StatusWriter = {
      write: async (r: ProbeResult<unknown>) => {
        written.push(r);
        return {
          previousState: null,
          newState: "error" as const,
          errorStatePrev: null,
          transition: "error" as const,
          firstFailureAt: null,
          failCount: 1,
          persisted: true,
        };
      },
      writeOverlay: async () => ({
        applied: false,
        state: null,
        historyPersisted: false,
      }),
    };
    const driver = {
      run: async (): Promise<ProbeResult<unknown>> => {
        throw new Error("driver boom");
      },
    };
    const results = await runDriverInputs(
      [{ key: "d5-single-pill-e2e:mastra" }],
      driver,
      fakeCtx(),
      writer,
      fakeLogger(),
    );
    // Terminal line is kept …
    expect(results).toHaveLength(1);
    expect(results[0]!.state).toBe("error");
    // … AND an error-state row reaches the writer under the SAME primary key.
    expect(written).toHaveLength(1);
    expect(written[0]!.key).toBe("d5-single-pill-e2e:mastra");
    expect(written[0]!.state).toBe("error");
    expect((written[0]!.signal as Record<string, unknown>).errorDesc).toBe(
      "driver boom",
    );
  });

  it("a thrown driver error with a throwing PB writer stays best-effort (counted as dropped, run continues)", async () => {
    silenceStdout();
    const driver = {
      run: async (): Promise<ProbeResult<unknown>> => {
        throw new Error("driver boom");
      },
    };
    const writer: StatusWriter = {
      write: async (): Promise<never> => {
        throw new Error("pb down");
      },
      writeOverlay: async () => ({
        applied: false,
        state: null,
        historyPersisted: false,
      }),
    };
    const results = await runDriverInputs(
      [{ key: "smoke:a" }],
      driver,
      fakeCtx(),
      writer,
      fakeLogger(),
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.state).toBe("error");
  });

  it("a throwing PB write stays best-effort (run continues, result kept)", async () => {
    silenceStdout();
    const driver = {
      run: async (
        _ctx: ProbeContext,
        input: { key: string },
      ): Promise<ProbeResult<unknown>> => ({
        key: input.key,
        state: "green",
        signal: {},
        observedAt: "2026-04-20T00:00:00Z",
      }),
    };
    const writer: StatusWriter = {
      write: async () => {
        throw new Error("pb down");
      },
      writeOverlay: async () => ({
        applied: false,
        state: null,
        historyPersisted: false,
      }),
    };
    const results = await runDriverInputs(
      [{ key: "smoke:a" }],
      driver,
      fakeCtx(),
      writer,
      fakeLogger(),
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.state).toBe("green");
  });

  it("stops at an aborted signal", async () => {
    silenceStdout();
    const controller = new AbortController();
    controller.abort();
    const driver = {
      run: async (): Promise<ProbeResult<unknown>> => {
        throw new Error("must not run");
      },
    };
    const results = await runDriverInputs(
      [{ key: "smoke:a" }],
      driver,
      fakeCtx(controller.signal),
      null,
      fakeLogger(),
    );
    expect(results).toEqual([]);
  });
});
