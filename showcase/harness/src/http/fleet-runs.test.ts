/**
 * fleet-runs routes (T7) — §5.2/§5.2.1/§5.2.2/§5.2.3. Test names map to the
 * spec §8 route-test bullets: shape + probeKeyPrefix echo, the reds read
 * path, the ~5 s whole-body memo, 404, perPage clamp, composite (created,id)
 * cursor chaining, the 3-page fetch-loop cap, short-page cursor honesty, the
 * zero-complete-batch degenerate page, history_unavailable degradation, and
 * the §5.2 history-route bounds (keyed memo, 30-per-10 s window, LRU cap).
 *
 * Gate-assigned coverage: the T5 walk-back extension (run-view.ts projectFamily
 * multi-page lastSuccessAt) has no direct unit coverage — the multi-page
 * walk-back test below is the assigned coverage for it.
 */

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { ListOpts, ListResult, PbClient } from "../storage/pb-client.js";
import type { Logger } from "../types/index.js";
import type { JobStatus } from "../fleet/job-claim.js";
import type {
  JobProducer,
  TickOptions,
  TickResult,
} from "../fleet/control-plane/job-producer.js";
import {
  FLEET_PRODUCER_DEEP_SCHEDULE_ID,
  FLEET_PRODUCER_DEMOS_SCHEDULE_ID,
  FLEET_PRODUCER_SCHEDULE_ID,
  FLEET_PRODUCER_SMOKE_SCHEDULE_ID,
} from "../fleet/control-plane/control-plane.js";
import type { ProducerSchedule } from "../fleet/control-plane/control-plane.js";
import {
  FLEET_FAMILIES,
  createMemoizedFamilySummary,
} from "../fleet/control-plane/run-view.js";
import type {
  FamilySummaryResponse,
  ProbeJobRecord,
  RunBatch,
  RunViewDeps,
} from "../fleet/control-plane/run-view.js";
import {
  HISTORY_MEMO_MAX_KEYS,
  HISTORY_RATE_LIMIT_MAX,
  createLruTtlMemo,
  registerFleetRunsRoutes,
} from "./fleet-runs.js";
import type { FamilyHistoryResponse, RunDetailResponse } from "./fleet-runs.js";

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

/** Descending id generator: earlier-generated (newer) rows sort LARGER under
 *  the `-id` tiebreak, matching newest-first generation order. */
let idSeq = 0;
function nextId(): string {
  idSeq += 1;
  return `j-${String(1_000_000 - idSeq)}`;
}

interface RowOpts {
  family: string;
  runId: string;
  status?: JobStatus;
  created: string;
  updated?: string;
  enqueuedAt?: string;
  claimedAt?: string;
  finishedAt?: string;
  reclaimCount?: number;
  probeKey?: string;
  serviceSlug?: string;
  result?: unknown;
  claimedBy?: string;
  id?: string;
}

function row(opts: RowOpts): ProbeJobRecord {
  const enqueuedAt = opts.enqueuedAt ?? opts.created;
  const probeKey = opts.probeKey ?? `${opts.family}:langgraph-python`;
  return {
    id: opts.id ?? nextId(),
    probe_key: probeKey,
    status: opts.status ?? "done",
    claimed_by: opts.claimedBy ?? "worker-a",
    run_id: opts.runId,
    family: opts.family,
    created: opts.created,
    updated: opts.updated ?? opts.created,
    ...(opts.claimedAt ? { claimed_at: opts.claimedAt } : {}),
    ...(opts.finishedAt ? { finished_at: opts.finishedAt } : {}),
    ...(opts.reclaimCount !== undefined
      ? { reclaim_count: opts.reclaimCount }
      : {}),
    ...(opts.result !== undefined ? { result: opts.result } : {}),
    payload: {
      probeKey,
      serviceSlug: opts.serviceSlug ?? "langgraph-python",
      driverKind: "e2e_d6",
      meta: { runId: opts.runId, triggered: false, enqueuedAt },
    },
  };
}

/**
 * Generate `batchCount` batches × `size` rows, NEWEST first (batch 0 is the
 * newest). Within a batch all rows share the SAME `created` millisecond when
 * `sameMsWithinBatch` — the tight-loop-enqueue reality the composite cursor
 * exists for. Terminal rows get finished_at = created + 30 s.
 */
