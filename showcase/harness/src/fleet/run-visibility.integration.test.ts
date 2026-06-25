/**
 * Run-visibility INTEGRATION test (T15, spec §8): drives a REAL queue-client
 * (S3) + REAL run-view projections (T5) + REAL fleet-runs routes (T7) over an
 * in-memory fake PB + a hook-mirroring fake claim client, end to end:
 *
 *   enqueue → claim → release (incl. a lease-expiry reclaim asserting
 *   reclaim_count increments and jobs.reclaimed surfaces it) → GET /api/runs
 *   and GET /api/runs/:family/:runId.
 *
 * The ONLY fakes are the storage/CAS boundary (PB records API + the JSVM
 * claim/renew/release endpoints); everything in between is production code.
 */

import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { ListOpts, ListResult, PbClient } from "../storage/pb-client.js";
import type { Logger } from "../types/index.js";
import {
  type ClaimResult,
  type JobClaimClient,
  type JobStatus,
  type JobView,
  type ReleaseResult,
  type RenewResult,
} from "./job-claim.js";
import type { ServiceJobPayload, ServiceJobResult } from "./contracts.js";
import { createFleetQueueClient } from "./queue-client.js";
import {
  FLEET_PRODUCER_DEEP_SCHEDULE_ID,
  FLEET_PRODUCER_DEMOS_SCHEDULE_ID,
  FLEET_PRODUCER_SCHEDULE_ID,
  FLEET_PRODUCER_SMOKE_SCHEDULE_ID,
  type ProducerSchedule,
} from "./control-plane/control-plane.js";
import {
  createMemoizedFamilySummary,
  type FamilySummaryResponse,
  type RunViewDeps,
} from "./control-plane/run-view.js";
import type { JobProducer } from "./control-plane/job-producer.js";
import {
  registerFleetRunsRoutes,
  type RunDetailResponse,
} from "../http/fleet-runs.js";

// ───────────────────────────────────────────────────────────────────────
// Clock + fixtures
// ───────────────────────────────────────────────────────────────────────

const T0_MS = Date.parse("2026-06-10T12:00:00.000Z");

const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

/** Injected everywhere a "now" exists (fake claim, run-view, routes). */
interface FakeClock {
  now(): number;
  advance(ms: number): void;
}

