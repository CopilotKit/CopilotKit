import { describe, it, expect } from "vitest";
// The barrier helpers live in a shared .mjs module (imported by BOTH the D5
// recorder and the hand-run D4 proxy-capture flow). Importing them here pulls
// in the pure functions only — no docker calls, no recording orchestration.
import {
  waitForJournalDrain,
  countCompletedTurns,
  // @ts-expect-error — plain .mjs module, no type declarations
} from "../lib/journal-drain.mjs";

/**
 * Build a minimal journal-entries payload with `completed` settled upstream
 * turns. Mixes the two completion shapes aimock actually emits:
 *   - RECORD upstream completion  → response.source === "proxy"
 *   - REPLAY completion           → response.status 200 + response.fixture set,
 *                                    response.source UNSET
 * plus one in-flight-ish non-200 entry that must NOT be counted.
 */
function journal(completed: number): unknown[] {
  const entries: unknown[] = [];
  for (let i = 0; i < completed; i++) {
    if (i % 2 === 0) {
      entries.push({
        response: { status: 200, source: "proxy", fixture: null },
      });
    } else {
      // Replay-shaped: fixture populated, source deliberately unset.
      entries.push({
        response: { status: 200, fixture: { match: {}, response: {} } },
      });
    }
  }
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
  it("counts proxy (record) AND fixture-replay 200s, ignores non-200 / unsettled", () => {
    expect(countCompletedTurns(journal(3))).toBe(3);
    expect(countCompletedTurns(journal(0))).toBe(0);
  });

  it("does NOT count a replay entry via source (source is unset on replay)", () => {
    // A replay 200 with a fixture but no source must still count. This guards
    // against the Mark-observed trap of gating on source === "fixture".
    const replayOnly = [
      { response: { status: 200, fixture: { match: {}, response: {} } } },
    ];
    expect(countCompletedTurns(replayOnly)).toBe(1);
  });

  it("tolerates malformed input", () => {
    expect(countCompletedTurns(null as unknown as unknown[])).toBe(0);
    expect(countCompletedTurns([{}, { response: null }])).toBe(0);
  });
});

describe("waitForJournalDrain", () => {
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

  it("WAITS for a still-draining post-tool-result turn, then proceeds (the race)", async () => {
    // Probe exited with only 2 of 3 turns settled; the post-tool-result turn
    // lands on the 3rd poll. The barrier must NOT return until it sees 3.
    const f = fakeJournalFetch([
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
    // Proves it polled past the premature 2/3 state before proceeding.
    expect(f.calls()).toBeGreaterThanOrEqual(3);
  });

  it("waits for QUIESCENCE even after the floor is met (no in-flight)", async () => {
    // Floor (expectedTurns=0) is met on poll 1, but the count keeps growing —
    // a late turn is still in flight. The barrier must not settle until the
    // count holds steady for the quiescence window.
    const f = fakeJournalFetch([
      journal(1),
      journal(2),
      journal(3),
      journal(3),
      journal(3),
    ]);
    const result = await waitForJournalDrain({
      expectedTurns: 0,
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