function batchFixture(
  family: string,
  batchCount: number,
  size: number,
  opts: {
    sameMsWithinBatch?: boolean;
    statusFor?: (batchIdx: number) => JobStatus;
    batchGapMs?: number;
    rowGapMs?: number;
    newestMs?: number;
    /**
     * Optional per-batch `result` payload. Returning a value with a `commError`
     * is how a fixture flags a batch as a real worker outage (the §5.2.1
     * terminal-completion predicate excludes batches with any commError, so
     * those batches do NOT count toward `lastSuccessAt`).
     */
    resultFor?: (batchIdx: number) => unknown;
  } = {},
): ProbeJobRecord[] {
  const batchGapMs = opts.batchGapMs ?? 3_600_000;
  const rowGapMs = opts.rowGapMs ?? 100;
  const newestMs = opts.newestMs ?? NOW_MS - 600_000;
  const rows: ProbeJobRecord[] = [];
  for (let b = 0; b < batchCount; b++) {
    const status = opts.statusFor ? opts.statusFor(b) : "done";
    const result = opts.resultFor ? opts.resultFor(b) : undefined;
    for (let r = 0; r < size; r++) {
      const createdMs =
        newestMs - b * batchGapMs - (opts.sameMsWithinBatch ? 0 : r * rowGapMs);
      const created = new Date(createdMs).toISOString();
      rows.push(
        row({
          family,
          runId: `${family}-b${b}`,
          status,
          created,
          ...(status === "done" || status === "failed"
            ? { finishedAt: new Date(createdMs + 30_000).toISOString() }
            : {}),
          ...(result !== undefined ? { result } : {}),
        }),
      );
    }
  }
  return rows;
}

interface FakeProbeRunRow {
  id: string;
  probe_id: string;
  job_id: string;
  started_at: string;
  summary: Record<string, unknown> | null;
}

/**
 * Fake PbClient honoring exactly the list() shapes the routes issue: the
 * probe_jobs family/run_id/composite-cursor filters, the probe_runs
 * `job_id = …` OR-join (the §5.2.1 reds read path) AND the §5.2.2 windowed
 * `probe_id ~` form (with `page` paging), and the workers list. Everything
 * else throws so accidental dependencies surface loudly. Records list calls
 * and filters per collection for the memo / cap / filter-shape assertions.
 */
function makeFakePb(opts: {
  jobs?: ProbeJobRecord[];
  probeRuns?: FakeProbeRunRow[];
  workers?: Array<Record<string, unknown>>;
  failFamilies?: string[];
}): { pb: PbClient; listCalls: string[]; listFilters: string[] } {
  const jobs = [...(opts.jobs ?? [])];
  const probeRuns = [...(opts.probeRuns ?? [])];
  const workers = [...(opts.workers ?? [])];
  const failFamilies = new Set(opts.failFamilies ?? []);
  const listCalls: string[] = [];
  const listFilters: string[] = [];
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
      listFilters.push(`${collection}|${filter}`);
      let items: unknown[];
      if (collection === "probe_jobs") {
        const fam = /family = "([^"]+)"/.exec(filter)?.[1];
        if (fam !== undefined && failFamilies.has(fam)) {
          throw new Error(`fake-pb: simulated outage for family ${fam}`);
        }
        let rows = jobs.filter((r) => r.family === fam);
        const runId = /run_id = "([^"]+)"/.exec(filter)?.[1];
        if (runId !== undefined) {
          rows = rows.filter((r) => r.run_id === runId);
        }
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
        if (filter.includes('job_id = "')) {
          // §5.2.1 reds read path: OR-join on the batch's job ids.
          const ids = new Set(
            [...filter.matchAll(/job_id = "([^"]+)"/g)].map((m) => m[1]),
          );
          items = probeRuns.filter((r) => ids.has(r.job_id));
        } else {
          // §5.2.2 windowed family-scoped list.
          const prefixRaw = /probe_id ~ "([^"]+)"/.exec(filter)?.[1] ?? "";
          const prefix = prefixRaw.endsWith("%")
            ? prefixRaw.slice(0, -1)
            : prefixRaw;
          const gte = /started_at >= "([^"]+)"/.exec(filter)?.[1];
          const lte = /started_at <= "([^"]+)"/.exec(filter)?.[1];
          let rows = probeRuns.filter(
            (r) => r.probe_id.startsWith(prefix) && r.job_id !== "",
          );
          if (gte !== undefined) {
            rows = rows.filter(
              (r) => Date.parse(r.started_at) >= Date.parse(gte),
            );
          }
          if (lte !== undefined) {
            rows = rows.filter(
              (r) => Date.parse(r.started_at) <= Date.parse(lte),
            );
          }
          rows = [...rows].sort((a, b) =>
            b.started_at.localeCompare(a.started_at),
          );
          const page = listOpts.page ?? 1;
          const perPage = listOpts.perPage ?? rows.length;
          items = rows.slice((page - 1) * perPage, page * perPage);
        }
      } else if (collection === "workers") {
        items = workers;
      } else {
        throw new Error(`fake-pb: unexpected collection ${collection}`);
      }
      return {
        page: listOpts.page ?? 1,
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
  return { pb, listCalls, listFilters };
}

