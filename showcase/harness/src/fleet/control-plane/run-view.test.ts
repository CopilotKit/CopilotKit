/**
 * run-view (T5) — family registry, run/worker projections, memoized family
 * summary. Every test name maps to a spec §8 testing bullet; the semantics
 * under test are §5.2.1 verbatim (outcome precedence, stalled rules,
 * walk-back, redaction) plus the §5.1 registry drift-lock.
 */

import { describe, expect, it } from "vitest";
import type {
  ListOpts,
  ListResult,
  PbClient,
} from "../../storage/pb-client.js";
import type { Logger } from "../../types/index.js";
import type { JobProducer } from "./job-producer.js";
import { buildProducerSchedules } from "../../orchestrator.js";
import type { ProducerSchedule } from "./control-plane.js";
import {
  FLEET_FAMILIES,
  classifyInflight,
  createMemoizedFamilySummary,
  deriveOutcome,
  groupBatches,
  periodMsFromCron,
  projectRunBatch,
  projectWorker,
} from "./run-view.js";
import type {
  FamilySummaryEntry,
  FamilySummaryResponse,
  ProbeJobRecord,
  RunViewDeps,
  WorkerRow,
} from "./run-view.js";

// ───────────────────────────────────────────────────────────────────────
// Fixtures
// ───────────────────────────────────────────────────────────────────────

const NOW_MS = Date.parse("2026-06-10T18:00:00.000Z");

function iso(offsetMs: number): string {
  return new Date(NOW_MS + offsetMs).toISOString();
}

const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

let nextRowId = 0;

/** Build one probe_jobs row. `created`/`updated` default to enqueuedAt. */
function jobRow(overrides: Partial<ProbeJobRecord> = {}): ProbeJobRecord {
  nextRowId += 1;
  const id = overrides.id ?? `row-${String(nextRowId).padStart(4, "0")}`;
  const enqueuedAt = iso(-60_000);
  const base: ProbeJobRecord = {
    id,
    probe_key: "d6:langgraph-python",
    status: "done",
    claimed_by: "worker-a",
    run_id: "run-1",
    family: "d6",
    created: enqueuedAt,
    updated: enqueuedAt,
    payload: {
      probeKey: "d6:langgraph-python",
      serviceSlug: "langgraph-python",
      driverKind: "e2e_d6",
      meta: { runId: "run-1", triggered: false, enqueuedAt },
    },
  };
  return { ...base, ...overrides };
}

/** Convenience: a row with payload.meta fields kept in sync. */
function batchRow(opts: {
  runId: string;
  id?: string;
  status?: ProbeJobRecord["status"];
  family?: string;
  probeKey?: string;
  enqueuedAt?: string;
  created?: string;
  updated?: string;
  finishedAt?: string;
  reclaimCount?: number;
  triggered?: boolean;
  result?: unknown;
  metaEnqueuedAt?: string;
}): ProbeJobRecord {
  const enqueuedAt = opts.enqueuedAt ?? iso(-60_000);
  return jobRow({
    ...(opts.id ? { id: opts.id } : {}),
    run_id: opts.runId,
    status: opts.status ?? "done",
    family: opts.family ?? "d6",
    probe_key: opts.probeKey ?? "d6:langgraph-python",
    created: opts.created ?? enqueuedAt,
    updated: opts.updated ?? opts.created ?? enqueuedAt,
    ...(opts.finishedAt ? { finished_at: opts.finishedAt } : {}),
    ...(opts.reclaimCount !== undefined
      ? { reclaim_count: opts.reclaimCount }
      : {}),
    ...(opts.result !== undefined ? { result: opts.result } : {}),
    payload: {
      probeKey: opts.probeKey ?? "d6:langgraph-python",
      serviceSlug: "langgraph-python",
      driverKind: "e2e_d6",
      meta: {
        runId: opts.runId,
        triggered: opts.triggered ?? false,
        enqueuedAt: opts.metaEnqueuedAt ?? enqueuedAt,
      },
    },
  });
}

interface FakeProbeRunRow {
  id: string;
  probe_id: string;
  job_id: string;
  started_at: string;
  summary: Record<string, unknown> | null;
}

interface FakeWorkerRow extends WorkerRow {
  id: string;
}

/**
 * Minimal fake PbClient mirroring queue-client.test.ts's makeFakePb: only
 * the list() shapes run-view issues are honored; everything else throws so
 * an accidental dependency surfaces loudly. Counts list calls per
 * collection for the memo tests.
 */