function makeClock(): FakeClock {
  let nowMs = T0_MS;
  return {
    now: () => nowMs,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

function isoAt(clock: FakeClock): string {
  return new Date(clock.now()).toISOString();
}

/** ISO at T0 + offsetMs — assertion helper. */
function iso(offsetMs: number): string {
  return new Date(T0_MS + offsetMs).toISOString();
}

// ───────────────────────────────────────────────────────────────────────
// The shared in-memory probe_jobs store
// ───────────────────────────────────────────────────────────────────────

/** The full persisted row shape: JobView lifecycle columns + payload/result
 *  columns + the §4.2 run-metadata columns + PB system columns. */
interface FakeJobRow extends JobView {
  payload: ServiceJobPayload;
  result?: unknown;
  result_processed?: boolean;
  run_id: string;
  family: string;
  claimed_at?: string;
  finished_at?: string;
  reclaim_count?: number;
  created: string;
  updated: string;
}

function jobView(rec: FakeJobRow): JobView {
  return {
    id: rec.id,
    probe_key: rec.probe_key,
    status: rec.status,
    claimed_by: rec.claimed_by,
    lease_expires_at: rec.lease_expires_at,
    version: rec.version,
  };
}

// ───────────────────────────────────────────────────────────────────────
// Hook-mirroring fake claim client
// ───────────────────────────────────────────────────────────────────────

/**
 * THIS FAKE PINS THE fleet-claim.pb.js CONTRACT — CHANGE THEM TOGETHER.
 *
 * It mirrors the JSVM hook's claim/renew/release CAS semantics over the
 * in-memory store, INCLUDING the §4.2 run-metadata stamping the hook owns
 * (T1 is the normative source; verified live-contract semantics):
 *
 *   - `claimed_at` is stamped on EVERY winning claim — it deliberately
 *     RESTAMPS on a re-claim/steal so queueLatencyMs measures the LAST claim.
 *   - `reclaim_count` increments in EXACTLY the two choke points: the claim
 *     CAS's expired-lease steal, and the release CAS's pending re-queue
 *     (the sweeper path). Nowhere else.
 *   - `finished_at` is stamped ONLY on a terminal release (done|failed);
 *     a pending re-queue leaves it untouched (null until terminal).
 *   - terminal release is lease-gated (an expired holder LOST the row);
 *     `target === "pending"` is exempt — that is the sweeper operating on
 *     expired leases BY DESIGN.
 */
function makeHookMirroringClaim(
  store: FakeJobRow[],
  clock: FakeClock,
): JobClaimClient {
  const RUNNING_STATES: JobStatus[] = ["claimed", "running"];
  // Anchored space→"T" rewrite, byte-for-byte the hook's leaseExpired.
  const PB_DATE_SEP_RE = /^(\d{4}-\d{2}-\d{2}) /;
  const leaseExpired = (rec: FakeJobRow): boolean => {
    const raw = rec.lease_expires_at;
    if (!raw) return true;
    const t = Date.parse(String(raw).replace(PB_DATE_SEP_RE, "$1T"));
    if (Number.isNaN(t)) return true;
    return t <= clock.now();
  };
  const leaseExpiryIso = (leaseSeconds: number): string => {
    const secs = leaseSeconds && leaseSeconds > 0 ? leaseSeconds : 30;
    return new Date(clock.now() + secs * 1000).toISOString();
  };
  const find = (jobId: string): FakeJobRow | undefined =>
    store.find((r) => r.id === jobId);

  return {
    async claimJob(
      jobId: string,
      workerId: string,
      leaseSeconds: number,
    ): Promise<ClaimResult> {
      const rec = find(jobId);
      if (!rec) return { won: false };
      const status = rec.status;
      const reclaimable =
        status === "pending" ||
        (RUNNING_STATES.indexOf(status) !== -1 && leaseExpired(rec));
      if (!reclaimable) return { won: false };
      // Hook contract: capture WHICH branch won BEFORE mutating the record.
      // An expired-lease steal is the FIRST of the two reclaim choke points.
      const wasExpiredSteal =
        RUNNING_STATES.indexOf(status) !== -1 && leaseExpired(rec);
      rec.status = "claimed";
      rec.claimed_by = workerId;
      rec.lease_expires_at = leaseExpiryIso(leaseSeconds);
      rec.version = (rec.version || 0) + 1;
      // claimed_at is stamped on EVERY winning claim — deliberately restamps
      // on a re-claim/steal (§5.2.1: queueLatencyMs measures the LAST claim).
      rec.claimed_at = isoAt(clock);
      if (wasExpiredSteal) {
        rec.reclaim_count = (rec.reclaim_count || 0) + 1;
      }
      rec.updated = isoAt(clock);
      return { won: true, job: jobView(rec) };
    },

    async renewLease(
      jobId: string,
      workerId: string,
      leaseSeconds: number,
    ): Promise<RenewResult> {
      const rec = find(jobId);
      if (!rec) return { renewed: false };
      if (RUNNING_STATES.indexOf(rec.status) === -1) return { renewed: false };
      if (rec.claimed_by !== workerId) return { renewed: false };
      if (leaseExpired(rec)) return { renewed: false };
      rec.status = "running";
      rec.lease_expires_at = leaseExpiryIso(leaseSeconds);
      rec.version = (rec.version || 0) + 1;
      rec.updated = isoAt(clock);
      return { renewed: true, job: jobView(rec) };
    },

    async releaseJob(
      jobId: string,
      workerId: string,
      status: Extract<JobStatus, "done" | "failed" | "pending">,
    ): Promise<ReleaseResult> {
      const rec = find(jobId);
      if (!rec) return { released: false };
      if (RUNNING_STATES.indexOf(rec.status) === -1) return { released: false };
      if (rec.claimed_by !== workerId) return { released: false };
      // Terminal targets are lease-gated; pending (the sweeper re-queue)
      // operates on expired leases BY DESIGN and must proceed.
      if (status !== "pending" && leaseExpired(rec)) return { released: false };
      rec.status = status;
      if (status === "pending") {
        rec.claimed_by = "";
        rec.lease_expires_at = null;
        // Hook contract: the sweeper re-queue is the SECOND reclaim choke
        // point — bump the durable per-job reclaim tally. finished_at
        // deliberately stays untouched (a re-queued job has not finished).
        rec.reclaim_count = (rec.reclaim_count || 0) + 1;
      } else {
        // Hook contract: terminal release (done|failed) stamps the finish
        // time — the ONLY writer of finished_at.
        rec.finished_at = isoAt(clock);
      }
      rec.version = (rec.version || 0) + 1;
      rec.updated = isoAt(clock);
      return { released: true, job: jobView(rec) };
    },
  };
}

// ───────────────────────────────────────────────────────────────────────
// Fake PB over the same store
// ───────────────────────────────────────────────────────────────────────

/**
 * Fake PbClient honoring exactly the shapes this flow issues: queue-client's
 * status-filtered lists (claimNext / sweepExpired) and result-write update,
 * run-view's family/cursor lists (sort `-created,-id`), the detail route's
 * `family && run_id` list, the probe_runs reds join (empty here → reds null),
 * and the workers strip list (empty). Everything else throws so an accidental
 * dependency surfaces loudly.
 */
function makeFakePb(store: FakeJobRow[], clock: FakeClock): PbClient {
  const unsupported = (name: string) => () => {
    throw new Error(`fake-pb: ${name} not implemented`);
  };
  return {
    async create<T>(
      collection: string,
      record: Record<string, unknown>,
    ): Promise<T> {
      if (collection !== "probe_jobs") {
        throw new Error(`fake-pb: unexpected create on ${collection}`);
      }
      const row: FakeJobRow = {
        id: `j${store.length + 1}`,
        probe_key: String(record.probe_key),
        status: record.status as JobStatus,
        claimed_by: String(record.claimed_by ?? ""),
        lease_expires_at: (record.lease_expires_at as string | null) ?? null,
        version: Number(record.version ?? 0),
        payload: record.payload as ServiceJobPayload,
        run_id: String(record.run_id ?? ""),
        family: String(record.family ?? ""),
        created: isoAt(clock),
        updated: isoAt(clock),
      };
      store.push(row);
      return row as unknown as T;
    },

    async list<T>(
      collection: string,
      opts: ListOpts = {},
    ): Promise<ListResult<T>> {
      const filter = opts.filter ?? "";
      let items: unknown[];
      if (collection === "probe_jobs") {
        let rows = [...store];
        const statuses = new Set(
          [...filter.matchAll(/status\s*=\s*"(\w+)"/g)].map((m) => m[1]),
        );
        if (statuses.size > 0) {
          rows = rows.filter((r) => statuses.has(r.status));
        }
        const fam = /family = "([^"]*)"/.exec(filter)?.[1];
        if (fam !== undefined) rows = rows.filter((r) => r.family === fam);
        const runId = /run_id = "([^"]+)"/.exec(filter)?.[1];
        if (runId !== undefined) rows = rows.filter((r) => r.run_id === runId);
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
        if (opts.sort?.startsWith("-created")) {
          rows.sort((a, b) =>
            a.created === b.created
              ? b.id.localeCompare(a.id)
              : b.created.localeCompare(a.created),
          );
        }
        items = rows.slice(0, opts.perPage ?? rows.length);
      } else if (collection === "probe_runs" || collection === "workers") {
        // No probe_runs rows (reds stay null) and no workers in this flow.
        items = [];
      } else {
        throw new Error(`fake-pb: unexpected collection ${collection}`);
      }
      return {
        page: opts.page ?? 1,
        perPage: opts.perPage ?? items.length,
        totalPages: 1,
        totalItems: items.length,
        items: items as T[],
      };
    },

    async getOne<T>(collection: string, id: string): Promise<T | null> {
      if (collection !== "probe_jobs") {
        throw new Error(`fake-pb: unexpected getOne on ${collection}`);
      }
      return (store.find((r) => r.id === id) ?? null) as unknown as T | null;
    },

    async update<T>(
      collection: string,
      id: string,
      record: Record<string, unknown>,
    ): Promise<T> {
      if (collection !== "probe_jobs") {
        throw new Error(`fake-pb: unexpected update on ${collection}`);
      }
      const row = store.find((r) => r.id === id);
      if (!row) throw new Error(`fake-pb: update of missing row ${id}`);
      Object.assign(row as unknown as Record<string, unknown>, record);
      row.updated = isoAt(clock);
      return row as unknown as T;
    },

    getFirst: unsupported("getFirst") as PbClient["getFirst"],
    upsertByField: unsupported("upsertByField") as PbClient["upsertByField"],
    delete: unsupported("delete") as PbClient["delete"],
    deleteByFilter: unsupported("deleteByFilter") as PbClient["deleteByFilter"],
    health: unsupported("health") as PbClient["health"],
    createBackup: unsupported("createBackup") as PbClient["createBackup"],
    downloadBackup: unsupported("downloadBackup") as PbClient["downloadBackup"],
    deleteBackup: unsupported("deleteBackup") as PbClient["deleteBackup"],
  };
}

