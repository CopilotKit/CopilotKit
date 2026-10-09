import { describe, it, expect, vi } from "vitest";
// The barrier helpers live in a shared .mjs module (imported by BOTH the D5
// recorder and the hand-run D4 proxy-capture flow). Importing them here pulls
// in the pure functions only — no docker calls, no recording orchestration.
import {
  waitForJournalDrain,
  countCompletedTurns,
  // @ts-expect-error — plain .mjs module, no type declarations
} from "../lib/journal-drain.mjs";
// The abort-before-consolidate ordering seam from the D5 recorder. Imported for
// the timeout-abort test; importing does NOT run the recorder's main() (it is
// entry-module guarded), so no docker calls fire.
import {
  drainThenConsolidate,
  // @ts-expect-error — plain .mjs module, no type declarations
} from "../record-d5-fixtures.mjs";

/**
 * Build a minimal journal-entries payload with `drained` fully-drained upstream
 * turns. A DRAINED turn is ONLY the record path: `response.source === "proxy"`
 * (aimock appends it after the full upstream drain + fixture write). Replay
 * entries (`status:200` + `fixture` set, `source` unset) are appended at stream
 * START, so they are NOT drained and must never count — one is included here to
 * prove it is ignored, alongside an unsettled non-200.
 */
function journal(drained: number): unknown[] {
  const entries: unknown[] = [];
  for (let i = 0; i < drained; i++) {
    entries.push({
      response: { status: 200, source: "proxy", fixture: null },
    });
  }
  // Replay-shaped (fixture set, source unset) — replay started, NOT drained.
  entries.push({
    response: { status: 200, fixture: { match: {}, response: {} } },
  });
  // A not-yet-settled entry (no fixture, not proxied) — never counts.
  entries.push({ response: { status: 503, fixture: null } });
  return entries;
}

/** Fake fetch returning a scripted sequence of journal states as JSON. */
function fakeJournalFetch(states: unknown[][]): {
  fetchImpl: (
    url: string,
  ) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
  calls: () => number;
} {
  let i = 0;
  return {
    calls: () => i,
    fetchImpl: async () => {
      const entries = states[Math.min(i, states.length - 1)];
      i += 1;
      return { ok: true, status: 200, json: async () => entries };
    },
  };
}

describe("countCompletedTurns", () => {
  it("counts ONLY proxy (record) 200s; ignores replay, non-200, unsettled", () => {
    expect(countCompletedTurns(journal(3))).toBe(3);
    expect(countCompletedTurns(journal(0))).toBe(0);
  });

  it("does NOT count a replay entry as drained (fixture set, source unset)", () => {
    // A replay 200 with a fixture but no source means "replay started / matched,"
    // NOT "fully drained" — aimock journals it BEFORE it finishes streaming. It
    // must NOT count toward the drain floor. Guards against the Mark-observed trap
    // of treating `fixture != null` as a completion signal.
    const replayOnly = [
      { response: { status: 200, fixture: { match: {}, response: {} } } },
    ];
    expect(countCompletedTurns(replayOnly)).toBe(0);
  });

  it("tolerates malformed input", () => {
    expect(countCompletedTurns(null as unknown as unknown[])).toBe(0);
    expect(countCompletedTurns([{}, { response: null }])).toBe(0);
  });
});