function makeFakePb(opts: {
  jobs?: ProbeJobRecord[];
  probeRuns?: FakeProbeRunRow[];
  workers?: FakeWorkerRow[];
  /** Families whose probe_jobs list throws (per-family degradation tests). */
  failFamilies?: string[];
}): { pb: PbClient; listCalls: string[] } {
  const jobs = [...(opts.jobs ?? [])];
  const probeRuns = [...(opts.probeRuns ?? [])];
  const workers = [...(opts.workers ?? [])];
  const failFamilies = new Set(opts.failFamilies ?? []);
  const listCalls: string[] = [];
  const unsupported = (name: string) => () => {
    throw new Error(`fake-pb: ${name} not implemented`);
  };
  const pb: PbClient = {
    async list<T>(
      collection: string,
      listOpts: ListOpts = {},
    ): Promise<ListResult<T>> {
      listCalls.push(collection);
      const filter = listOpts.filter ?? "";
      let items: unknown[];
      if (collection === "probe_jobs") {
        const fam = /family = "([^"]+)"/.exec(filter)?.[1];
        if (fam !== undefined && failFamilies.has(fam)) {
          throw new Error(`fake-pb: simulated outage for family ${fam}`);
        }
        let rows = jobs.filter((r) => r.family === fam);
        // Composite (created, id) cursor, when present.
        const before = /created [<=]+ "([^"]+)"/.exec(filter)?.[1];
        const beforeId = /id < "([^"]+)"/.exec(filter)?.[1];
        if (before !== undefined) {
          rows = rows.filter(
            (r) =>
              r.created < before ||
              (beforeId !== undefined &&
                r.created === before &&
                r.id < beforeId),
          );
        }
        rows = [...rows].sort((a, b) =>
          a.created === b.created
            ? b.id.localeCompare(a.id)
            : b.created.localeCompare(a.created),
        );
        items = rows.slice(0, listOpts.perPage ?? rows.length);
      } else if (collection === "probe_runs") {
        const ids = new Set(
          [...filter.matchAll(/job_id = "([^"]+)"/g)].map((m) => m[1]),
        );
        items = probeRuns.filter((r) => ids.has(r.job_id));
      } else if (collection === "workers") {
        items = workers;
      } else {
        throw new Error(`fake-pb: unexpected collection ${collection}`);
      }
      return {
        page: 1,
        perPage: listOpts.perPage ?? items.length,
        totalPages: 1,
        totalItems: items.length,
        items: items as T[],
      };
    },
    getOne: unsupported("getOne") as PbClient["getOne"],
    getFirst: unsupported("getFirst") as PbClient["getFirst"],
    create: unsupported("create") as PbClient["create"],
    update: unsupported("update") as PbClient["update"],
    upsertByField: unsupported("upsertByField") as PbClient["upsertByField"],
    delete: unsupported("delete") as PbClient["delete"],
    deleteByFilter: unsupported("deleteByFilter") as PbClient["deleteByFilter"],
    health: unsupported("health") as PbClient["health"],
    createBackup: unsupported("createBackup") as PbClient["createBackup"],
    downloadBackup: unsupported("downloadBackup") as PbClient["downloadBackup"],
    deleteBackup: unsupported("deleteBackup") as PbClient["deleteBackup"],
  };
  return { pb, listCalls };
}

/** A producer stub for ProducerSchedule entries (never ticked here). */
function stubProducer(): JobProducer {
  return {
    start: () => {},
    stop: async () => {},
    tick: async () => {
      throw new Error("stub producer must not tick in run-view tests");
    },
    isRunning: () => false,
  };
}

/** The real four-schedule manifest with an optional d6 cron override. */
function makeSchedules(d6Cron?: string): readonly ProducerSchedule[] {
  return buildProducerSchedules({
    d6: stubProducer(),
    smoke: stubProducer(),
    demos: stubProducer(),
    deep: stubProducer(),
    ...(d6Cron ? { d6Cron } : {}),
  });
}

function makeDeps(overrides: {
  pb: PbClient;
  schedules?: readonly ProducerSchedule[];
  workerStaleAfterMs?: number;
  nextRunAt?: (id: string) => Date | null;
  now?: () => number;
}): RunViewDeps {
  return {
    pb: overrides.pb,
    scheduler: { nextRunAt: overrides.nextRunAt ?? (() => null) },
    schedules: overrides.schedules ?? makeSchedules(),
    workerStaleAfterMs: overrides.workerStaleAfterMs ?? 180_000,
    logger: noopLogger,
    now: overrides.now ?? (() => NOW_MS),
  };
}

function familyEntry(
  summary: FamilySummaryResponse,
  family: string,
): FamilySummaryEntry {
  const entry = summary.families.find((f) => f.family === family);
  if (!entry) throw new Error(`no entry for family ${family}`);
  return entry;
}

// ───────────────────────────────────────────────────────────────────────
// Grouping + outcome precedence
// ───────────────────────────────────────────────────────────────────────

describe("groupBatches", () => {
  it("groups job rows into run batches by run_id newest-first", () => {
    const rows = [
      batchRow({ runId: "run-new", created: iso(-1_000), id: "n1" }),
      batchRow({ runId: "run-new", created: iso(-2_000), id: "n2" }),
      batchRow({ runId: "run-old", created: iso(-100_000), id: "o1" }),
      batchRow({ runId: "run-old", created: iso(-101_000), id: "o2" }),
    ];
    const groups = groupBatches(rows);
    expect(groups.map((g) => g.runId)).toEqual(["run-new", "run-old"]);
    expect(groups[0].rows.map((r) => r.id)).toEqual(["n1", "n2"]);
    expect(groups[1].rows.map((r) => r.id)).toEqual(["o1", "o2"]);
  });
});