/** A producer stub for ProducerSchedule entries (never ticked here). */
function stubProducer(): JobProducer {
  return {
    start: () => {},
    stop: async () => {},
    tick: async () => {
      throw new Error("stub producer must not tick in fleet-runs tests");
    },
    isRunning: () => false,
  };
}

/** Manual four-schedule manifest (ids from control-plane, crons arbitrary). */
function makeSchedules(): readonly ProducerSchedule[] {
  return [
    {
      scheduleId: FLEET_PRODUCER_SCHEDULE_ID,
      cron: "40 * * * *",
      producer: stubProducer(),
    },
    {
      scheduleId: FLEET_PRODUCER_SMOKE_SCHEDULE_ID,
      cron: "5,20,35,50 * * * *",
      producer: stubProducer(),
    },
    {
      scheduleId: FLEET_PRODUCER_DEMOS_SCHEDULE_ID,
      cron: "10 * * * *",
      producer: stubProducer(),
    },
    {
      scheduleId: FLEET_PRODUCER_DEEP_SCHEDULE_ID,
      cron: "15,30,45,0 * * * *",
      producer: stubProducer(),
    },
  ];
}

function makeApp(opts: { pb: PbClient; now?: () => number }): Hono {
  const app = new Hono();
  const now = opts.now ?? (() => NOW_MS);
  const rv: RunViewDeps = {
    pb: opts.pb,
    scheduler: { nextRunAt: () => null },
    schedules: makeSchedules(),
    workerStaleAfterMs: 180_000,
    logger: noopLogger,
    now,
  };
  registerFleetRunsRoutes(app, {
    summary: createMemoizedFamilySummary(rv),
    pb: opts.pb,
    schedules: rv.schedules,
    scheduler: rv.scheduler,
    workerStaleAfterMs: rv.workerStaleAfterMs,
    logger: noopLogger,
    now,
  });
  return app;
}

async function getJson<T>(
  app: Hono,
  path: string,
): Promise<{ status: number; body: T; res: Response }> {
  const res = await app.request(path);
  return { status: res.status, body: (await res.json()) as T, res };
}

// ───────────────────────────────────────────────────────────────────────
// GET /api/runs
// ───────────────────────────────────────────────────────────────────────