describe("waitForJournalDrain", () => {
  it("requires expectedTurns — throws when it is omitted (no quiescence-only default)", async () => {
    // The unsound quiescence-only path (old `expectedTurns` defaulting to 0) is
    // gone: omitting expectedTurns must throw, not silently drain on quiescence.
    await expect(
      waitForJournalDrain({
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => [],
        }),
      }),
    ).rejects.toThrow(/expectedTurns is required/);
  });

  it("proceeds immediately when the journal is already drained", async () => {
    const f = fakeJournalFetch([journal(3)]);
    const result = await waitForJournalDrain({
      expectedTurns: 3,
      fetchImpl: f.fetchImpl,
      pollIntervalMs: 1,
      quiesceMs: 0,
    });
    expect(result.completed).toBe(3);
    // One poll is enough when quiesceMs is 0 and the count already satisfies.
    expect(f.calls()).toBe(1);
  });

  it("WAITS through a QUIESCENT stretch at N-1 for a slow final turn, then proceeds", async () => {
    // The race Mark flagged: the journal sits QUIESCENT at 2 drained turns for
    // several polls (the 3rd, post-tool-result turn is still in flight — INVISIBLE
    // in the journal until it lands), then the 3rd turn drains. With a real
    // expectedTurns=3 the barrier must NOT settle during the quiescent 2/3 stretch
    // (the old `expectedTurns: 0` behavior WOULD have settled at 2, moving fixtures
    // out from under the in-flight final turn). It must hold out for 3.
    const f = fakeJournalFetch([
      journal(2),
      journal(2),
      journal(2),
      journal(2),
      journal(3),
      journal(3),
    ]);
    const result = await waitForJournalDrain({
      expectedTurns: 3,
      fetchImpl: f.fetchImpl,
      pollIntervalMs: 1,
      quiesceMs: 0,
    });
    expect(result.completed).toBe(3);
    // Proves it polled through the premature 2/3 quiescent window before proceeding.
    expect(f.calls()).toBeGreaterThanOrEqual(5);
  });

  it("waits for QUIESCENCE even after the floor is met (no in-flight)", async () => {
    // Floor (expectedTurns=1) is met on poll 1, but the drained count keeps
    // growing — later turns are still landing. The barrier must not settle until
    // the count holds steady for the quiescence window.
    const f = fakeJournalFetch([
      journal(1),
      journal(2),
      journal(3),
      journal(3),
      journal(3),
    ]);
    const result = await waitForJournalDrain({
      expectedTurns: 1,
      fetchImpl: f.fetchImpl,
      pollIntervalMs: 1,
      quiesceMs: 15,
    });
    expect(result.completed).toBe(3);
    expect(f.calls()).toBeGreaterThanOrEqual(4);
  });

  it("times out with a clear error when the journal never drains", async () => {
    // Stuck at 2/3 forever — the post-tool-result turn never lands.
    const f = fakeJournalFetch([journal(2)]);
    await expect(
      waitForJournalDrain({
        expectedTurns: 3,
        fetchImpl: f.fetchImpl,
        pollIntervalMs: 2,
        quiesceMs: 0,
        timeoutMs: 40,
      }),
    ).rejects.toThrow(/did not drain within 40ms.*observed 2/s);
  });

  it("keeps polling through transient journal read failures", async () => {
    let i = 0;
    const fetchImpl = async () => {
      i += 1;
      if (i < 3) throw new Error("ECONNREFUSED (aimock mid-restart)");
      return { ok: true, status: 200, json: async () => journal(3) };
    };
    const result = await waitForJournalDrain({
      expectedTurns: 3,
      fetchImpl,
      pollIntervalMs: 1,
      quiesceMs: 0,
      timeoutMs: 2000,
    });
    expect(result.completed).toBe(3);
    expect(i).toBeGreaterThanOrEqual(3);
  });

  it("rejects an invalid expectedTurns", async () => {
    await expect(
      waitForJournalDrain({
        expectedTurns: -1,
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => [],
        }),
      }),
    ).rejects.toThrow(/non-negative integer/);
  });
});

describe("drainThenConsolidate (timeout is FATAL — fixtures NOT moved)", () => {
  it("aborts BEFORE consolidation when the drain barrier times out", async () => {
    // The whole point of the barrier: if the journal never drains, we must NOT
    // move / consolidate fixtures (they'd land in the next demo's directory or be
    // lost). A drain rejection must propagate and consolidation must never run.
    const consolidate = vi.fn(async () => ({ count: 0 }));
    const waitForDrain = vi.fn(async () => {
      throw new Error(
        "waitForJournalDrain: journal did not drain within 120000ms — expected >= 3",
      );
    });

    await expect(
      drainThenConsolidate({
        feature: "gen-ui-tool-based",
        waitForDrain,
        consolidate,
        log: () => {},
      }),
    ).rejects.toThrow(/did not drain/);

    // The critical assertion: consolidation (which moves fixtures) never ran.
    expect(consolidate).not.toHaveBeenCalled();
  });

  it("consolidates only after a successful drain", async () => {
    const consolidate = vi.fn(async () => ({ count: 7 }));
    const waitForDrain = vi.fn(async () => ({ completed: 3 }));

    const result = await drainThenConsolidate({
      feature: "tool-rendering-default-catchall",
      waitForDrain,
      consolidate,
      log: () => {},
    });

    expect(waitForDrain).toHaveBeenCalledTimes(1);
    expect(consolidate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ count: 7 });
  });
});