// ───────────────────────────────────────────────────────────────────────
// World wiring: real queue-client + real run-view + real routes
// ───────────────────────────────────────────────────────────────────────

function stubProducer(): JobProducer {
  return {
    start: () => {},
    stop: async () => {},
    tick: async () => {
      throw new Error("stub producer must not tick in this integration test");
    },
    isRunning: () => false,
  };
}

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

function makeWorld() {
  const clock = makeClock();
  const store: FakeJobRow[] = [];
  const claim = makeHookMirroringClaim(store, clock);
  const pb = makeFakePb(store, clock);
  const queue = createFleetQueueClient({ pb, claim, logger: noopLogger });
  const rvDeps: RunViewDeps = {
    pb,
    scheduler: { nextRunAt: () => null },
    schedules: makeSchedules(),
    workerStaleAfterMs: 180_000,
    logger: noopLogger,
    now: clock.now,
  };
  const app = new Hono();
  registerFleetRunsRoutes(app, {
    summary: createMemoizedFamilySummary(rvDeps),
    pb,
    schedules: rvDeps.schedules,
    scheduler: rvDeps.scheduler,
    workerStaleAfterMs: rvDeps.workerStaleAfterMs,
    logger: noopLogger,
    now: clock.now,
  });
  return { clock, store, claim, queue, app };
}