describe("GET /api/runs", () => {
  it("returns one entry per FLEET_FAMILIES member with probeKeyPrefix echoed", async () => {
    const { pb } = makeFakePb({});
    const app = makeApp({ pb });
    const { status, body } = await getJson<FamilySummaryResponse>(
      app,
      "/api/runs",
    );
    expect(status).toBe(200);
    expect(body.families.map((f) => f.family).sort()).toEqual(
      FLEET_FAMILIES.map((f) => f.family).sort(),
    );
    for (const fam of FLEET_FAMILIES) {
      const entry = body.families.find((f) => f.family === fam.family);
      expect(entry?.probeKeyPrefix).toBe(fam.probeKeyPrefix);
      expect(entry?.label).toBe(fam.label);
    }
  });

  it("serves Cache-Control: no-cache", async () => {
    const { pb } = makeFakePb({});
    const app = makeApp({ pb });
    const res = await app.request("/api/runs");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
  });

  it("two requests inside the memo TTL hit PB once; a post-TTL call recomputes", async () => {
    const { pb, listCalls } = makeFakePb({});
    let nowMs = NOW_MS;
    const app = makeApp({ pb, now: () => nowMs });
    await app.request("/api/runs");
    const afterFirst = listCalls.length;
    expect(afterFirst).toBeGreaterThan(0);
    await app.request("/api/runs");
    expect(listCalls.length).toBe(afterFirst);
    nowMs += 6_000; // past the ~5 s TTL
    await app.request("/api/runs");
    expect(listCalls.length).toBeGreaterThan(afterFirst);
  });

  it("reds read path: probe_runs joined on job_id, summed server-side, null when absent", async () => {
    const d6rows = batchFixture("d6", 1, 3);
    const d5rows = batchFixture("d5", 1, 2);
    const { pb } = makeFakePb({
      jobs: [...d6rows, ...d5rows],
      probeRuns: [
        {
          id: "pr-1",
          probe_id: "d6:langgraph-python",
          job_id: d6rows[0].id,
          started_at: d6rows[0].created,
          summary: { redsIntroduced: 1, redsCleared: 0 },
        },
        {
          id: "pr-2",
          probe_id: "d6:langgraph-python",
          job_id: d6rows[1].id,
          started_at: d6rows[1].created,
          summary: { redsIntroduced: 2, redsCleared: 1 },
        },
        // d5 row carries NO reds fields (pre-P2 history) → nulls.
        {
          id: "pr-3",
          probe_id: "d5:langgraph-python",
          job_id: d5rows[0].id,
          started_at: d5rows[0].created,
          summary: {},
        },
      ],
    });
    const app = makeApp({ pb });
    const { body } = await getJson<FamilySummaryResponse>(app, "/api/runs");
    const d6 = body.families.find((f) => f.family === "d6");
    expect(d6?.lastRun?.redsIntroduced).toBe(3);
    expect(d6?.lastRun?.redsCleared).toBe(1);
    const d5 = body.families.find((f) => f.family === "d5");
    expect(d5?.lastRun?.redsIntroduced).toBeNull();
    expect(d5?.lastRun?.redsCleared).toBeNull();
  });

  it("lastSuccessAt walk-back extends past page 1: a terminal-completion batch beyond the first 200 rows is found (gate-assigned T5 multi-page coverage)", async () => {
    // 20 outage batches × 10 rows fill page 1 exactly (200 rows, NOT
    // exhausted); the only terminal-completion batch sits on page 2 — the
    // walk-back extension must fetch beyond page 1 to find it. Each page-1
    // batch carries a `commError` on its result so it does NOT satisfy the
    // §5.2.1 terminal-completion predicate (cells-red without commError WOULD
    // qualify; that's the whole point of the redefinition).
    const failed = batchFixture("d6", 20, 10, {
      statusFor: () => "failed",
      batchGapMs: 3_600_000,
      resultFor: () => ({ commError: { kind: "worker-crashed-mid-job" } }),
    });
    const completedCreatedMs = NOW_MS - 600_000 - 20 * 3_600_000;
    const completed: ProbeJobRecord[] = [];
    for (let r = 0; r < 10; r++) {
      const createdMs = completedCreatedMs - r * 100;
      completed.push(
        row({
          family: "d6",
          runId: "d6-completed",
          status: "done",
          created: new Date(createdMs).toISOString(),
          finishedAt: new Date(createdMs + 30_000).toISOString(),
        }),
      );
    }
    const { pb, listCalls } = makeFakePb({ jobs: [...failed, ...completed] });
    const app = makeApp({ pb });
    const { body } = await getJson<FamilySummaryResponse>(app, "/api/runs");
    const d6 = body.families.find((f) => f.family === "d6");
    const expectedFinish = new Date(completedCreatedMs + 30_000).toISOString();
    expect(d6?.lastSuccessAt).toBe(expectedFinish);
    // Multi-page proof: the d6 projection issued >1 probe_jobs list.
    expect(listCalls.filter((c) => c === "probe_jobs").length).toBeGreaterThan(
      FLEET_FAMILIES.length,
    );
  });
});

// ───────────────────────────────────────────────────────────────────────
// GET /api/runs/:family
// ───────────────────────────────────────────────────────────────────────