describe("deriveOutcome (pinned precedence §5.2.1)", () => {
  it('outcome precedence: an abandoned batch with one failed and one zombie pending job derives "stalled", never "failed"', () => {
    const batch = {
      runId: "run-old",
      rows: [
        batchRow({ runId: "run-old", status: "failed" }),
        batchRow({ runId: "run-old", status: "pending" }),
      ],
    };
    expect(deriveOutcome(batch, true)).toBe("stalled");
  });

  it('outcome derives "failed" when >=1 surviving job failed and no newer batch exists', () => {
    const batch = {
      runId: "run-1",
      rows: [
        batchRow({ runId: "run-1", status: "failed" }),
        batchRow({ runId: "run-1", status: "done" }),
      ],
    };
    expect(deriveOutcome(batch, false)).toBe("failed");
  });

  it('outcome derives "completed" when all surviving jobs are done', () => {
    const batch = {
      runId: "run-1",
      rows: [
        batchRow({ runId: "run-1", status: "done" }),
        batchRow({ runId: "run-1", status: "done" }),
      ],
    };
    expect(deriveOutcome(batch, false)).toBe("completed");
  });
});

// ───────────────────────────────────────────────────────────────────────
// Inflight classification
// ───────────────────────────────────────────────────────────────────────

describe("classifyInflight", () => {
  const PERIOD_MS = 30 * 60_000; // 30 min → rule (a) 60 min, rule (c) 120 min

  it("returns null when the newest group is all-terminal", () => {
    const batch = {
      runId: "run-1",
      rows: [batchRow({ runId: "run-1", status: "done" })],
    };
    expect(classifyInflight(batch, PERIOD_MS, NOW_MS)).toBeNull();
  });

  it("counts jobs per status and reports elapsed since min(enqueuedAt)", () => {
    const batch = {
      runId: "run-1",
      rows: [
        batchRow({
          runId: "run-1",
          status: "pending",
          enqueuedAt: iso(-90_000),
        }),
        batchRow({
          runId: "run-1",
          status: "running",
          enqueuedAt: iso(-80_000),
        }),
        batchRow({ runId: "run-1", status: "done", enqueuedAt: iso(-70_000) }),
      ],
    };
    const inflight = classifyInflight(batch, PERIOD_MS, NOW_MS);
    expect(inflight).not.toBeNull();
    expect(inflight?.jobs).toEqual({
      pending: 1,
      claimed: 0,
      running: 1,
      done: 1,
      failed: 0,
    });
    expect(inflight?.elapsedMs).toBe(90_000);
    expect(inflight?.stalled).toBe(false);
  });

  it("inflight.stalled trips at 2x period (floor 30min) of no max(updated) progress", () => {
    const fresh = {
      runId: "run-1",
      rows: [
        batchRow({
          runId: "run-1",
          status: "pending",
          enqueuedAt: iso(-119 * 60_000),
          updated: iso(-59 * 60_000),
        }),
      ],
    };
    expect(classifyInflight(fresh, PERIOD_MS, NOW_MS)?.stalled).toBe(false);
    const silent = {
      runId: "run-1",
      rows: [
        batchRow({
          runId: "run-1",
          status: "pending",
          enqueuedAt: iso(-119 * 60_000),
          updated: iso(-61 * 60_000),
        }),
      ],
    };
    expect(classifyInflight(silent, PERIOD_MS, NOW_MS)?.stalled).toBe(true);
  });

  it("rule (c): a renewing-but-wedged batch past 4x period (floor 60min) of min(enqueuedAt) derives stalled despite fresh updated timestamps", () => {
    const wedged = {
      runId: "run-1",
      rows: [
        batchRow({
          runId: "run-1",
          status: "running",
          enqueuedAt: iso(-121 * 60_000),
          // Lease renewals keep bumping `updated` — rule (a) never trips.
          updated: iso(-1_000),
        }),
      ],
    };
    expect(classifyInflight(wedged, PERIOD_MS, NOW_MS)?.stalled).toBe(true);
  });

  it("applies the 30min/60min floors when the period is small", () => {
    const smallPeriod = 60_000; // 2x = 2min < 30min floor; 4x = 4min < 60min floor
    const young = {
      runId: "run-1",
      rows: [
        batchRow({
          runId: "run-1",
          status: "pending",
          enqueuedAt: iso(-29 * 60_000),
          updated: iso(-29 * 60_000),
        }),
      ],
    };
    expect(classifyInflight(young, smallPeriod, NOW_MS)?.stalled).toBe(false);
    const pastFloor = {
      runId: "run-1",
      rows: [
        batchRow({
          runId: "run-1",
          status: "pending",
          enqueuedAt: iso(-31 * 60_000),
          updated: iso(-31 * 60_000),
        }),
      ],
    };
    expect(classifyInflight(pastFloor, smallPeriod, NOW_MS)?.stalled).toBe(
      true,
    );
  });

  it("enqueuedAt falls back to the created column when payload.meta.enqueuedAt is unparseable, and the rule-(c) cap stays renewal-immune under the fallback", () => {
    const batch = {
      runId: "run-1",
      rows: [
        batchRow({
          runId: "run-1",
          status: "running",
          created: iso(-121 * 60_000),
          metaEnqueuedAt: "not-a-timestamp",
          updated: iso(-1_000), // renewing — only the created-based cap trips
        }),
      ],
    };
    const inflight = classifyInflight(batch, PERIOD_MS, NOW_MS);
    expect(inflight?.stalled).toBe(true);
    expect(inflight?.elapsedMs).toBe(121 * 60_000);
  });
});

