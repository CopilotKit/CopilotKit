import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createResourceSnapshotWriter,
  RESOURCE_SNAPSHOTS_COLLECTION,
} from "./resource-snapshot-writer.js";
import type { SnapshotPbClient } from "./resource-snapshot-writer.js";
import type { ResourceGauges } from "./resource-gauges.js";
import type { BrowserPoolStats } from "./browser-pool.js";

function makeGauges(overrides?: Partial<ResourceGauges>): ResourceGauges {
  return {
    ts: "2026-06-04T00:00:00.000Z",
    selfFdCount: 42,
    treeThreadCount: 850,
    treeProcCount: 60,
    zombieCount: 0,
    selfRssMb: 120,
    treeRssMb: 900,
    cgroupPidsCurrent: 850,
    cgroupPidsMax: 1000,
    devShmUsedPct: 12,
    tmpInodeUsedPct: 3,
    tmpInodesUsed: 100,
    tmpInodesFree: 9000,
    tmpSpaceUsedPct: 20,
    tmpSpaceFreeMb: 5000,
    playwrightTmpDirs: 2,
    ...overrides,
  };
}

const STATS: BrowserPoolStats = {
  size: 24,
  available: 20,
  inUse: 4,
  totalRecycles: 1,
};

interface LogEntry {
  level: "info" | "warn" | "error";
  event: string;
  meta?: Record<string, unknown>;
}

function makeLogger(): {
  logger: {
    info: (e: string, m?: Record<string, unknown>) => void;
    warn: (e: string, m?: Record<string, unknown>) => void;
    error: (e: string, m?: Record<string, unknown>) => void;
  };
  logs: LogEntry[];
} {
  const logs: LogEntry[] = [];
  return {
    logger: {
      info: (event, meta) => logs.push({ level: "info", event, meta }),
      warn: (event, meta) => logs.push({ level: "warn", event, meta }),
      error: (event, meta) => logs.push({ level: "error", event, meta }),
    },
    logs,
  };
}

/** In-memory PB fake recording creates + supporting list/deleteByFilter for the
 *  retention path. Each row gets a stable `id` (insertion order, with a stable
 *  per-row sequence as a secondary sort key) so the writer's id-based,
 *  tie-robust prune can address rows individually even when `observed_at`
 *  collides at the same millisecond. */
function makeFakePb(): {
  pb: SnapshotPbClient;
  created: Array<Record<string, unknown>>;
} {
  const created: Array<Record<string, unknown>> = [];
  let seq = 0;
  // Sort newest-first by observed_at, tie-broken by insertion sequence DESC so
  // ordering is stable across same-millisecond rows.
  const newestFirst = (
    a: Record<string, unknown>,
    b: Record<string, unknown>,
  ): number => {
    const cmp = String(b.observed_at).localeCompare(String(a.observed_at));
    if (cmp !== 0) return cmp;
    return Number(b.__seq) - Number(a.__seq);
  };
  const pb: SnapshotPbClient = {
    async create(_collection, record) {
      const row = { id: `row-${seq}`, __seq: seq, ...record };
      seq += 1;
      created.push(row);
      return row as never;
    },
    async list(_collection, opts) {
      const sort = opts?.sort ?? "-observed_at";
      // "observed_at" => oldest first; "-observed_at" (or default) => newest.
      const sorted = [...created].sort(newestFirst);
      const ordered = sort.startsWith("-") ? sorted : [...sorted].reverse();
      const perPage = opts?.perPage ?? 30;
      const page = opts?.page ?? 1;
      const start = (page - 1) * perPage;
      const items = ordered.slice(start, start + perPage);
      return { totalItems: created.length, items: items as never[] };
    },
    async deleteByFilter(_collection, filter) {
      // The writer's tie-robust prune deletes by id: `id = "x" || id = "y"`.
      const ids = new Set(
        Array.from(filter.matchAll(/id = "([^"]+)"/g)).map((m) => m[1]),
      );
      // Back-compat: still honor a legacy `observed_at < "<cutoff>"` filter so a
      // strict-cutoff prune can be exercised directly if needed.
      const cutoffMatch = filter.match(/observed_at < "(.+)"/);
      const cutoff = cutoffMatch?.[1];
      const before = created.length;
      for (let i = created.length - 1; i >= 0; i--) {
        const row = created[i];
        if (ids.has(String(row.id))) {
          created.splice(i, 1);
        } else if (cutoff !== undefined && String(row.observed_at) < cutoff) {
          created.splice(i, 1);
        }
      }
      return before - created.length;
    },
  };
  return { pb, created };
}