describe("GET /api/runs/:family", () => {
  it("404s an unknown family", async () => {
    const { pb } = makeFakePb({});
    const app = makeApp({ pb });
    const { status, body } = await getJson<{ error: string }>(
      app,
      "/api/runs/nope",
    );
    expect(status).toBe(404);
    expect(body.error).toBe("not_found");
  });

  it("perPage clamps to [1,50], default 20", async () => {
    const jobs = batchFixture("d6", 25, 5);
    const build = () => makeApp({ pb: makeFakePb({ jobs }).pb });
    const def = await getJson<FamilyHistoryResponse>(build(), "/api/runs/d6");
    expect(def.body.perPage).toBe(20);
    expect(def.body.runs).toHaveLength(20);
    const high = await getJson<FamilyHistoryResponse>(
      build(),
      "/api/runs/d6?perPage=999",
    );
    expect(high.body.perPage).toBe(50);
    expect(high.body.runs).toHaveLength(25);
    const low = await getJson<FamilyHistoryResponse>(
      build(),
      "/api/runs/d6?perPage=0",
    );
    expect(low.body.perPage).toBe(1);
    expect(low.body.runs).toHaveLength(1);
    const junk = await getJson<FamilyHistoryResponse>(
      build(),
      "/api/runs/d6?perPage=abc",
    );
    expect(junk.body.perPage).toBe(20);
  });

  it("composite cursor: same-millisecond sibling rows are neither skipped nor duplicated across a page boundary", async () => {
    // 16 batches × 13 rows where every row in a batch shares ONE created
    // millisecond (tight-loop enqueue). The 200-row page boundary falls
    // mid-batch-16, so page 2 must resume among same-ms siblings via the
    // composite (created, id) cursor — bare `created <` would skip them.
    const jobs = batchFixture("e2e-demos", 16, 13, {
      sameMsWithinBatch: true,
    });
    const { pb } = makeFakePb({ jobs });
    const app = makeApp({ pb });
    const { body } = await getJson<FamilyHistoryResponse>(
      app,
      "/api/runs/e2e-demos?perPage=50",
    );
    expect(body.runs).toHaveLength(16);
    for (const run of body.runs) {
      expect(run.jobs.total).toBe(13); // no skip, no dup
    }
    expect(body.nextBefore).toBeNull();
    expect(body.nextBeforeId).toBeNull();
  });

  it("fetch loop stops at 3 PB pages (600 rows)", async () => {
    // 14 batches × 50 rows = 700 rows; every page is a full 200, so the
    // loop must stop on the hard cap, never the short-page break.
    const jobs = batchFixture("d6", 14, 50);
    const { pb, listCalls } = makeFakePb({ jobs });
    const app = makeApp({ pb });
    const { body } = await getJson<FamilyHistoryResponse>(app, "/api/runs/d6");
    expect(listCalls.filter((c) => c === "probe_jobs")).toHaveLength(3);
    // 600 rows = 12 groups; oldest discarded as potentially truncated.
    expect(body.runs).toHaveLength(11);
  });

  it("a short page carries a non-null advancing cursor (clients must not infer end-of-history)", async () => {
    const jobs = batchFixture("d6", 14, 50);
    const { pb } = makeFakePb({ jobs });
    const app = makeApp({ pb });
    const { body } = await getJson<FamilyHistoryResponse>(app, "/api/runs/d6");
    // 11 < perPage 20 — short page, but history is NOT exhausted.
    expect(body.runs.length).toBeLessThan(20);
    expect(body.nextBefore).not.toBeNull();
    expect(body.nextBeforeId).not.toBeNull();
  });

  it("zero-complete-batch page returns the partial batch flagged truncated:true with its runId and a non-null cursor strictly older than the supplied one", async () => {
    // One pathological 650-row batch: 3 capped pages never complete it.
    const jobs: ProbeJobRecord[] = [];
    for (let r = 0; r < 650; r++) {
      const createdMs = NOW_MS - 600_000 - r * 50;
      jobs.push(
        row({
          family: "d6",
          runId: "d6-huge",
          status: "done",
          created: new Date(createdMs).toISOString(),
          finishedAt: new Date(createdMs + 30_000).toISOString(),
        }),
      );
    }
    const { pb } = makeFakePb({ jobs });
    const app = makeApp({ pb });
    const before = iso(0); // strictly newer than every row
    const { status, body } = await getJson<FamilyHistoryResponse>(
      app,
      `/api/runs/d6?before=${encodeURIComponent(before)}`,
    );
    expect(status).toBe(200);
    expect(body.runs).toHaveLength(1);
    const partial = body.runs[0];
    expect(partial.truncated).toBe(true);
    expect(partial.runId).toBe("d6-huge");
    expect(partial.jobs.total).toBe(600); // fetched rows only (honest-partial)
    expect(partial.redsIntroduced).toBeNull();
    expect(partial.redsCleared).toBeNull();
    expect(body.nextBefore).not.toBeNull();
    expect(body.nextBeforeId).not.toBeNull();
    expect(Date.parse(body.nextBefore as string)).toBeLessThan(
      Date.parse(before),
    );
  });

  it("nextBefore/nextBeforeId are null only when history exhausted and every batch returned", async () => {
    const jobs = batchFixture("d6", 3, 5);
    const all = await getJson<FamilyHistoryResponse>(
      makeApp({ pb: makeFakePb({ jobs }).pb }),
      "/api/runs/d6",
    );
    expect(all.body.runs).toHaveLength(3);
    expect(all.body.nextBefore).toBeNull();
    expect(all.body.nextBeforeId).toBeNull();
    const partial = await getJson<FamilyHistoryResponse>(
      makeApp({ pb: makeFakePb({ jobs }).pb }),
      "/api/runs/d6?perPage=2",
    );
    expect(partial.body.runs).toHaveLength(2);
    expect(partial.body.nextBefore).not.toBeNull();
    expect(partial.body.nextBeforeId).not.toBeNull();
  });

  it("history reds: windowed family-scoped probe_runs list (anchored probe_id prefix) joined per batch; batches without summed rows report null", async () => {
    const jobs = batchFixture("d6", 2, 3);
    const newest = jobs.slice(0, 3);
    const { pb, listFilters } = makeFakePb({
      jobs,
      probeRuns: [
        {
          id: "pr-1",
          probe_id: "d6:langgraph-python",
          job_id: newest[0].id,
          started_at: newest[0].created,
          summary: { redsIntroduced: 2, redsCleared: 1 },
        },
      ],
    });
    const app = makeApp({ pb });
    const { body } = await getJson<FamilyHistoryResponse>(app, "/api/runs/d6");
    expect(body.runs).toHaveLength(2);
    expect(body.runs[0].redsIntroduced).toBe(2);
    expect(body.runs[0].redsCleared).toBe(1);
    expect(body.runs[1].redsIntroduced).toBeNull();
    expect(body.runs[1].redsCleared).toBeNull();
    const windowed = listFilters.find(
      (f) => f.startsWith("probe_runs|") && f.includes("~"),
    );
    expect(windowed).toContain('probe_id ~ "d6:%"');
    expect(windowed).toContain('job_id != ""');
  });

  it("same-key /api/runs/:family requests inside the TTL hit PB once", async () => {
    const { pb, listCalls } = makeFakePb({ jobs: batchFixture("d6", 2, 2) });
    const app = makeApp({ pb });
    await app.request("/api/runs/d6");
    const afterFirst = listCalls.length;
    await app.request("/api/runs/d6");
    expect(listCalls.length).toBe(afterFirst);
  });

  it("distinct before cursors miss the memo and trip the 30-per-10s window into 429 with Retry-After", async () => {
    const { pb } = makeFakePb({});
    const app = makeApp({ pb });
    for (let i = 0; i < HISTORY_RATE_LIMIT_MAX; i++) {
      const res = await app.request(
        `/api/runs/d6?before=${encodeURIComponent(iso(-(i + 1) * 1000))}`,
      );
      expect(res.status).toBe(200);
    }
    const res = await app.request(
      `/api/runs/d6?before=${encodeURIComponent(iso(-999_000))}`,
    );
    expect(res.status).toBe(429);
    const retryAfter = res.headers.get("Retry-After");
    expect(retryAfter).not.toBeNull();
    expect(Number.parseInt(retryAfter as string, 10)).toBeGreaterThanOrEqual(1);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("rate_limited");
  });

  it('a PB outage yields {error:"history_unavailable"} (HTTP 200), not a 500', async () => {
    const { pb } = makeFakePb({ failFamilies: ["d6"] });
    const app = makeApp({ pb });
    const { status, body } = await getJson<{
      family: string;
      error: string;
    }>(app, "/api/runs/d6");
    expect(status).toBe(200);
    expect(body.error).toBe("history_unavailable");
    expect(body.family).toBe("d6");
  });
});