function payloadFor(
  slug: string,
  runId: string,
  enqueuedAt: string,
  probeKeyPrefix = "d5-single-pill-e2e",
): ServiceJobPayload {
  return {
    probeKey: `${probeKeyPrefix}:${slug}`,
    serviceSlug: slug,
    driverKind: "e2e_d5",
    meta: { runId, triggered: false, enqueuedAt },
  };
}

function greenResult(
  jobId: string,
  payload: ServiceJobPayload,
  workerId: string,
  finishedAt: string,
): ServiceJobResult {
  return {
    jobId,
    probeKey: payload.probeKey,
    serviceSlug: payload.serviceSlug,
    runId: payload.meta.runId,
    workerId,
    aggregateState: "green",
    aggregateKey: payload.probeKey,
    aggregateSignal: { failedCount: 0 },
    cells: [],
    rollup: { total: 1, passed: 1, failed: 0 },
    finishedAt,
  };
}

// ───────────────────────────────────────────────────────────────────────
// The integration flow
// ───────────────────────────────────────────────────────────────────────

describe("run-visibility integration: enqueue→claim→release→/api/runs", () => {
  it("projects a 3-job batch with a sweeper lease-expiry reclaim into /api/runs and the run detail", async () => {
    const { clock, store, queue, app } = makeWorld();
    const runId = "run-d5-001";

    // ── Enqueue a 3-job d5 batch at T0.
    const slugs = ["svc-a", "svc-b", "svc-c"] as const;
    for (const slug of slugs) {
      await queue.enqueue({
        payload: payloadFor(slug, runId, iso(0)),
        family: "d5",
      });
    }
    expect(store).toHaveLength(3);
    expect(store.every((r) => r.family === "d5" && r.run_id === runId)).toBe(
      true,
    );

    // ── Claim all three at T0+1 s (worker-1, 30 s lease).
    clock.advance(1_000);
    const leases = new Map<string, { jobId: string }>();
    for (let i = 0; i < 3; i++) {
      const claimed = await queue.claimNext("worker-1", 30);
      expect(claimed.claimed).toBe(true);
      const lease = claimed.lease;
      if (!lease) throw new Error("claimed without a lease");
      leases.set(lease.payload.serviceSlug, { jobId: lease.job.id });
    }
    // Hook contract: claimed_at stamped on EVERY winning claim; reclaim_count
    // untouched by a plain pending claim.
    for (const row of store) {
      expect(row.claimed_at).toBe(iso(1_000));
      expect(row.reclaim_count ?? 0).toBe(0);
    }

    // ── Release svc-a + svc-b done at T0+5 s.
    clock.advance(4_000);
    for (const slug of ["svc-a", "svc-b"] as const) {
      const handle = leases.get(slug);
      if (!handle) throw new Error(`no lease recorded for ${slug}`);
      const row = store.find((r) => r.id === handle.jobId);
      if (!row) throw new Error(`no row for ${slug}`);
      await queue.report({
        jobId: handle.jobId,
        workerId: "worker-1",
        result: greenResult(handle.jobId, row.payload, "worker-1", iso(5_000)),
      });
    }
    // Hook contract: terminal release stamps finished_at.
    const doneRows = store.filter((r) => r.status === "done");
    expect(doneRows).toHaveLength(2);
    for (const row of doneRows) {
      expect(row.finished_at).toBe(iso(5_000));
    }

    // ── Let svc-c's lease (expires T0+31 s) lapse; sweep at T0+45 s.
    clock.advance(40_000);
    const sweep = await queue.sweepExpired(clock.now());
    expect(sweep.reclaimed).toBe(1);
    expect(sweep.commErrors).toHaveLength(1);
    expect(sweep.commErrors[0].kind).toBe("worker-reclaimed-pending");
    // Hook contract: the sweeper's pending re-queue is the SECOND reclaim
    // choke point — reclaim_count bumps, ownership drops, finished_at stays
    // untouched (a re-queued job has not finished), claimed_at keeps the
    // prior claim's stamp until the NEXT winning claim restamps it.
    const cHandle = leases.get("svc-c");
    if (!cHandle) throw new Error("no lease recorded for svc-c");
    const rowC = store.find((r) => r.id === cHandle.jobId);
    if (!rowC) throw new Error("no row for svc-c");
    expect(rowC.status).toBe("pending");
    expect(rowC.claimed_by).toBe("");
    expect(rowC.lease_expires_at).toBeNull();
    expect(rowC.reclaim_count).toBe(1);
    expect(rowC.finished_at).toBeUndefined();
    expect(rowC.claimed_at).toBe(iso(1_000));

    // ── Re-claim svc-c at T0+46 s (worker-2): a PENDING claim — claimed_at
    // restamps (queue latency measures the LAST claim), reclaim_count must
    // NOT bump again (this is not an expired-lease steal).
    clock.advance(1_000);
    const reclaimed = await queue.claimNext("worker-2", 30);
    expect(reclaimed.claimed).toBe(true);
    expect(reclaimed.lease?.job.id).toBe(cHandle.jobId);
    expect(rowC.claimed_at).toBe(iso(46_000));
    expect(rowC.reclaim_count).toBe(1);

    // ── Finish svc-c at T0+55 s.
    clock.advance(9_000);
    await queue.report({
      jobId: cHandle.jobId,
      workerId: "worker-2",
      result: greenResult(cHandle.jobId, rowC.payload, "worker-2", iso(55_000)),
    });
    expect(rowC.status).toBe("done");
    expect(rowC.finished_at).toBe(iso(55_000));

    // ── GET /api/runs: the d5 lastRun surfaces the whole lifecycle.
    const res = await app.request("/api/runs");
    expect(res.status).toBe(200);
    const body = (await res.json()) as FamilySummaryResponse;
    const d5 = body.families.find((f) => f.family === "d5");
    if (!d5) throw new Error("no d5 family entry");
    expect(d5.error).toBeUndefined();
    expect(d5.inflight).toBeNull();
    expect(d5.lastRun).toMatchObject({
      runId,
      triggered: false,
      outcome: "completed",
      jobs: { total: 3, done: 3, failed: 0, reclaimed: 1 },
      enqueuedAt: iso(0),
      finishedAt: iso(55_000),
      durationMs: 55_000,
      cells: { total: 3, passed: 3, failed: 0 },
      redsIntroduced: null,
      redsCleared: null,
      errorSummary: null,
      commErrorKinds: [],
    });
    expect(d5.lastSuccessAt).toBe(iso(55_000));

    // ── GET /api/runs/d5/:runId: per-job reclaimCount + last-claim latency.
    const dres = await app.request(`/api/runs/d5/${runId}`);
    expect(dres.status).toBe(200);
    const detail = (await dres.json()) as RunDetailResponse;
    expect(detail.family).toBe("d5");
    expect(detail.runId).toBe(runId);
    expect(detail.jobs).toHaveLength(3);
    const bySlug = new Map(detail.jobs.map((j) => [j.serviceSlug, j]));
    const jobC = bySlug.get("svc-c");
    if (!jobC) throw new Error("no svc-c job in detail");
    expect(jobC.reclaimCount).toBe(1);
    expect(jobC.status).toBe("done");
    expect(jobC.claimedAt).toBe(iso(46_000));
    // queueLatencyMs = claimed_at − created: measures the LAST claim.
    expect(jobC.queueLatencyMs).toBe(46_000);
    expect(jobC.finishedAt).toBe(iso(55_000));
    expect(jobC.durationMs).toBe(9_000);
    for (const slug of ["svc-a", "svc-b"] as const) {
      const job = bySlug.get(slug);
      if (!job) throw new Error(`no ${slug} job in detail`);
      expect(job.reclaimCount).toBe(0);
      expect(job.claimedAt).toBe(iso(1_000));
      expect(job.queueLatencyMs).toBe(1_000);
      expect(job.durationMs).toBe(4_000);
    }
    // §5.2.1 redaction posture: no raw comm-error message anywhere.
    for (const job of detail.jobs) {
      expect(job.commError).toBeNull();
    }
  });

  it("increments reclaim_count on the claim CAS's expired-lease steal (the FIRST choke point)", async () => {
    const { clock, store, claim, queue, app } = makeWorld();
    const runId = "run-d5-002";

    await queue.enqueue({
      payload: payloadFor("svc-steal", runId, iso(0)),
      family: "d5",
    });
    clock.advance(1_000);
    const first = await queue.claimNext("worker-1", 30);
    expect(first.claimed).toBe(true);
    const jobId = first.lease?.job.id;
    if (!jobId) throw new Error("no job id from first claim");

    // Lease expires at T0+31 s; steal DIRECTLY via the claim CAS at T0+61 s
    // (the CAS safety net — claimNext only lists pending, so the steal path
    // is exercised on the claim client itself, exactly like the hook).
    clock.advance(60_000);
    const steal = await claim.claimJob(jobId, "worker-2", 30);
    expect(steal.won).toBe(true);
    const row = store.find((r) => r.id === jobId);
    if (!row) throw new Error("no row for stolen job");
    expect(row.reclaim_count).toBe(1);
    expect(row.claimed_by).toBe("worker-2");
    // claimed_at restamped by the winning steal.
    expect(row.claimed_at).toBe(iso(61_000));

    clock.advance(5_000);
    await queue.report({
      jobId,
      workerId: "worker-2",
      result: greenResult(jobId, row.payload, "worker-2", iso(66_000)),
    });

    const res = await app.request("/api/runs");
    const body = (await res.json()) as FamilySummaryResponse;
    const d5 = body.families.find((f) => f.family === "d5");
    expect(d5?.lastRun?.jobs).toEqual({
      total: 1,
      done: 1,
      failed: 0,
      reclaimed: 1,
    });

    const dres = await app.request(`/api/runs/d5/${runId}`);
    const detail = (await dres.json()) as RunDetailResponse;
    expect(detail.jobs[0].reclaimCount).toBe(1);
    expect(detail.jobs[0].queueLatencyMs).toBe(61_000);
  });

  it("writes empty family on rows enqueued without one — invisible to the family API", async () => {
    const { store, queue, app } = makeWorld();

    // Pre-P2 parity: an enqueue with no family stamps the column EMPTY.
    await queue.enqueue({
      payload: payloadFor("svc-old", "run-x", iso(0), "d6"),
    });
    expect(store).toHaveLength(1);
    expect(store[0].family).toBe("");
    expect(store[0].run_id).toBe("run-x");

    const res = await app.request("/api/runs");
    const body = (await res.json()) as FamilySummaryResponse;
    for (const fam of body.families) {
      expect(fam.error).toBeUndefined();
      expect(fam.lastRun).toBeNull();
      expect(fam.inflight).toBeNull();
    }
  });
});