describe("resource-snapshot-writer", () => {
  it("persists a snapshot row with the gauge + stats fields", async () => {
    const { pb, created } = makeFakePb();
    const { logger } = makeLogger();
    const writer = createResourceSnapshotWriter({ pb, logger });

    await writer.write("degraded", makeGauges(), STATS, [
      { index: 0, liveContexts: 2, servedContexts: 10, recycling: false },
    ]);

    expect(created).toHaveLength(1);
    const row = created[0];
    expect(row.event).toBe("degraded");
    expect(row.observed_at).toBe("2026-06-04T00:00:00.000Z");
    expect(row.pids_current).toBe(850);
    expect(row.pids_max).toBe(1000);
    expect(row.threads).toBe(850);
    expect(row.contexts_in_use).toBe(4);
    expect(row.contexts_available).toBe(20);
    expect(row.browsers).toBe(1);
    expect(Array.isArray(row.per_browser)).toBe(true);
  });

  it("BEST-EFFORT: a throwing PB create is swallowed (write resolves, does not reject) and logged", async () => {
    const throwingPb: SnapshotPbClient = {
      async create() {
        throw new Error("pb create failed: 400 missing collection");
      },
      async list() {
        return { totalItems: 0, items: [] };
      },
      async deleteByFilter() {
        return 0;
      },
    };
    const { logger, logs } = makeLogger();
    const writer = createResourceSnapshotWriter({ pb: throwingPb, logger });

    // MUST NOT reject — the pool's lifecycle paths call this and a throw would
    // break the pool (the prior incident: an unrun-migration 400 broke the
    // caller).
    await expect(
      writer.write("unrecoverable", makeGauges(), STATS),
    ).resolves.toBeUndefined();

    const failLog = logs.find(
      (l) => l.event === "resource-snapshot.write-failed",
    );
    expect(failLog).toBeDefined();
    expect(failLog?.level).toBe("warn");
  });

  it("RETENTION: prunes oldest rows beyond maxRows (ring-style)", async () => {
    const { pb, created } = makeFakePb();
    const { logger } = makeLogger();
    // Tiny cap + pruneIntervalMs:0 so every write prunes deterministically.
    const writer = createResourceSnapshotWriter({
      pb,
      logger,
      maxRows: 3,
      pruneIntervalMs: 0,
    });

    // Write 6 snapshots with strictly-increasing timestamps.
    for (let i = 0; i < 6; i++) {
      const ts = `2026-06-04T00:00:0${i}.000Z`;
      await writer.write("heartbeat", makeGauges({ ts }), STATS);
    }

    // Ring cap is 3 — only the 3 newest survive.
    expect(created).toHaveLength(3);
    const tss = created.map((r) => r.observed_at).sort();
    expect(tss).toEqual([
      "2026-06-04T00:00:03.000Z",
      "2026-06-04T00:00:04.000Z",
      "2026-06-04T00:00:05.000Z",
    ]);
  });

  it("RETENTION: does not prune when under cap", async () => {
    const { pb, created } = makeFakePb();
    const { logger } = makeLogger();
    const writer = createResourceSnapshotWriter({
      pb,
      logger,
      maxRows: 100,
      pruneIntervalMs: 0,
    });
    for (let i = 0; i < 5; i++) {
      await writer.write("heartbeat", makeGauges({ ts: `t${i}` }), STATS);
    }
    expect(created).toHaveLength(5);
  });

  it("RETENTION: converges to <= maxRows even when boundary timestamps are IDENTICAL (tie-robust)", async () => {
    // fix #2: observed_at is ms-resolution and snapshots can fire in the SAME
    // millisecond (degraded+heartbeat+crash). A bare `observed_at < cutoff`
    // strict compare would strand the surplus rows that tie the boundary
    // timestamp and spin forever (knownOverCap stays true, every insert re-runs
    // a full no-op sweep → unbounded growth). The id-based prune converges.
    const { pb, created } = makeFakePb();
    const { logger } = makeLogger();
    const writer = createResourceSnapshotWriter({
      pb,
      logger,
      maxRows: 3,
      pruneIntervalMs: 0,
    });

    // Write 6 snapshots that ALL share the exact same observed_at timestamp.
    const tied = "2026-06-04T00:00:00.000Z";
    for (let i = 0; i < 6; i++) {
      await writer.write("heartbeat", makeGauges({ ts: tied }), STATS);
    }

    // Ring cap is 3 — despite every row tying the boundary timestamp, retention
    // still converges to exactly maxRows.
    expect(created).toHaveLength(3);
  });

  it("RETENTION: rate-limit keeps prune off the steady-state insert path, but knownOverCap catches up over cap", async () => {
    // slot-6 F2: with pruneIntervalMs > 0 the rate-limit must keep the prune off
    // the hot insert path once it has run for the interval (steady state, under
    // cap), yet once over cap the knownOverCap flag must force a catch-up prune
    // on the NEXT insert rather than waiting a full interval.
    const { pb, created } = makeFakePb();
    const { logger, logs } = makeLogger();
    // Frozen clock: after the first insert's prove-probe, no further inserts in
    // this test advance past the interval, so a prune can ONLY recur via the
    // knownOverCap catch-up path (never via the rate-limit timer).
    const nowMs = 10 * 60_000; // > pruneIntervalMs so the first insert probes.
    const writer = createResourceSnapshotWriter({
      pb,
      logger,
      maxRows: 3,
      pruneIntervalMs: 60_000, // 1 min between rate-limited sweeps
      now: () => nowMs,
    });

    // Probe a list-call counter so we can prove inserts past the first do NOT
    // issue a list (the prune's first action) in steady state.
    let listCalls = 0;
    const origList = pb.list.bind(pb);
    pb.list = ((collection, opts) => {
      listCalls += 1;
      return origList(collection, opts);
    }) as typeof pb.list;

    // STEADY STATE (under cap): first insert probes once (lastPruneAt=0 → over
    // interval); subsequent inserts in the SAME frozen instant must NOT re-probe
    // because the rate-limit window has not elapsed and we are under cap.
    for (let i = 0; i < 3; i++) {
      await writer.write("heartbeat", makeGauges({ ts: `t${i}` }), STATS);
    }
    expect(created).toHaveLength(3);
    expect(listCalls).toBe(1); // only the first insert probed.

    // Go OVER cap, all within the SAME frozen instant. The insert that crosses
    // the cap trips knownOverCap; subsequent inserts must catch up and prune
    // even though the rate-limit interval has not elapsed (clock frozen).
    for (let i = 3; i < 7; i++) {
      await writer.write("heartbeat", makeGauges({ ts: `t${i}` }), STATS);
    }
    // Converged back to cap via the knownOverCap catch-up (NOT a timer wait).
    expect(created).toHaveLength(3);
    const prunedLogs = logs.filter(
      (l) => l.event === "resource-snapshot.pruned",
    );
    expect(prunedLogs.length).toBeGreaterThanOrEqual(1);
  });

  it("ESCALATION: after N consecutive failures escalates to logger.error ONCE, resets on success", async () => {
    // fix #3: systematic write failures (unrun migration / outage / schema
    // drift) must not silently no-op forever. After the threshold the writer
    // escalates ONCE to error (latched), the per-failure warn is throttled, and
    // a subsequent success resets the latch.
    let fail = true;
    const flakyPb: SnapshotPbClient = {
      async create() {
        if (fail) throw new Error("pb create failed: 400 missing collection");
        return {} as never;
      },
      async list() {
        return { totalItems: 0, items: [] };
      },
      async deleteByFilter() {
        return 0;
      },
    };
    const { logger, logs } = makeLogger();
    const writer = createResourceSnapshotWriter({
      pb: flakyPb,
      logger,
      failureEscalationThreshold: 5,
    });

    // 5 consecutive failures → exactly ONE error escalation.
    for (let i = 0; i < 5; i++) {
      await writer.write("heartbeat", makeGauges(), STATS);
    }
    const errs = logs.filter(
      (l) =>
        l.level === "error" &&
        l.event === "resource-snapshot.write-failing-systematically",
    );
    expect(errs).toHaveLength(1);

    // More failures must NOT re-fire the latched error.
    await writer.write("heartbeat", makeGauges(), STATS);
    expect(
      logs.filter(
        (l) => l.event === "resource-snapshot.write-failing-systematically",
      ),
    ).toHaveLength(1);

    // A success resets the latch; a subsequent failure burst can escalate again.
    fail = false;
    await writer.write("heartbeat", makeGauges(), STATS);
    fail = true;
    for (let i = 0; i < 5; i++) {
      await writer.write("heartbeat", makeGauges(), STATS);
    }
    expect(
      logs.filter(
        (l) => l.event === "resource-snapshot.write-failing-systematically",
      ),
    ).toHaveLength(2);
  });

  it("NULL SENTINEL: a -1 gauge is written to PB as null, not -1", async () => {
    // fix #4: the -1 "unavailable" sentinel (off-Linux / unreadable cgroup) must
    // be stored as null so post-wedge queries separate measured-vs-unavailable.
    const { pb, created } = makeFakePb();
    const { logger } = makeLogger();
    const writer = createResourceSnapshotWriter({ pb, logger });

    await writer.write(
      "heartbeat",
      makeGauges({
        cgroupPidsCurrent: -1,
        cgroupPidsMax: -1,
        treeThreadCount: -1,
        selfFdCount: -1,
        // A real (non-negative) reading must pass through unchanged.
        treeProcCount: 60,
      }),
      STATS,
    );

    const row = created[0];
    expect(row.pids_current).toBeNull();
    expect(row.pids_max).toBeNull();
    expect(row.threads).toBeNull();
    expect(row.fd_count).toBeNull();
    expect(row.procs).toBe(60);
  });

  it("IN-FLIGHT CAP: a write over the cap is DROPPED (emits dropped-over-inflight) and the in-flight counter does NOT leak", async () => {
    // item #1 (drop seam): with maxInFlight=1 and a never-resolving create, a
    // SECOND concurrent write must be dropped (warn), and once the hung write
    // resolves/frees its slot a LATER write must be admitted — proving the
    // in-flight counter didn't leak.
    let releaseFirst: (() => void) | undefined;
    const createCalls: string[] = [];
    let resolveCount = 0;
    const pb: SnapshotPbClient = {
      async create(_collection, record) {
        createCalls.push(String(record.event));
        // First create hangs until released; subsequent creates resolve.
        if (releaseFirst === undefined) {
          await new Promise<void>((r) => {
            releaseFirst = r;
          });
        }
        resolveCount += 1;
        return {} as never;
      },
      async list() {
        return { totalItems: 0, items: [] };
      },
      async deleteByFilter() {
        return 0;
      },
    };
    const { logger, logs } = makeLogger();
    const writer = createResourceSnapshotWriter({
      pb,
      logger,
      maxInFlightWrites: 1,
      // Disable the write timeout so the hang is what occupies the slot (not a
      // timer firing); we free it manually.
      writeTimeoutMs: 0,
    });

    // First write hangs (occupies the only in-flight slot).
    const firstWrite = writer.write("hung", makeGauges(), STATS);
    // Let the hung create register.
    await Promise.resolve();
    expect(createCalls).toEqual(["hung"]);

    // Second concurrent write is DROPPED — the cap (1) is saturated.
    await writer.write("dropped", makeGauges(), STATS);
    const dropLog = logs.find(
      (l) => l.event === "resource-snapshot.dropped-over-inflight",
    );
    expect(dropLog).toBeDefined();
    expect(dropLog?.level).toBe("warn");
    // The dropped write never reached create.
    expect(createCalls).toEqual(["hung"]);

    // Release the hung write — the slot frees.
    releaseFirst?.();
    await firstWrite;
    expect(resolveCount).toBe(1);

    // A LATER write is now ADMITTED (counter did not leak above the cap).
    await writer.write("after", makeGauges(), STATS);
    expect(createCalls).toEqual(["hung", "after"]);
    expect(resolveCount).toBe(2);
  });

  it("DROP (healthy backpressure): a drop while a write SUCCEEDS does NOT escalate", async () => {
    // item #2 (no false-positive): a single hung write that later succeeds is
    // healthy backpressure, not a systematic outage. A concurrent drop while
    // that write is in flight must NOT escalate once the write completes.
    let release: (() => void) | undefined;
    const pb: SnapshotPbClient = {
      async create() {
        if (release === undefined) {
          await new Promise<void>((r) => {
            release = r;
          });
        }
        return {} as never;
      },
      async list() {
        return { totalItems: 0, items: [] };
      },
      async deleteByFilter() {
        return 0;
      },
    };
    const { logger, logs } = makeLogger();
    const writer = createResourceSnapshotWriter({
      pb,
      logger,
      maxInFlightWrites: 1,
      writeTimeoutMs: 0,
      failureEscalationThreshold: 2,
    });

    const first = writer.write("slow", makeGauges(), STATS);
    await Promise.resolve();
    // A couple of drops occur while the first write is briefly in flight.
    await writer.write("drop", makeGauges(), STATS);
    await writer.write("drop", makeGauges(), STATS);
    // The slow write SUCCEEDS — proving the cap wasn't hung.
    release?.();
    await first;

    // No systematic-failure escalation (healthy backpressure, writes succeed).
    expect(
      logs.filter(
        (l) => l.event === "resource-snapshot.write-failing-systematically",
      ),
    ).toHaveLength(0);
  });

  describe("with fake timers", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("WRITE-TIMEOUT → failure → escalation: a hung create times out, counts as a failure, and escalates after the threshold", async () => {
      // item #1 (timeout seam) + #2: a hung pb.create must hit the write
      // timeout, be counted as a FAILURE, and after the threshold escalate to
      // the loud `write-failing-systematically` error.
      vi.useFakeTimers();
      const pb: SnapshotPbClient = {
        async create() {
          // Never resolves — only the write timeout frees the slot.
          await new Promise<void>(() => {});
          return {} as never;
        },
        async list() {
          return { totalItems: 0, items: [] };
        },
        async deleteByFilter() {
          return 0;
        },
      };
      const { logger, logs } = makeLogger();
      const writer = createResourceSnapshotWriter({
        pb,
        logger,
        writeTimeoutMs: 1_000,
        failureEscalationThreshold: 3,
        maxInFlightWrites: 8,
      });

      // Fire 3 writes; each hangs, then its 1s timeout fires → 3 failures.
      for (let i = 0; i < 3; i++) {
        const p = writer.write("heartbeat", makeGauges(), STATS);
        await vi.advanceTimersByTimeAsync(1_000);
        await p;
      }

      // The timeout was counted as a write failure and escalated once.
      const errs = logs.filter(
        (l) =>
          l.level === "error" &&
          l.event === "resource-snapshot.write-failing-systematically",
      );
      expect(errs).toHaveLength(1);
      // The failure record names the timeout (proves the timeout→failure seam).
      const failLog = logs.find(
        (l) => l.event === "resource-snapshot.write-failed",
      );
      expect(String(failLog?.meta?.error)).toContain("timed out");
    });

    it("DROP→ESCALATION: once writes are timing out, concurrent drops against the saturated cap CONTRIBUTE to the systematic-failure escalation", async () => {
      // item #2: with PB hung the in-flight cap saturates with timing-out
      // writes, so new snapshots increasingly hit the DROP path. A drop that
      // co-occurs with writes already FAILING (the hung writes have begun
      // timing out) must contribute to the failure signal so the loud
      // `write-failing-systematically` error is not delayed/dodged by the DROP
      // path. maxInFlightWrites:1 → after the first write hangs+times out
      // (failure #1), each subsequent drop while the cap is held escalates the
      // count, reaching the threshold via DROPS rather than only timeouts.
      vi.useFakeTimers();
      const pb: SnapshotPbClient = {
        async create() {
          await new Promise<void>(() => {}); // hung PB — only the timeout frees
          return {} as never;
        },
        async list() {
          return { totalItems: 0, items: [] };
        },
        async deleteByFilter() {
          return 0;
        },
      };
      const { logger, logs } = makeLogger();
      const writer = createResourceSnapshotWriter({
        pb,
        logger,
        maxInFlightWrites: 1,
        writeTimeoutMs: 1_000,
        failureEscalationThreshold: 4,
      });

      // Write A hangs and occupies the only slot; time it out → failure #1.
      const a = writer.write("hung", makeGauges(), STATS);
      await vi.advanceTimersByTimeAsync(1_000);
      await a;

      // Write B now hangs and re-occupies the slot. With consecutiveFailures>0,
      // concurrent DROPS contribute to escalation (not just future timeouts).
      const b = writer.write("hung", makeGauges(), STATS);
      await Promise.resolve();
      // 3 drops while B holds the slot → failures 2,3,4 → escalation fires.
      for (let i = 0; i < 3; i++) {
        await writer.write("drop", makeGauges(), STATS);
      }

      const errs = logs.filter(
        (l) =>
          l.level === "error" &&
          l.event === "resource-snapshot.write-failing-systematically",
      );
      expect(errs).toHaveLength(1);
      // A drop carried the escalating failure (proves the drop→escalation seam).
      const dropFail = logs.find(
        (l) =>
          l.event === "resource-snapshot.write-failed" &&
          l.meta?.event === "drop",
      );
      expect(String(dropFail?.meta?.error)).toContain("cap saturated");

      // Free B so no promise dangles past the test.
      await vi.advanceTimersByTimeAsync(1_000);
      await b;
    });
  });

  it("PRUNE no-progress backoff: a deleteByFilter that returns 0 while over cap does NOT sweep on every insert (gated by interval)", async () => {
    // item #1b: when deletes structurally make no progress (PB delete-rule 403,
    // filter 400, or 0 matched) while still over cap, the safety valve must NOT
    // let knownOverCap re-arm a full list-probe + sweep on EVERY subsequent
    // insert. The prune must back off to once-per-interval.
    const created: Array<Record<string, unknown>> = [];
    let seq = 0;
    let listCalls = 0;
    const pb: SnapshotPbClient = {
      async create(_c, record) {
        const row = { id: `row-${seq}`, __seq: seq, ...record };
        seq += 1;
        created.push(row);
        return row as never;
      },
      async list(_c, opts) {
        listCalls += 1;
        const sorted = [...created];
        const perPage = opts?.perPage ?? 30;
        return {
          totalItems: created.length,
          items: sorted.slice(0, perPage) as never[],
        };
      },
      // Delete ALWAYS fails to make progress (returns 0) — simulates a PB
      // delete-rule 403 / filter that matches nothing while still over cap.
      async deleteByFilter() {
        return 0;
      },
    };
    const { logger } = makeLogger();
    let clock = 1_000_000;
    const writer = createResourceSnapshotWriter({
      pb,
      logger,
      maxRows: 3,
      pruneIntervalMs: 60_000,
      now: () => clock,
    });

    // Fill past the cap so prune engages and hits the no-progress backoff.
    for (let i = 0; i < 6; i++) {
      await writer.write("heartbeat", makeGauges({ ts: `t${i}` }), STATS);
    }
    const listsAfterFill = listCalls;

    // Now insert MANY more within the SAME frozen instant (clock not advanced).
    // If the backoff works, NONE of these re-probe (no list calls) — the prune
    // is suppressed until the interval elapses, NOT re-armed per insert.
    for (let i = 6; i < 30; i++) {
      await writer.write("heartbeat", makeGauges({ ts: `t${i}` }), STATS);
    }
    expect(listCalls).toBe(listsAfterFill); // no per-insert re-probe

    // After the interval elapses, the rate-limit gate opens and ONE retry sweep
    // runs (head-probe + oldest-list), then backs off again. The point is the
    // retry is gated to the interval — it did not fire on any of the 24
    // intervening inserts.
    clock += 60_001;
    await writer.write("heartbeat", makeGauges({ ts: "t30" }), STATS);
    const listsAfterRetry = listCalls;
    expect(listsAfterRetry).toBeGreaterThan(listsAfterFill);

    // And it backs off AGAIN: further same-instant inserts do not re-probe.
    for (let i = 31; i < 40; i++) {
      await writer.write("heartbeat", makeGauges({ ts: `t${i}` }), STATS);
    }
    expect(listCalls).toBe(listsAfterRetry);
  });

  it("PRUNE batch cap: a cold start far over cap deletes in BOUNDED batches (not a thousands-row list/filter)", async () => {
    // item #1a: surplus can be thousands on a cold start over a large backlog;
    // using it directly as perPage + a one-clause-per-row id filter builds a
    // giant request URL that PB rejects (400/414). Each sweep must list/delete
    // at most a bounded batch (200) and rely on knownOverCap to drain the rest.
    const created: Array<Record<string, unknown>> = [];
    let seq = 0;
    const listPerPages: number[] = [];
    const deleteClauseCounts: number[] = [];
    // Seed 1500 rows directly (cold-start backlog) before the writer attaches.
    for (let i = 0; i < 1500; i++) {
      created.push({ id: `seed-${i}`, __seq: seq, observed_at: `s${i}` });
      seq += 1;
    }
    const pb: SnapshotPbClient = {
      async create(_c, record) {
        const row = { id: `row-${seq}`, __seq: seq, ...record };
        seq += 1;
        created.push(row);
        return row as never;
      },
      async list(_c, opts) {
        if (opts?.perPage !== undefined && opts.sort === "observed_at") {
          listPerPages.push(opts.perPage);
        }
        const perPage = opts?.perPage ?? 30;
        const page = opts?.page ?? 1;
        const start = (page - 1) * perPage;
        return {
          totalItems: created.length,
          items: created.slice(start, start + perPage) as never[],
        };
      },
      async deleteByFilter(_c, filter) {
        const ids = new Set(
          Array.from(filter.matchAll(/id = "([^"]+)"/g)).map((m) => m[1]),
        );
        deleteClauseCounts.push(ids.size);
        const before = created.length;
        for (let i = created.length - 1; i >= 0; i--) {
          if (ids.has(String(created[i].id))) created.splice(i, 1);
        }
        return before - created.length;
      },
    };
    const { logger } = makeLogger();
    const writer = createResourceSnapshotWriter({
      pb,
      logger,
      maxRows: 5,
      pruneIntervalMs: 0,
    });

    // One insert triggers the first (bounded) sweep.
    await writer.write("heartbeat", makeGauges({ ts: "x0" }), STATS);

    // Every prune list used a BOUNDED perPage (<= 200), never the ~1495 surplus.
    expect(listPerPages.length).toBeGreaterThan(0);
    for (const pp of listPerPages) {
      expect(pp).toBeLessThanOrEqual(200);
    }
    // Every delete filter had a BOUNDED clause count (<= 200).
    for (const cc of deleteClauseCounts) {
      expect(cc).toBeLessThanOrEqual(200);
    }

    // knownOverCap drains the rest across subsequent inserts; converges to cap.
    for (let i = 1; i < 20; i++) {
      await writer.write("heartbeat", makeGauges({ ts: `x${i}` }), STATS);
    }
    expect(created.length).toBeLessThanOrEqual(5);
  });

  it("uses the documented collection name", () => {
    expect(RESOURCE_SNAPSHOTS_COLLECTION).toBe("resource_snapshots");
  });

  it("WORKER_ID: stamps the configured workerId onto every row", async () => {
    // Per-replica attribution (migration 1779990000): a fleet replica's writer
    // is constructed with its stable workerId and MUST stamp it onto each
    // snapshot row so the 6 concurrent replicas writing the SAME collection are
    // attributable post-wedge.
    const { pb, created } = makeFakePb();
    const { logger } = makeLogger();
    const writer = createResourceSnapshotWriter({
      pb,
      logger,
      workerId: "worker-abc123",
    });

    await writer.write("heartbeat", makeGauges(), STATS);

    expect(created).toHaveLength(1);
    expect(created[0].worker_id).toBe("worker-abc123");
  });

  it('WORKER_ID: legacy boot() path (no workerId) stamps worker_id ""', async () => {
    // The legacy single-process boot() path constructs the writer with NO
    // workerId; it must write rows with worker_id "" (the unset-text-field
    // value PocketBase actually stores, matching the codebase convention) so a
    // query can separate fleet-replica rows from the legacy single-process
    // partition.
    const { pb, created } = makeFakePb();
    const { logger } = makeLogger();
    const writer = createResourceSnapshotWriter({ pb, logger });

    await writer.write("heartbeat", makeGauges(), STATS);

    expect(created).toHaveLength(1);
    expect(created[0].worker_id).toBe("");
  });

  it("WORKER_ID: a blank/whitespace workerId collapses to the legacy null partition", async () => {
    // A blank env (`HOSTNAME=""`) must not produce a literal "" worker; it
    // collapses to the legacy null-partition behavior.
    const { pb, created } = makeFakePb();
    const { logger } = makeLogger();
    const writer = createResourceSnapshotWriter({
      pb,
      logger,
      workerId: "   ",
    });

    await writer.write("heartbeat", makeGauges(), STATS);

    expect(created[0].worker_id).toBe("");
  });

  it("MULTI-WRITER: each replica prunes ONLY its own worker_id partition (never a peer's rows)", async () => {
    // The harness now runs as a FLEET: N replicas write the SAME collection.
    // The ring prune MUST be scoped per worker_id so a busy replica's history is
    // not pruned by an idle peer's sweep. With maxRows=3, writer-A writing 6 of
    // its own rows must converge to 3 A-rows while leaving B's rows untouched.

    // Shared in-memory store both writers' fake PBs operate on.
    const created: Array<Record<string, unknown>> = [];
    let seq = 0;
    // Filter the store by the worker_id scope filter the writer passes, so the
    // per-partition prune is exercised faithfully (the writer scopes its
    // head-count probe + oldest-list to `worker_id = "<id>"`).
    function matchScope(
      filter: string | undefined,
      row: Record<string, unknown>,
    ): boolean {
      if (!filter) return true;
      // workerId path: `worker_id = "worker-x"`.
      const eq = filter.match(/^worker_id = "([^"]*)"$/);
      if (eq) return String(row.worker_id ?? "") === eq[1];
      // legacy path: `worker_id = "" || worker_id = null`.
      if (filter.includes('worker_id = ""')) {
        return row.worker_id === null || row.worker_id === "";
      }
      return true;
    }
    function makeScopedPb(): SnapshotPbClient {
      return {
        async create(_c, record) {
          const row = { id: `row-${seq}`, __seq: seq, ...record };
          seq += 1;
          created.push(row);
          return row as never;
        },
        async list(_c, opts) {
          const scoped = created.filter((r) => matchScope(opts?.filter, r));
          const sort = opts?.sort ?? "-observed_at";
          const cmp = (
            a: Record<string, unknown>,
            b: Record<string, unknown>,
          ): number => {
            const c1 = String(b.observed_at).localeCompare(
              String(a.observed_at),
            );
            return c1 !== 0 ? c1 : Number(b.__seq) - Number(a.__seq);
          };
          const sorted = [...scoped].sort(cmp);
          // es2022-safe reverse (avoid toReversed; the harness tsconfig lib is
          // es2022).
          const ordered = sort.startsWith("-") ? sorted : [...sorted].reverse();
          const perPage = opts?.perPage ?? 30;
          const page = opts?.page ?? 1;
          const start = (page - 1) * perPage;
          return {
            totalItems: scoped.length,
            items: ordered.slice(start, start + perPage) as never[],
          };
        },
        async deleteByFilter(_c, filter) {
          const ids = new Set(
            Array.from(filter.matchAll(/id = "([^"]+)"/g)).map((m) => m[1]),
          );
          const before = created.length;
          for (let i = created.length - 1; i >= 0; i--) {
            if (ids.has(String(created[i].id))) created.splice(i, 1);
          }
          return before - created.length;
        },
      };
    }

    const { logger } = makeLogger();
    const writerA = createResourceSnapshotWriter({
      pb: makeScopedPb(),
      logger,
      workerId: "worker-A",
      maxRows: 3,
      pruneIntervalMs: 0,
    });
    const writerB = createResourceSnapshotWriter({
      pb: makeScopedPb(),
      logger,
      workerId: "worker-B",
      maxRows: 3,
      pruneIntervalMs: 0,
    });

    // B writes 2 rows (well under its own cap).
    await writerB.write("heartbeat", makeGauges({ ts: "b0" }), STATS);
    await writerB.write("heartbeat", makeGauges({ ts: "b1" }), STATS);

    // A writes 6 rows — A's partition is over its cap and must prune to 3.
    for (let i = 0; i < 6; i++) {
      await writerA.write("heartbeat", makeGauges({ ts: `a${i}` }), STATS);
    }

    const aRows = created.filter((r) => r.worker_id === "worker-A");
    const bRows = created.filter((r) => r.worker_id === "worker-B");
    // A converged to its own ring cap…
    expect(aRows).toHaveLength(3);
    // …and B's rows were NEVER touched by A's prune.
    expect(bRows).toHaveLength(2);
    // The surviving A rows are the 3 newest (a3/a4/a5), proving the prune
    // deleted A's oldest, not B's.
    expect(aRows.map((r) => r.observed_at).sort()).toEqual(["a3", "a4", "a5"]);
  });
});