// ───────────────────────────────────────────────────────────────────────
// GET /api/runs/:family/:runId
// ───────────────────────────────────────────────────────────────────────

describe("GET /api/runs/:family/:runId", () => {
  function detailFixture(): ProbeJobRecord[] {
    const createdMs = NOW_MS - 600_000;
    const created = new Date(createdMs).toISOString();
    return [
      row({
        family: "d5",
        runId: "run-detail",
        status: "failed",
        probeKey: "d5-single-pill-e2e:agno",
        serviceSlug: "agno",
        created,
        claimedAt: new Date(createdMs + 4_100).toISOString(),
        finishedAt: new Date(createdMs + 196_444).toISOString(),
        reclaimCount: 1,
        result: {
          rollup: { total: 8, passed: 6, failed: 2 },
          commError: {
            kind: "worker-crashed-mid-job",
            message: "SECRET-internal-host:8080 exploded",
            observedAt: new Date(createdMs + 196_000).toISOString(),
          },
        },
      }),
      row({
        family: "d5",
        runId: "run-detail",
        status: "failed",
        probeKey: "d5-single-pill-e2e:llamaindex",
        serviceSlug: "llamaindex",
        created: new Date(createdMs - 100).toISOString(),
        claimedAt: new Date(createdMs + 2_000).toISOString(),
        finishedAt: new Date(createdMs + 90_000).toISOString(),
        result: {
          commError: {
            kind: "not-a-real-kind",
            message: "ANOTHER-SECRET detail",
          },
        },
      }),
    ];
  }

  it("returns the per-job shape; commError.message never serialized; queueLatencyMs/durationMs/reclaimCount present", async () => {
    const { pb } = makeFakePb({ jobs: detailFixture() });
    const app = makeApp({ pb });
    const res = await app.request("/api/runs/d5/run-detail");
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain("SECRET");
    const body = JSON.parse(raw) as RunDetailResponse;
    expect(body.family).toBe("d5");
    expect(body.runId).toBe("run-detail");
    expect(body.jobs).toHaveLength(2);
    const agno = body.jobs.find((j) => j.serviceSlug === "agno");
    expect(agno?.probeKey).toBe("d5-single-pill-e2e:agno");
    expect(agno?.status).toBe("failed");
    expect(agno?.claimedBy).toBe("worker-a");
    expect(agno?.queueLatencyMs).toBe(4_100);
    expect(agno?.durationMs).toBe(196_444 - 4_100);
    expect(agno?.reclaimCount).toBe(1);
    expect(agno?.cells).toEqual({ total: 8, passed: 6, failed: 2 });
    expect(agno?.commError?.kind).toBe("worker-crashed-mid-job");
    // Unrecognized kinds map to "unknown" (closed vocabulary).
    const llama = body.jobs.find((j) => j.serviceSlug === "llamaindex");
    expect(llama?.commError?.kind).toBe("unknown");
    expect(llama?.reclaimCount).toBe(0);
  });

  it("404s an unknown family and an unknown runId", async () => {
    const { pb } = makeFakePb({ jobs: detailFixture() });
    const app = makeApp({ pb });
    expect((await app.request("/api/runs/nope/run-detail")).status).toBe(404);
    expect((await app.request("/api/runs/d5/run-unknown")).status).toBe(404);
  });

  it("a PB outage yields history_unavailable (HTTP 200), not a 500", async () => {
    const { pb } = makeFakePb({ failFamilies: ["d5"] });
    const app = makeApp({ pb });
    const { status, body } = await getJson<{ error: string }>(
      app,
      "/api/runs/d5/run-x",
    );
    expect(status).toBe(200);
    expect(body.error).toBe("history_unavailable");
  });
});