// ───────────────────────────────────────────────────────────────────────
// Batch projection: reclaimed, redaction
// ───────────────────────────────────────────────────────────────────────

describe("projectRunBatch", () => {
  it("jobs.reclaimed counts jobs with reclaim_count > 0 once each", () => {
    const batch = {
      runId: "run-1",
      rows: [
        batchRow({ runId: "run-1", status: "done", reclaimCount: 2 }),
        batchRow({ runId: "run-1", status: "done", reclaimCount: 1 }),
        batchRow({ runId: "run-1", status: "done", reclaimCount: 0 }),
        batchRow({ runId: "run-1", status: "done" }),
      ],
    };
    const projected = projectRunBatch(batch, false);
    expect(projected.jobs).toEqual({
      total: 4,
      done: 4,
      failed: 0,
      reclaimed: 2,
    });
  });

  it("sums cells from job result rollups and computes durationMs = max(finished_at) - min(enqueuedAt)", () => {
    const batch = {
      runId: "run-1",
      rows: [
        batchRow({
          runId: "run-1",
          status: "done",
          enqueuedAt: iso(-600_000),
          finishedAt: iso(-100_000),
          result: { rollup: { total: 8, passed: 8, failed: 0 } },
        }),
        batchRow({
          runId: "run-1",
          status: "failed",
          enqueuedAt: iso(-590_000),
          finishedAt: iso(-50_000),
          result: { rollup: { total: 8, passed: 6, failed: 2 } },
        }),
      ],
    };
    const projected = projectRunBatch(batch, false);
    expect(projected.cells).toEqual({ total: 16, passed: 14, failed: 2 });
    expect(projected.finishedAt).toBe(iso(-50_000));
    expect(projected.enqueuedAt).toBe(iso(-600_000));
    expect(projected.durationMs).toBe(550_000);
    expect(projected.outcome).toBe("failed");
  });

  it('errorSummary and commErrorKinds never contain result.commError.message content; unrecognized kinds map to "unknown"', () => {
    const secret = "internal-host.railway.local:9090 exploded";
    const batch = {
      runId: "run-1",
      rows: [
        batchRow({
          runId: "run-1",
          status: "failed",
          probeKey: "d5-single-pill-e2e:agno",
          result: {
            commError: {
              kind: "worker-crashed-mid-job",
              message: secret,
              observedAt: iso(-1_000),
            },
          },
        }),
        batchRow({
          runId: "run-1",
          status: "failed",
          probeKey: "d5-single-pill-e2e:adk",
          result: {
            rollup: { total: 8, passed: 6, failed: 2 },
            commError: {
              kind: "totally-novel-kind",
              message: secret,
              observedAt: iso(-1_000),
            },
          },
        }),
      ],
    };
    const projected = projectRunBatch(batch, false);
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain("internal-host.railway.local");
    expect(serialized).not.toContain("exploded");
    expect(projected.commErrorKinds).toEqual([
      "worker-crashed-mid-job",
      "unknown",
    ]);
    expect(projected.errorSummary).toContain(
      "d5-single-pill-e2e:agno — worker-crashed-mid-job",
    );
    expect(projected.errorSummary).toContain(
      "d5-single-pill-e2e:adk — unknown",
    );
  });

  it("summarizes a red (no comm error) failed job from its cell counts", () => {
    const batch = {
      runId: "run-1",
      rows: [
        batchRow({
          runId: "run-1",
          status: "failed",
          probeKey: "d5-single-pill-e2e:agno",
          result: { rollup: { total: 8, passed: 6, failed: 2 } },
        }),
      ],
    };
    const projected = projectRunBatch(batch, false);
    expect(projected.errorSummary).toBe(
      "d5-single-pill-e2e:agno — 2/8 cells failed",
    );
  });

  it("carries null cells and null errorSummary when no job carries a result", () => {
    const batch = {
      runId: "run-1",
      rows: [batchRow({ runId: "run-1", status: "pending" })],
    };
    const projected = projectRunBatch(batch, true);
    expect(projected.cells).toBeNull();
    expect(projected.errorSummary).toBeNull();
    expect(projected.commErrorKinds).toEqual([]);
    expect(projected.outcome).toBe("stalled");
    expect(projected.finishedAt).toBeNull();
    expect(projected.durationMs).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────
// Cron resolution
// ───────────────────────────────────────────────────────────────────────

describe("periodMsFromCron", () => {
  it('periodMs computed from the resolved cron: "*/30 * * * *" -> 1800000', () => {
    expect(periodMsFromCron("*/30 * * * *")).toBe(1_800_000);
    expect(periodMsFromCron("40 * * * *")).toBe(3_600_000);
    expect(periodMsFromCron("*/15 * * * *")).toBe(900_000);
  });
});

// ───────────────────────────────────────────────────────────────────────
// Worker projection
// ───────────────────────────────────────────────────────────────────────

describe("projectWorker", () => {
  const STALE_AFTER_MS = 1_000; // non-default so the 1x/2x boundaries are explicit

  function workerRow(overrides: Partial<FakeWorkerRow> = {}): FakeWorkerRow {
    return {
      id: "w1",
      worker_id: "worker-railway-abc",
      endpoint: "http://worker-internal:8790",
      capacity_in_use: 1,
      capacity_available: 23,
      capacity_max: 24,
      current_job_id: "",
      last_heartbeat_at: iso(-100),
      registered_at: iso(-3_600_000),
      ...overrides,
    };
  }

  it("worker projection: online/stale/offline at 1x/2x an injected non-default workerStaleAfterMs", () => {
    expect(
      projectWorker(
        workerRow({ last_heartbeat_at: iso(-900) }),
        STALE_AFTER_MS,
        NOW_MS,
      ).health,
    ).toBe("online");
    expect(
      projectWorker(
        workerRow({ last_heartbeat_at: iso(-1_500) }),
        STALE_AFTER_MS,
        NOW_MS,
      ).health,
    ).toBe("stale");
    expect(
      projectWorker(
        workerRow({ last_heartbeat_at: iso(-2_500) }),
        STALE_AFTER_MS,
        NOW_MS,
      ).health,
    ).toBe("offline");
  });

  it("worker projection mirrors fleet-health's deriveHealth verbatim (unparseable falls into deriveHealth's treat-unknown-as-not-yet-stale default — same as fleet-health.ts:399 — so the two surfaces never disagree for the same row)", () => {
    const projected = projectWorker(
      workerRow({ last_heartbeat_at: "garbage-timestamp" }),
      STALE_AFTER_MS,
      NOW_MS,
    );
    // Aligned with fleet-health.ts:399's `deriveHealth(row.last_heartbeat_at, nowMs, staleAfterMs)`:
    // `isWorkerStale` returns false for an unparseable string, so deriveHealth
    // returns "online". The fleet-runs strip and the fleet-health monitor MUST
    // agree on this — that agreement is the bug this fix closes.
    expect(projected.health).toBe("online");
  });

  it("worker projection never serializes the endpoint column", () => {
    const projected = projectWorker(workerRow(), STALE_AFTER_MS, NOW_MS);
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain("endpoint");
    expect(serialized).not.toContain("worker-internal");
    expect(projected).toEqual({
      workerId: "worker-railway-abc",
      health: "online",
      lastHeartbeatAt: iso(-100),
      registeredAt: iso(-3_600_000),
      currentJobId: null,
      capacity: { inUse: 1, available: 23, max: 24 },
    });
  });

  it("projects registered_at to registeredAt, falling back to '' when the column is absent", () => {
    // The bounce signal the §7.4 banner / §9 monitor grace off; an absent
    // column (pre-migration / never-registered row) projects to "" (no
    // bounce instant), which disables the grace and preserves prior behavior.
    expect(
      projectWorker(
        workerRow({ registered_at: iso(-7_200_000) }),
        STALE_AFTER_MS,
        NOW_MS,
      ).registeredAt,
    ).toBe(iso(-7_200_000));
    expect(
      projectWorker(
        workerRow({ registered_at: undefined }),
        STALE_AFTER_MS,
        NOW_MS,
      ).registeredAt,
    ).toBe("");
  });

  it("maps an empty current_job_id to null and a set one to its value", () => {
    expect(
      projectWorker(workerRow({ current_job_id: "j9" }), STALE_AFTER_MS, NOW_MS)
        .currentJobId,
    ).toBe("j9");
    expect(
      projectWorker(workerRow({ current_job_id: "" }), STALE_AFTER_MS, NOW_MS)
        .currentJobId,
    ).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────
// Memoized family summary (the §5.2 shared seam)
// ───────────────────────────────────────────────────────────────────────

describe("createMemoizedFamilySummary", () => {
  it("family entry carries probeKeyPrefix echoed from FLEET_FAMILIES and one entry per member", async () => {
    const { pb } = makeFakePb({});
    const summary = await createMemoizedFamilySummary(makeDeps({ pb })).get();
    expect(summary.families.map((f) => f.family).sort()).toEqual(
      FLEET_FAMILIES.map((f) => f.family).sort(),
    );
    for (const fam of FLEET_FAMILIES) {
      const entry = familyEntry(summary, fam.family);
      expect(entry.probeKeyPrefix).toBe(fam.probeKeyPrefix);
      expect(entry.label).toBe(fam.label);
    }
  });

  it("d6 honors an injected non-default d6Cron (schedule string AND periodMs)", async () => {
    const { pb } = makeFakePb({});
    const summary = await createMemoizedFamilySummary(
      makeDeps({ pb, schedules: makeSchedules("*/5 * * * *") }),
    ).get();
    const d6 = familyEntry(summary, "d6");
    expect(d6.schedule).toBe("*/5 * * * *");
    expect(d6.periodMs).toBe(300_000);
    // The deep family resolves its own (non-overridden) cron.
    const d5 = familyEntry(summary, "d5");
    expect(d5.schedule).toBe("*/30 * * * *");
    expect(d5.periodMs).toBe(1_800_000);
  });

  it("serializes the scheduler's nextRunAt per family (null when unknown)", async () => {
    const { pb } = makeFakePb({});
    const next = new Date(NOW_MS + 35 * 60_000);
    const summary = await createMemoizedFamilySummary(
      makeDeps({
        pb,
        nextRunAt: (id) => (id === "fleet-job-producer" ? next : null),
      }),
    ).get();
    expect(familyEntry(summary, "d6").nextRunAt).toBe(next.toISOString());
    expect(familyEntry(summary, "d5").nextRunAt).toBeNull();
  });

  it("inflight is the newest group only — an older abandoned non-terminal batch is never selected as inflight", async () => {
    const { pb } = makeFakePb({
      jobs: [
        // Newest batch: all terminal (completed).
        batchRow({
          runId: "run-new",
          status: "done",
          enqueuedAt: iso(-10 * 60_000),
          finishedAt: iso(-5 * 60_000),
        }),
        // Older abandoned batch with a zombie pending row.
        batchRow({
          runId: "run-old",
          status: "pending",
          enqueuedAt: iso(-120 * 60_000),
        }),
        batchRow({
          runId: "run-old",
          status: "failed",
          enqueuedAt: iso(-120 * 60_000),
          finishedAt: iso(-115 * 60_000),
        }),
      ],
    });
    const summary = await createMemoizedFamilySummary(makeDeps({ pb })).get();
    const d6 = familyEntry(summary, "d6");
    expect(d6.inflight).toBeNull();
    expect(d6.lastRun?.runId).toBe("run-new");
    expect(d6.lastRun?.outcome).toBe("completed");
  });

  it("selects the newest non-terminal group as inflight and the next all-terminal-or-stalled group as lastRun", async () => {
    const { pb } = makeFakePb({
      jobs: [
        batchRow({
          runId: "run-live",
          status: "running",
          enqueuedAt: iso(-2 * 60_000),
        }),
        batchRow({
          runId: "run-prev",
          status: "done",
          enqueuedAt: iso(-70 * 60_000),
          finishedAt: iso(-65 * 60_000),
        }),
      ],
    });
    const summary = await createMemoizedFamilySummary(makeDeps({ pb })).get();
    const d6 = familyEntry(summary, "d6");
    expect(d6.inflight?.runId).toBe("run-live");
    expect(d6.inflight?.stalled).toBe(false);
    expect(d6.lastRun?.runId).toBe("run-prev");
  });

  it("lastSuccessAt walk-back: a newest done JOB inside a batch with a comm-error sibling does not count; the prior terminal-completion batch's finish wins", async () => {
    const { pb } = makeFakePb({
      jobs: [
        // Newest batch: NOT a terminal completion — one job carries a
        // worker-comm-level failure (`commError`). The done sibling's
        // finished_at is the newest timestamp anywhere, but a single
        // comm-erroring job disqualifies the whole batch.
        batchRow({
          runId: "run-failed",
          status: "done",
          enqueuedAt: iso(-10 * 60_000),
          finishedAt: iso(-1 * 60_000),
        }),
        batchRow({
          runId: "run-failed",
          status: "failed",
          enqueuedAt: iso(-10 * 60_000),
          finishedAt: iso(-2 * 60_000),
          result: { commError: { kind: "worker-crashed-mid-job" } },
        }),
        // Prior batch: terminal completion (all jobs done, no commError).
        batchRow({
          runId: "run-ok",
          status: "done",
          enqueuedAt: iso(-70 * 60_000),
          finishedAt: iso(-64 * 60_000),
        }),
        batchRow({
          runId: "run-ok",
          status: "done",
          enqueuedAt: iso(-70 * 60_000),
          finishedAt: iso(-66 * 60_000),
        }),
      ],
    });
    const summary = await createMemoizedFamilySummary(makeDeps({ pb })).get();
    const d6 = familyEntry(summary, "d6");
    expect(d6.lastRun?.outcome).toBe("failed");
    expect(d6.lastSuccessAt).toBe(iso(-64 * 60_000));
  });

  it("lastSuccessAt is null when every batch in the capped window has a commError (real outage)", async () => {
    // §5.2.1 "terminal completion" semantics: a `status: "failed"` job WITH
    // a `result.commError` means the worker couldn't reach the pool / crashed
    // / was reclaimed — that's NOT a terminal completion, it's a real outage
    // signal. Only when every batch in the window contains such jobs does
    // `lastSuccessAt` stay null. (Cell-level reds without commError are
    // covered by the "advances even with cell-fail counts" test below.)
    const { pb } = makeFakePb({
      jobs: [
        batchRow({
          runId: "run-1",
          status: "failed",
          enqueuedAt: iso(-10 * 60_000),
          finishedAt: iso(-9 * 60_000),
          result: { commError: { kind: "worker-crashed-mid-job" } },
        }),
        batchRow({
          runId: "run-0",
          status: "failed",
          enqueuedAt: iso(-70 * 60_000),
          finishedAt: iso(-69 * 60_000),
          result: { commError: { kind: "worker-crashed-mid-job" } },
        }),
      ],
    });
    const summary = await createMemoizedFamilySummary(makeDeps({ pb })).get();
    expect(familyEntry(summary, "d6").lastSuccessAt).toBeNull();
  });

  it("lastSuccessAt advances when all jobs reach a terminal state with no commError, even if cells failed", async () => {
    // Regression for the D5/D6 family-silence banner false alarm: chronic
    // content-reds left every batch's outcome="failed" (cell-level), which
    // under the OLD all-green-only definition pinned lastSuccessAt=null
    // forever and tripped the "worker family X has not completed successfully
    // since Yh ago" banner even though workers were healthy. Under the new
    // §5.2.1 terminal-completion definition, a batch where every job reached
    // a terminal state without a `commError` IS a successful evaluation
    // cycle — cells red, worker green.
    const { pb } = makeFakePb({
      jobs: [
        // Newest batch: every job terminal, one done one failed-with-reds,
        // both carry a rollup but NEITHER carries a commError.
        batchRow({
          runId: "run-recent",
          status: "done",
          probeKey: "d6:langgraph-python",
          enqueuedAt: iso(-10 * 60_000),
          finishedAt: iso(-9 * 60_000),
          result: { rollup: { total: 6, passed: 6, failed: 0 } },
        }),
        batchRow({
          runId: "run-recent",
          status: "failed",
          probeKey: "d6:crew",
          enqueuedAt: iso(-10 * 60_000),
          finishedAt: iso(-8 * 60_000),
          result: { rollup: { total: 6, passed: 3, failed: 3 } },
        }),
      ],
    });
    const summary = await createMemoizedFamilySummary(makeDeps({ pb })).get();
    const d6 = familyEntry(summary, "d6");
    // The §5.2.1 outcome precedence still derives "failed" for the run.
    expect(d6.lastRun?.outcome).toBe("failed");
    // But lastSuccessAt now reflects the worker terminally completing the
    // batch — the newest finished_at across the terminal-completion batch.
    expect(d6.lastSuccessAt).toBe(iso(-8 * 60_000));
  });

  it("lastSuccessAt does NOT count a batch where any job carries a commError (worker-outage signal)", async () => {
    const { pb } = makeFakePb({
      jobs: [
        // Newest batch: one done, one failed-with-commError → real outage,
        // does NOT count as a terminal completion.
        batchRow({
          runId: "run-outage",
          status: "done",
          probeKey: "d6:langgraph-python",
          enqueuedAt: iso(-5 * 60_000),
          finishedAt: iso(-4 * 60_000),
          result: { rollup: { total: 6, passed: 6, failed: 0 } },
        }),
        batchRow({
          runId: "run-outage",
          status: "failed",
          probeKey: "d6:crew",
          enqueuedAt: iso(-5 * 60_000),
          finishedAt: iso(-4 * 60_000),
          result: { commError: { kind: "worker-crashed-mid-job" } },
        }),
        // Prior batch: terminal completion, cells some-red but no commError —
        // this one DOES count.
        batchRow({
          runId: "run-prior",
          status: "failed",
          probeKey: "d6:langgraph-python",
          enqueuedAt: iso(-70 * 60_000),
          finishedAt: iso(-66 * 60_000),
          result: { rollup: { total: 6, passed: 5, failed: 1 } },
        }),
        batchRow({
          runId: "run-prior",
          status: "done",
          probeKey: "d6:crew",
          enqueuedAt: iso(-70 * 60_000),
          finishedAt: iso(-65 * 60_000),
          result: { rollup: { total: 6, passed: 6, failed: 0 } },
        }),
      ],
    });
    const summary = await createMemoizedFamilySummary(makeDeps({ pb })).get();
    const d6 = familyEntry(summary, "d6");
    // The newest batch is skipped (commError present); the prior batch wins.
    expect(d6.lastSuccessAt).toBe(iso(-65 * 60_000));
  });

  it("lastSuccessAt does NOT count a batch with non-terminal jobs (worker never finished)", async () => {
    // A `pending` or `claimed` job in the newest non-inflight slot means the
    // worker never reached a terminal state — that batch is a stall / abandon
    // signal, not a successful completion. (The actual newest-group is the
    // inflight and is excluded by run-view's existing skip; this fixture
    // exercises an OLDER stalled batch.)
    const { pb } = makeFakePb({
      jobs: [
        // Newest batch: live inflight (skipped by the existing rule).
        batchRow({
          runId: "run-live",
          status: "running",
          probeKey: "d6:langgraph-python",
          enqueuedAt: iso(-2 * 60_000),
        }),
        // Older batch: one job zombied pending (worker never finished).
        batchRow({
          runId: "run-stalled",
          status: "pending",
          probeKey: "d6:crew",
          enqueuedAt: iso(-70 * 60_000),
        }),
        batchRow({
          runId: "run-stalled",
          status: "done",
          probeKey: "d6:langgraph-python",
          enqueuedAt: iso(-70 * 60_000),
          finishedAt: iso(-65 * 60_000),
        }),
      ],
    });
    const summary = await createMemoizedFamilySummary(makeDeps({ pb })).get();
    expect(familyEntry(summary, "d6").lastSuccessAt).toBeNull();
  });

  it("redsIntroduced/redsCleared summed from probe_runs joined on job_id; null when no returned row carries the fields", async () => {
    const doneA = batchRow({
      runId: "run-1",
      status: "done",
      enqueuedAt: iso(-10 * 60_000),
      finishedAt: iso(-9 * 60_000),
    });
    const doneB = batchRow({
      runId: "run-1",
      status: "done",
      enqueuedAt: iso(-10 * 60_000),
      finishedAt: iso(-8 * 60_000),
    });
    const { pb } = makeFakePb({
      jobs: [doneA, doneB],
      probeRuns: [
        {
          id: "pr1",
          probe_id: "d6:langgraph-python",
          job_id: doneA.id,
          started_at: iso(-10 * 60_000),
          summary: {
            total: 8,
            passed: 7,
            failed: 1,
            redsIntroduced: 1,
            redsCleared: 0,
          },
        },
        {
          id: "pr2",
          probe_id: "d6:adk",
          job_id: doneB.id,
          started_at: iso(-10 * 60_000),
          summary: {
            total: 8,
            passed: 8,
            failed: 0,
            redsIntroduced: 2,
            redsCleared: 1,
          },
        },
      ],
    });
    const summary = await createMemoizedFamilySummary(makeDeps({ pb })).get();
    const d6 = familyEntry(summary, "d6");
    expect(d6.lastRun?.redsIntroduced).toBe(3);
    expect(d6.lastRun?.redsCleared).toBe(1);
  });

  it("serializes null reds when the joined probe_runs rows lack the fields (pre-P2 history)", async () => {
    const done = batchRow({
      runId: "run-1",
      status: "done",
      enqueuedAt: iso(-10 * 60_000),
      finishedAt: iso(-9 * 60_000),
    });
    const { pb } = makeFakePb({
      jobs: [done],
      probeRuns: [
        {
          id: "pr1",
          probe_id: "d6:langgraph-python",
          job_id: done.id,
          started_at: iso(-10 * 60_000),
          summary: { total: 8, passed: 8, failed: 0 },
        },
      ],
    });
    const summary = await createMemoizedFamilySummary(makeDeps({ pb })).get();
    const d6 = familyEntry(summary, "d6");
    expect(d6.lastRun?.redsIntroduced).toBeNull();
    expect(d6.lastRun?.redsCleared).toBeNull();
  });

  it("projects workers through the shared deriveHealth and never serializes endpoints", async () => {
    const { pb } = makeFakePb({
      workers: [
        {
          id: "w1",
          worker_id: "worker-railway-abc",
          endpoint: "http://worker-internal:8790",
          capacity_in_use: 0,
          capacity_available: 24,
          capacity_max: 24,
          current_job_id: "",
          last_heartbeat_at: iso(-1_000),
          registered_at: iso(-5_000),
        },
      ],
    });
    const summary = await createMemoizedFamilySummary(
      makeDeps({ pb, workerStaleAfterMs: 180_000 }),
    ).get();
    expect(summary.workers).toEqual([
      {
        workerId: "worker-railway-abc",
        health: "online",
        lastHeartbeatAt: iso(-1_000),
        // The bounce signal the §7.4 banner / §9 monitor grace off.
        registeredAt: iso(-5_000),
        currentJobId: null,
        capacity: { inUse: 0, available: 24, max: 24 },
      },
    ]);
    expect(JSON.stringify(summary.workers)).not.toContain("endpoint");
  });

  it('a PB list failure for one family yields that entry as {error:"history_unavailable"} while other families project normally', async () => {
    const { pb } = makeFakePb({
      jobs: [
        batchRow({
          runId: "run-1",
          status: "done",
          family: "d6",
          enqueuedAt: iso(-10 * 60_000),
          finishedAt: iso(-9 * 60_000),
        }),
      ],
      failFamilies: ["d5"],
    });
    const summary = await createMemoizedFamilySummary(makeDeps({ pb })).get();
    const d5 = familyEntry(summary, "d5");
    expect(d5.error).toBe("history_unavailable");
    expect(d5.probeKeyPrefix).toBe("d5-single-pill-e2e");
    expect(d5.lastRun).toBeUndefined();
    const d6 = familyEntry(summary, "d6");
    expect(d6.error).toBeUndefined();
    expect(d6.lastRun?.runId).toBe("run-1");
  });

  it("memo: two get() calls inside the TTL hit PB once; a post-TTL call recomputes", async () => {
    const { pb, listCalls } = makeFakePb({});
    let t = NOW_MS;
    const memo = createMemoizedFamilySummary(makeDeps({ pb, now: () => t }));
    await memo.get();
    const afterFirst = listCalls.length;
    expect(afterFirst).toBeGreaterThan(0);
    await memo.get();
    expect(listCalls.length).toBe(afterFirst);
    t += 5_001;
    await memo.get();
    expect(listCalls.length).toBe(afterFirst * 2);
  });
});

// ───────────────────────────────────────────────────────────────────────
// Drift-lock (§5.1)
// ───────────────────────────────────────────────────────────────────────

describe("FLEET_FAMILIES drift-lock", () => {
  it("FLEET_FAMILIES scheduleIds are set-equal to buildProducerSchedules(...) schedule ids", () => {
    const wired = new Set(makeSchedules().map((s) => s.scheduleId));
    const registry = new Set(FLEET_FAMILIES.map((f) => f.scheduleId));
    expect(registry).toEqual(wired);
  });

  it("carries no cron literals in the registry", () => {
    for (const fam of FLEET_FAMILIES) {
      expect(Object.keys(fam).sort()).toEqual([
        "family",
        "label",
        "probeKeyPrefix",
        "scheduleId",
      ]);
    }
  });
});