// ───────────────────────────────────────────────────────────────────────
// Keyed-memo LRU bound (§5.2 history-route bounds)
// ───────────────────────────────────────────────────────────────────────

describe("createLruTtlMemo", () => {
  it("keyed-memo LRU holds under >64 distinct keys (no unbounded growth)", async () => {
    const computes: string[] = [];
    const memo = createLruTtlMemo<number>({
      ttlMs: 60_000,
      maxKeys: HISTORY_MEMO_MAX_KEYS,
      now: () => 0,
    });
    for (let i = 0; i < HISTORY_MEMO_MAX_KEYS + 6; i++) {
      await memo.get(`k${i}`, async () => {
        computes.push(`k${i}`);
        return i;
      });
    }
    expect(memo.size()).toBe(HISTORY_MEMO_MAX_KEYS);
    // The oldest keys were evicted: k0 recomputes…
    await memo.get("k0", async () => {
      computes.push("k0-again");
      return -1;
    });
    expect(computes).toContain("k0-again");
    // …while a recent key is still a hit.
    const last = `k${HISTORY_MEMO_MAX_KEYS + 5}`;
    const hit = await memo.get(last, async () => {
      computes.push(`${last}-again`);
      return -2;
    });
    expect(hit).toBe(HISTORY_MEMO_MAX_KEYS + 5);
    expect(computes).not.toContain(`${last}-again`);
  });

  it("refreshes recency on hit and evicts rejected computations", async () => {
    const memo = createLruTtlMemo<number>({
      ttlMs: 60_000,
      maxKeys: 2,
      now: () => 0,
    });
    await memo.get("a", async () => 1);
    await memo.get("b", async () => 2);
    await memo.get("a", async () => 99); // hit — refreshes a's recency
    await memo.get("c", async () => 3); // evicts b (LRU), not a
    const a = await memo.get("a", async () => -1);
    expect(a).toBe(1);
    const b = await memo.get("b", async () => 42); // b was evicted
    expect(b).toBe(42);
    // Rejections are evicted so the next call retries.
    await expect(
      memo.get("z", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const z = await memo.get("z", async () => 7);
    expect(z).toBe(7);
  });
});

// ───────────────────────────────────────────────────────────────────────
// POST /api/runs/:family/trigger — on-demand fleet/D6 probe trigger
// ───────────────────────────────────────────────────────────────────────

const TRIGGER_TOKEN = "ops-secret-token";

/** A producer that RECORDS its tick calls so a route test can assert the
 *  enqueue path fired with the right (triggered + filter) options. */
function recordingProducer(): {
  producer: JobProducer;
  ticks: TickOptions[];
} {
  const ticks: TickOptions[] = [];
  const producer: JobProducer = {
    start: () => {},
    stop: async () => {},
    isRunning: () => true,
    tick: async (opts?: TickOptions): Promise<TickResult> => {
      ticks.push(opts ?? {});
      return {
        runId: "frun_test_1",
        // Two services enumerated + enqueued for this triggered run.
        enqueued: 2,
        enqueueFailures: 0,
        skippedForBacklog: 0,
        backlogGateFailedOpen: 0,
        truncatedByStop: 0,
        sweptExpired: false,
        sweepFailed: false,
        reclaimed: 0,
        enumerateFailed: false,
      };
    },
  };
  return { producer, ticks };
}

/**
 * Build an app whose four schedules each carry a RECORDING producer, plus the
 * token-gated trigger route. Returns the per-family recorders so a test can
 * assert which family's producer ticked.
 */
function makeTriggerApp(opts?: { withToken?: boolean; now?: () => number }): {
  app: Hono;
  ticksByFamily: Map<string, TickOptions[]>;
} {
  const app = new Hono();
  const now = opts?.now ?? (() => NOW_MS);
  const ticksByFamily = new Map<string, TickOptions[]>();
  // family → scheduleId via the SCHEDULE_ID constants directly (not
  // `fam.scheduleId`, which can be the import-cycle's undefined snapshot
  // depending on module load order — see the route's familyToScheduleId).
  const familyToScheduleId: Record<string, string> = {
    d6: FLEET_PRODUCER_SCHEDULE_ID,
    d5: FLEET_PRODUCER_DEEP_SCHEDULE_ID,
    "e2e-demos": FLEET_PRODUCER_DEMOS_SCHEDULE_ID,
    "e2e-smoke": FLEET_PRODUCER_SMOKE_SCHEDULE_ID,
  };
  const schedules: ProducerSchedule[] = FLEET_FAMILIES.map((fam) => {
    const { producer, ticks } = recordingProducer();
    ticksByFamily.set(fam.family, ticks);
    const scheduleId = familyToScheduleId[fam.family];
    const cron =
      scheduleId === FLEET_PRODUCER_SCHEDULE_ID ? "40 * * * *" : "0 * * * *";
    return { scheduleId, cron, producer };
  });
  const rv: RunViewDeps = {
    pb: makeFakePb({}).pb,
    scheduler: { nextRunAt: () => null },
    schedules,
    workerStaleAfterMs: 180_000,
    logger: noopLogger,
    now,
  };
  registerFleetRunsRoutes(app, {
    summary: createMemoizedFamilySummary(rv),
    pb: rv.pb,
    schedules,
    scheduler: rv.scheduler,
    workerStaleAfterMs: rv.workerStaleAfterMs,
    logger: noopLogger,
    now,
    ...(opts?.withToken === false ? {} : { triggerToken: TRIGGER_TOKEN }),
  });
  return { app, ticksByFamily };
}

describe("POST /api/runs/:family/trigger", () => {
  it("401s without a valid bearer token", async () => {
    const { app, ticksByFamily } = makeTriggerApp();
    const noAuth = await app.request("/api/runs/d6/trigger", {
      method: "POST",
    });
    expect(noAuth.status).toBe(401);
    const wrong = await app.request("/api/runs/d6/trigger", {
      method: "POST",
      headers: { Authorization: "Bearer nope" },
    });
    expect(wrong.status).toBe(401);
    // No producer ticked on a rejected trigger.
    expect(ticksByFamily.get("d6")).toEqual([]);
  });

  it("fires the D6 producer's triggered tick and reports the enqueue", async () => {
    const { app, ticksByFamily } = makeTriggerApp();
    const res = await app.request("/api/runs/d6/trigger", {
      method: "POST",
      headers: { Authorization: `Bearer ${TRIGGER_TOKEN}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      family: string;
      runId: string;
      enqueued: number;
    };
    expect(body.family).toBe("d6");
    expect(body.runId).toBe("frun_test_1");
    expect(body.enqueued).toBe(2);
    // The D6 producer ticked exactly once, as an OPERATOR-triggered run.
    const ticks = ticksByFamily.get("d6") ?? [];
    expect(ticks.length).toBe(1);
    expect(ticks[0].triggered).toBe(true);
    // Sibling families were not touched.
    expect(ticksByFamily.get("e2e-smoke")).toEqual([]);
  });

  it("fires the correct producer for a non-D6 fleet family", async () => {
    const { app, ticksByFamily } = makeTriggerApp();
    const res = await app.request("/api/runs/e2e-smoke/trigger", {
      method: "POST",
      headers: { Authorization: `Bearer ${TRIGGER_TOKEN}` },
    });
    expect(res.status).toBe(200);
    expect((ticksByFamily.get("e2e-smoke") ?? []).length).toBe(1);
    expect(ticksByFamily.get("d6")).toEqual([]);
  });

  it("forwards a slug/featureType filter to the producer tick", async () => {
    const { app, ticksByFamily } = makeTriggerApp();
    const res = await app.request("/api/runs/d6/trigger", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TRIGGER_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filter: { slugs: ["langgraph-python"], featureTypes: ["d6"] },
      }),
    });
    expect(res.status).toBe(200);
    const ticks = ticksByFamily.get("d6") ?? [];
    expect(ticks.length).toBe(1);
    expect(ticks[0].triggered).toBe(true);
    expect(ticks[0].filter).toEqual({
      slugs: ["langgraph-python"],
      featureTypes: ["d6"],
    });
  });

  it("404s for an unknown family", async () => {
    const { app } = makeTriggerApp();
    const res = await app.request("/api/runs/not-a-family/trigger", {
      method: "POST",
      headers: { Authorization: `Bearer ${TRIGGER_TOKEN}` },
    });
    expect(res.status).toBe(404);
  });
});
