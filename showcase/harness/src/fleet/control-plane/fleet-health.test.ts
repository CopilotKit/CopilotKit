import { describe, it, expect, vi } from "vitest";
import {
  createFleetHealthMonitor,
  DEFAULT_WORKER_STALE_AFTER_MS,
  DEFAULT_WORKER_GC_AFTER_MS,
} from "./fleet-health.js";
import type {
  PbClient,
  ListOpts,
  ListResult,
} from "../../storage/pb-client.js";
import type { JobClaimClient, JobView, ReleaseResult } from "../job-claim.js";
import type { Logger } from "../../types/index.js";

/**
 * Pins the control-plane FLEET-HEALTH monitor (S10): a stale worker's in-flight
 * jobs are reclaimed (released back to pending via the S0 CAS) and a
 * `worker-crashed-mid-job` comm error is emitted per reclaimed job (REQ-B); a
 * healthy worker is left entirely untouched. Restart is a best-effort injected
 * hook (default no-op locally). All collaborators are injected fakes — no
 * PocketBase, no Railway, no real timers.
 */

const SILENT_LOGGER: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

interface WorkerRow {
  id: string;
  worker_id: string;
  last_heartbeat_at: string;
  current_job_id?: string;
}

function jobView(over: Partial<JobView> = {}): JobView {
  return {
    id: "j1",
    probe_key: "d6:langgraph-python",
    status: "claimed",
    claimed_by: "worker-dead",
    lease_expires_at: "2999-01-01T00:00:00.000Z",
    version: 2,
    ...over,
  };
}

/**
 * Fake PB serving two collections: `workers` (the roster) and `probe_jobs` (the
 * in-flight queue rows). The job filter honors the monitor's
 * `(status = "claimed" || status = "running") && claimed_by = "<id>"` shape so
 * only the targeted worker's in-flight jobs are returned.
 */
function makeFakePb(opts: { workers: WorkerRow[]; jobs: JobView[] }): {
  pb: PbClient;
  listCalls: Array<{ collection: string; opts: ListOpts }>;
} {
  const listCalls: Array<{ collection: string; opts: ListOpts }> = [];
  const unsupported = (n: string) => () => {
    throw new Error(`fake-pb: ${n} not implemented`);
  };
  const pb = {
    async list<T>(
      collection: string,
      listOpts: ListOpts = {},
    ): Promise<ListResult<T>> {
      listCalls.push({ collection, opts: listOpts });
      let items: unknown[];
      if (collection === "workers") {
        items = opts.workers;
      } else {
        const filter = listOpts.filter ?? "";
        const statuses = [...filter.matchAll(/status\s*=\s*"(\w+)"/g)].map(
          (m) => m[1],
        );
        const wantStatus = new Set(statuses);
        const ownerMatch = /claimed_by\s*=\s*"([^"]*)"/.exec(filter);
        const wantOwner = ownerMatch?.[1];
        items = opts.jobs.filter((j) => {
          if (wantStatus.size > 0 && !wantStatus.has(j.status)) return false;
          if (wantOwner !== undefined && j.claimed_by !== wantOwner) {
            return false;
          }
          return true;
        });
      }
      return {
        page: 1,
        perPage: listOpts.perPage ?? items.length,
        totalPages: 1,
        totalItems: items.length,
        items: items as T[],
      };
    },
    getOne: unsupported("getOne"),
    getFirst: unsupported("getFirst"),
    create: unsupported("create"),
    update: unsupported("update"),
    upsertByField: unsupported("upsertByField"),
    delete: unsupported("delete"),
    deleteByFilter: unsupported("deleteByFilter"),
    health: unsupported("health"),
    createBackup: unsupported("createBackup"),
    downloadBackup: unsupported("downloadBackup"),
    deleteBackup: unsupported("deleteBackup"),
  } as unknown as PbClient;
  return { pb, listCalls };
}

/**
 * Fake claim CAS. `releaseJob` records each call and returns `released:true`
 * unless the job id is in `losing` (a sweep/late-report race won by a peer).
 */
function makeFakeClaim(losing: Set<string> = new Set()): JobClaimClient & {
  releases: Array<{ jobId: string; workerId: string; status: string }>;
} {
  const releases: Array<{
    jobId: string;
    workerId: string;
    status: string;
  }> = [];
  return {
    releases,
    async claimJob() {
      throw new Error("fake-claim: claimJob not used by fleet-health");
    },
    async renewLease() {
      throw new Error("fake-claim: renewLease not used by fleet-health");
    },
    async releaseJob(
      jobId: string,
      workerId: string,
      status: "done" | "failed" | "pending",
    ): Promise<ReleaseResult> {
      releases.push({ jobId, workerId, status });
      return { released: !losing.has(jobId) };
    },
  } as JobClaimClient & {
    releases: Array<{ jobId: string; workerId: string; status: string }>;
  };
}

const NOW = Date.parse("2026-06-04T00:10:00.000Z");
const FRESH = new Date(NOW - 1_000).toISOString();
const STALE = new Date(
  NOW - DEFAULT_WORKER_STALE_AFTER_MS - 1_000,
).toISOString();
// Older than the 24h GC window — a long-dead row from a prior deploy
// generation that should be GC-deleted rather than reclaimed.
const ANCIENT = new Date(
  NOW - DEFAULT_WORKER_GC_AFTER_MS - 1_000,
).toISOString();

/**
 * GC-aware fake PB: like `makeFakePb` but records `delete(collection, id)` calls
 * (the GC primitive fleet-health uses to evict long-dead roster rows) instead of
 * throwing. `deleteThrows` makes the delete reject for the given row ids so the
 * GC-failure-does-not-abort-cycle case can be exercised.
 */
function makeGcFakePb(opts: {
  workers: WorkerRow[];
  jobs: JobView[];
  deleteThrows?: Set<string>;
}): {
  pb: PbClient;
  deletes: Array<{ collection: string; id: string }>;
} {
  const deletes: Array<{ collection: string; id: string }> = [];
  const deleteThrows = opts.deleteThrows ?? new Set<string>();
  const unsupported = (n: string) => () => {
    throw new Error(`fake-pb: ${n} not implemented`);
  };
  const pb = {
    async list<T>(
      collection: string,
      listOpts: ListOpts = {},
    ): Promise<ListResult<T>> {
      let items: unknown[];
      if (collection === "workers") {
        items = opts.workers;
      } else {
        const filter = listOpts.filter ?? "";
        const statuses = [...filter.matchAll(/status\s*=\s*"(\w+)"/g)].map(
          (m) => m[1],
        );
        const wantStatus = new Set(statuses);
        const ownerMatch = /claimed_by\s*=\s*"([^"]*)"/.exec(filter);
        const wantOwner = ownerMatch?.[1];
        items = opts.jobs.filter((j) => {
          if (wantStatus.size > 0 && !wantStatus.has(j.status)) return false;
          if (wantOwner !== undefined && j.claimed_by !== wantOwner) {
            return false;
          }
          return true;
        });
      }
      return {
        page: 1,
        perPage: listOpts.perPage ?? items.length,
        totalPages: 1,
        totalItems: items.length,
        items: items as T[],
      };
    },
    async delete(collection: string, id: string): Promise<void> {
      deletes.push({ collection, id });
      if (deleteThrows.has(id)) {
        throw new Error(`fake-pb: delete failed for ${id}`);
      }
    },
    getOne: unsupported("getOne"),
    getFirst: unsupported("getFirst"),
    create: unsupported("create"),
    update: unsupported("update"),
    upsertByField: unsupported("upsertByField"),
    deleteByFilter: unsupported("deleteByFilter"),
    health: unsupported("health"),
    createBackup: unsupported("createBackup"),
    downloadBackup: unsupported("downloadBackup"),
    deleteBackup: unsupported("deleteBackup"),
  } as unknown as PbClient;
  return { pb, deletes };
}

describe("createFleetHealthMonitor.checkOnce", () => {
  it("reclaims a stale worker's in-flight jobs and emits a comm error per job", async () => {
    const { pb } = makeFakePb({
      workers: [
        { id: "w1", worker_id: "worker-dead", last_heartbeat_at: STALE },
      ],
      jobs: [
        jobView({ id: "j1", claimed_by: "worker-dead", status: "claimed" }),
        jobView({ id: "j2", claimed_by: "worker-dead", status: "running" }),
      ],
    });
    const claim = makeFakeClaim();
    const monitor = createFleetHealthMonitor({
      pb,
      claim,
      logger: SILENT_LOGGER,
      now: () => NOW,
    });

    const out = await monitor.checkOnce();

    expect(out.unhealthy).toBe(1);
    expect(out.online).toBe(0);
    expect(out.reclaimed).toBe(2);
    // Both jobs released back to pending on behalf of the dead worker.
    expect(claim.releases).toEqual([
      { jobId: "j1", workerId: "worker-dead", status: "pending" },
      { jobId: "j2", workerId: "worker-dead", status: "pending" },
    ]);
    // One worker-crashed-mid-job comm error per reclaimed job (REQ-B).
    expect(out.commErrors).toHaveLength(2);
    for (const ce of out.commErrors) {
      expect(ce.kind).toBe("worker-crashed-mid-job");
      expect(ce.workerId).toBe("worker-dead");
    }
    expect(out.commErrors.map((c) => c.jobId).sort()).toEqual(["j1", "j2"]);
  });

  it("[REQ-B] pairs each reclaimed comm error with the job's probe_key as the dashboard overlay key", async () => {
    // The bare PoolCommError carries jobId/workerId but NOT the d6:<slug>
    // dashboard key the overlay must land on. reclaimedOverlays pairs each
    // error with the reclaimed job's probe_key so the control-plane can feed
    // it to the aggregator without a second PB lookup. Previously this pairing
    // did not exist, so the overlay key was unrecoverable downstream (the red
    // state: the dashboard overlay was never written for the worker-death leg).
    const { pb } = makeFakePb({
      workers: [
        { id: "w1", worker_id: "worker-dead", last_heartbeat_at: STALE },
      ],
      jobs: [
        jobView({
          id: "j1",
          claimed_by: "worker-dead",
          status: "claimed",
          probe_key: "d6:langgraph-python",
        }),
        jobView({
          id: "j2",
          claimed_by: "worker-dead",
          status: "running",
          probe_key: "d6:crewai",
        }),
      ],
    });
    const claim = makeFakeClaim();
    const monitor = createFleetHealthMonitor({
      pb,
      claim,
      logger: SILENT_LOGGER,
      now: () => NOW,
    });

    const out = await monitor.checkOnce();

    expect(out.reclaimedOverlays).toHaveLength(2);
    // Each overlay pairs the comm error with the job's d6:<slug> dashboard key.
    const byJob = new Map(
      out.reclaimedOverlays.map((o) => [o.commError.jobId, o.aggregateKey]),
    );
    expect(byJob.get("j1")).toBe("d6:langgraph-python");
    expect(byJob.get("j2")).toBe("d6:crewai");
    for (const o of out.reclaimedOverlays) {
      expect(o.commError.kind).toBe("worker-crashed-mid-job");
    }
  });

  it("leaves a healthy (fresh-heartbeat) worker untouched — no release, no comm error", async () => {
    const { pb } = makeFakePb({
      workers: [
        { id: "w1", worker_id: "worker-live", last_heartbeat_at: FRESH },
      ],
      jobs: [
        jobView({ id: "j1", claimed_by: "worker-live", status: "running" }),
      ],
    });
    const claim = makeFakeClaim();
    const monitor = createFleetHealthMonitor({
      pb,
      claim,
      logger: SILENT_LOGGER,
      now: () => NOW,
    });

    const out = await monitor.checkOnce();

    expect(out.online).toBe(1);
    expect(out.unhealthy).toBe(0);
    expect(out.reclaimed).toBe(0);
    expect(out.commErrors).toEqual([]);
    expect(claim.releases).toEqual([]);
  });

  it("warns AND counts an unparseable heartbeat per cycle (heartbeatParseable wiring — the blind-but-online row is surfaced)", async () => {
    const { pb } = makeFakePb({
      workers: [
        {
          id: "w1",
          worker_id: "worker-corrupt",
          last_heartbeat_at: "not-a-date",
        },
        { id: "w2", worker_id: "worker-live", last_heartbeat_at: FRESH },
      ],
      jobs: [],
    });
    const claim = makeFakeClaim();
    const warn = vi.fn();
    const info = vi.fn();
    const logger: Logger = { ...SILENT_LOGGER, warn, info };
    const monitor = createFleetHealthMonitor({
      pb,
      claim,
      logger,
      now: () => NOW,
    });

    const out = await monitor.checkOnce();

    // isWorkerStale is deliberately blind to an unparseable heartbeat (never
    // flap the fleet offline on one malformed row), so the corrupt row still
    // derives "online" — the per-worker warn + per-cycle count are the ONLY
    // operator visibility into the orphaned row.
    expect(out.online).toBe(2);
    expect(out.unhealthy).toBe(0);
    expect(warn).toHaveBeenCalledWith("fleet.health.unparseable-heartbeat", {
      workerId: "worker-corrupt",
      lastHeartbeatAt: "not-a-date",
    });
    expect(info).toHaveBeenCalledWith(
      "fleet.health.cycle",
      expect.objectContaining({ unparseableHeartbeats: 1 }),
    );
    expect(claim.releases).toEqual([]);
  });

  it("fires the best-effort restart hook once per stale worker after reclaiming", async () => {
    const { pb } = makeFakePb({
      workers: [
        { id: "w1", worker_id: "worker-dead", last_heartbeat_at: STALE },
      ],
      jobs: [
        jobView({ id: "j1", claimed_by: "worker-dead", status: "claimed" }),
      ],
    });
    const claim = makeFakeClaim();
    const restartWorker = vi.fn(async () => {});
    const monitor = createFleetHealthMonitor({
      pb,
      claim,
      logger: SILENT_LOGGER,
      now: () => NOW,
      restartWorker,
    });

    const out = await monitor.checkOnce();

    expect(out.restartsAttempted).toBe(1);
    expect(restartWorker).toHaveBeenCalledTimes(1);
    expect(restartWorker).toHaveBeenCalledWith("worker-dead");
    // Reclaim happened before the restart hook.
    expect(out.reclaimed).toBe(1);
  });

  it("does not count a job another sweeper already reclaimed (release lost the race)", async () => {
    const { pb } = makeFakePb({
      workers: [
        { id: "w1", worker_id: "worker-dead", last_heartbeat_at: STALE },
      ],
      jobs: [
        jobView({ id: "j1", claimed_by: "worker-dead", status: "claimed" }),
        jobView({ id: "j2", claimed_by: "worker-dead", status: "running" }),
      ],
    });
    // j1's release loses the CAS race (producer sweepExpired won it first).
    const claim = makeFakeClaim(new Set(["j1"]));
    const monitor = createFleetHealthMonitor({
      pb,
      claim,
      logger: SILENT_LOGGER,
      now: () => NOW,
    });

    const out = await monitor.checkOnce();

    expect(out.reclaimed).toBe(1);
    expect(out.commErrors).toHaveLength(1);
    expect(out.commErrors[0]?.jobId).toBe("j2");
  });

  it("never throws (and processes the remaining workers) when ONE worker's in-flight job read fails", async () => {
    // checkOnce is documented "never throws". The per-worker probe_jobs read
    // (pb.list for the worker's claimed/running jobs) is NOT the roster read —
    // a filter error or transient PB blip on ONE worker's job read must not
    // abort the whole cycle, skipping every subsequent worker's reclamation.
    const unsupported = (n: string) => () => {
      throw new Error(`fake-pb: ${n} not implemented`);
    };
    const workers: WorkerRow[] = [
      // First stale worker: its job read throws.
      { id: "w1", worker_id: "worker-boom", last_heartbeat_at: STALE },
      // Second stale worker: its job read succeeds → must still be reclaimed.
      { id: "w2", worker_id: "worker-dead", last_heartbeat_at: STALE },
    ];
    const goodJob = jobView({
      id: "j-good",
      claimed_by: "worker-dead",
      status: "claimed",
      probe_key: "d6:crewai",
    });
    const pb = {
      async list<T>(
        collection: string,
        listOpts: ListOpts = {},
      ): Promise<ListResult<T>> {
        if (collection === "workers") {
          return {
            page: 1,
            perPage: workers.length,
            totalPages: 1,
            totalItems: workers.length,
            items: workers as unknown as T[],
          };
        }
        // probe_jobs read: throw for worker-boom, serve worker-dead's job.
        const filter = listOpts.filter ?? "";
        if (filter.includes("worker-boom")) {
          throw new Error("pb list filter error for worker-boom");
        }
        const items = filter.includes("worker-dead") ? [goodJob] : [];
        return {
          page: 1,
          perPage: items.length,
          totalPages: 1,
          totalItems: items.length,
          items: items as unknown as T[],
        };
      },
      getOne: unsupported("getOne"),
      getFirst: unsupported("getFirst"),
      create: unsupported("create"),
      update: unsupported("update"),
      upsertByField: unsupported("upsertByField"),
      delete: unsupported("delete"),
      deleteByFilter: unsupported("deleteByFilter"),
      health: unsupported("health"),
      createBackup: unsupported("createBackup"),
      downloadBackup: unsupported("downloadBackup"),
      deleteBackup: unsupported("deleteBackup"),
    } as unknown as PbClient;
    const claim = makeFakeClaim();
    const monitor = createFleetHealthMonitor({
      pb,
      claim,
      logger: SILENT_LOGGER,
      now: () => NOW,
    });

    // Must not throw, and must process the SECOND worker despite the first's
    // job read failing.
    const out = await monitor.checkOnce();

    expect(out.unhealthy).toBe(2);
    // Only worker-dead's job was reclaimable (worker-boom's read failed).
    expect(out.reclaimed).toBe(1);
    expect(out.commErrors).toHaveLength(1);
    expect(out.commErrors[0]?.workerId).toBe("worker-dead");
    expect(out.reclaimedOverlays).toHaveLength(1);
    expect(out.reclaimedOverlays[0]?.aggregateKey).toBe("d6:crewai");
    expect(claim.releases).toEqual([
      { jobId: "j-good", workerId: "worker-dead", status: "pending" },
    ]);
  });

  it("never throws when the roster read fails — returns an empty cycle", async () => {
    const unsupported = (n: string) => () => {
      throw new Error(`fake-pb: ${n} not implemented`);
    };
    const pb = {
      async list(): Promise<never> {
        throw new Error("pb down");
      },
      getOne: unsupported("getOne"),
      getFirst: unsupported("getFirst"),
      create: unsupported("create"),
      update: unsupported("update"),
      upsertByField: unsupported("upsertByField"),
      delete: unsupported("delete"),
      deleteByFilter: unsupported("deleteByFilter"),
      health: unsupported("health"),
      createBackup: unsupported("createBackup"),
      downloadBackup: unsupported("downloadBackup"),
      deleteBackup: unsupported("deleteBackup"),
    } as unknown as PbClient;
    const claim = makeFakeClaim();
    const monitor = createFleetHealthMonitor({
      pb,
      claim,
      logger: SILENT_LOGGER,
      now: () => NOW,
    });

    const out = await monitor.checkOnce();
    expect(out).toEqual({
      online: 0,
      unhealthy: 0,
      reclaimed: 0,
      commErrors: [],
      reclaimedOverlays: [],
      restartsAttempted: 0,
      gcDeleted: 0,
    });
    expect(claim.releases).toEqual([]);
  });

  it("GCs roster rows older than gcAfterMs (long-dead deploy generations) without reclaiming or restart-attempting them", async () => {
    // A mix: one fresh (online), one stale-recent (reclaimed at 180s but NOT
    // GC-old), one ancient (>24h dead — a leftover row from a prior deploy
    // generation that should be GC-deleted, NOT counted unhealthy/reclaimed).
    const { pb, deletes } = makeGcFakePb({
      workers: [
        { id: "w-fresh", worker_id: "worker-live", last_heartbeat_at: FRESH },
        { id: "w-stale", worker_id: "worker-stale", last_heartbeat_at: STALE },
        {
          id: "w-ancient",
          worker_id: "worker-ghost",
          last_heartbeat_at: ANCIENT,
        },
      ],
      jobs: [
        jobView({ id: "j1", claimed_by: "worker-stale", status: "claimed" }),
      ],
    });
    const claim = makeFakeClaim();
    const monitor = createFleetHealthMonitor({
      pb,
      claim,
      logger: SILENT_LOGGER,
      now: () => NOW,
    });

    const out = await monitor.checkOnce();

    // The ancient row was GC-deleted exactly once, by its row id.
    expect(deletes).toEqual([{ collection: "workers", id: "w-ancient" }]);
    expect(out.gcDeleted).toBe(1);
    // The ancient row is NOT counted unhealthy and NOT reclaimed/restarted —
    // only the stale-recent worker is.
    expect(out.online).toBe(1);
    expect(out.unhealthy).toBe(1);
    expect(out.reclaimed).toBe(1);
    // The ancient ghost row never hit the claim CAS.
    expect(claim.releases).toEqual([
      { jobId: "j1", workerId: "worker-stale", status: "pending" },
    ]);
  });

  it("does not abort the cycle when a GC delete fails — processes the remaining rows", async () => {
    const { pb, deletes } = makeGcFakePb({
      workers: [
        {
          id: "w-ancient",
          worker_id: "worker-ghost",
          last_heartbeat_at: ANCIENT,
        },
        { id: "w-stale", worker_id: "worker-stale", last_heartbeat_at: STALE },
      ],
      jobs: [
        jobView({ id: "j1", claimed_by: "worker-stale", status: "claimed" }),
      ],
      deleteThrows: new Set(["w-ancient"]),
    });
    const claim = makeFakeClaim();
    const monitor = createFleetHealthMonitor({
      pb,
      claim,
      logger: SILENT_LOGGER,
      now: () => NOW,
    });

    // Must not throw despite the GC delete rejecting.
    const out = await monitor.checkOnce();

    expect(deletes).toEqual([{ collection: "workers", id: "w-ancient" }]);
    // Failed GC delete is swallowed: not counted gcDeleted, and the row is not
    // double-processed as unhealthy (it's still GC-class, just couldn't delete).
    expect(out.gcDeleted).toBe(0);
    // The stale-recent worker is still processed after the failed GC delete.
    expect(out.reclaimed).toBe(1);
    expect(claim.releases).toEqual([
      { jobId: "j1", workerId: "worker-stale", status: "pending" },
    ]);
  });

  it("reclaims a stale-but-not-ancient row rather than GC-deleting it", async () => {
    const { pb, deletes } = makeGcFakePb({
      workers: [
        { id: "w-stale", worker_id: "worker-stale", last_heartbeat_at: STALE },
      ],
      jobs: [
        jobView({ id: "j1", claimed_by: "worker-stale", status: "claimed" }),
      ],
    });
    const claim = makeFakeClaim();
    const monitor = createFleetHealthMonitor({
      pb,
      claim,
      logger: SILENT_LOGGER,
      now: () => NOW,
    });

    const out = await monitor.checkOnce();

    // A row between staleAfterMs and gcAfterMs is reclaimed, never GC-deleted.
    expect(deletes).toEqual([]);
    expect(out.gcDeleted).toBe(0);
    expect(out.unhealthy).toBe(1);
    expect(out.reclaimed).toBe(1);
  });

  it("does NOT count restartsAttempted for ghost rows under the default no-op restart hook", async () => {
    // Post-demotion: with the default no-op restart hook and a stale row that
    // reclaimed ZERO jobs (a ghost row), restartsAttempted stays 0 — the
    // metric no longer pretends a restart was attempted when the hook is a
    // no-op and there was nothing to reclaim.
    const { pb } = makeGcFakePb({
      workers: [
        { id: "w-stale", worker_id: "worker-ghost", last_heartbeat_at: STALE },
      ],
      jobs: [], // no in-flight jobs → reclaimed === 0
    });
    const claim = makeFakeClaim();
    const monitor = createFleetHealthMonitor({
      pb,
      claim,
      logger: SILENT_LOGGER,
      now: () => NOW,
      // no restartWorker → default no-op hook
    });

    const out = await monitor.checkOnce();

    expect(out.unhealthy).toBe(1);
    expect(out.reclaimed).toBe(0);
    // The no-op hook + zero reclaims => no misleading restart attempt counted.
    expect(out.restartsAttempted).toBe(0);
  });

  it("GC-deletes an ancient roster row even when its worker_id is missing/empty (no perpetual warn)", async () => {
    // The GC delete only needs `row.id` — a malformed row (missing/empty
    // worker_id) that is ALSO older than gcAfterMs must be GC'd, not warned
    // about every cycle forever. A malformed row that is NOT GC-old keeps the
    // existing warn+skip behavior.
    const warns: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
    const logger: Logger = {
      info: () => {},
      error: () => {},
      debug: () => {},
      warn: (msg, meta) => {
        warns.push({ msg, meta });
      },
    };
    const { pb, deletes } = makeGcFakePb({
      workers: [
        // Ancient AND missing worker_id → must be GC-deleted.
        {
          id: "w-anc-missing",
          last_heartbeat_at: ANCIENT,
        } as unknown as WorkerRow,
        // Malformed (empty worker_id) but RECENT → today's warn+skip stays.
        { id: "w-recent-missing", worker_id: "", last_heartbeat_at: FRESH },
      ],
      jobs: [],
    });
    const claim = makeFakeClaim();
    const monitor = createFleetHealthMonitor({
      pb,
      claim,
      logger,
      now: () => NOW,
    });

    const out = await monitor.checkOnce();

    // The ancient malformed row was GC-deleted by its row id.
    expect(deletes).toEqual([{ collection: "workers", id: "w-anc-missing" }]);
    expect(out.gcDeleted).toBe(1);
    // No missing-worker-id warn for the GC'd row — only the recent malformed
    // row keeps the warn+skip path.
    const missingWarns = warns.filter(
      (w) => w.msg === "fleet.health.row-missing-worker-id",
    );
    expect(missingWarns).toHaveLength(1);
    expect(missingWarns[0]?.meta).toMatchObject({ rowId: "w-recent-missing" });
    // Neither malformed row ever hits the claim CAS.
    expect(claim.releases).toEqual([]);
  });

  it("fails loud at construction when gcAfterMs does not exceed staleAfterMs", () => {
    // gcAfterMs and staleAfterMs are independently env-overridable
    // (WORKER_GC_AFTER_MS / WORKER_STALE_AFTER_MS). If gc <= stale, GC runs
    // FIRST in the cycle and DELETES a merely-stale (recoverable) worker before
    // its in-flight jobs are reclaimed — jobs wedge until lease expiry and the
    // crashed-worker overlay never fires. Misconfig must die on boot (mirrors
    // the worker-loop heartbeatMs/leaseSeconds fail-loud guard).
    const { pb } = makeFakePb({ workers: [], jobs: [] });
    const claim = makeFakeClaim();
    const base = { pb, claim, logger: SILENT_LOGGER, now: () => NOW };

    // gc strictly below stale → throw, naming both values and env vars.
    expect(() =>
      createFleetHealthMonitor({ ...base, staleAfterMs: 1000, gcAfterMs: 500 }),
    ).toThrow(
      /gcAfterMs \(500\b.*WORKER_GC_AFTER_MS.*staleAfterMs \(1000\b.*WORKER_STALE_AFTER_MS/s,
    );
    // gc == stale is equally unsafe (GC fires the moment a row turns stale).
    expect(() =>
      createFleetHealthMonitor({
        ...base,
        staleAfterMs: 1000,
        gcAfterMs: 1000,
      }),
    ).toThrow(/gcAfterMs/);

    // A valid pair (gc > stale) constructs fine, as do the defaults.
    expect(() =>
      createFleetHealthMonitor({
        ...base,
        staleAfterMs: 1000,
        gcAfterMs: 1001,
      }),
    ).not.toThrow();
    expect(() => createFleetHealthMonitor(base)).not.toThrow();
    expect(DEFAULT_WORKER_GC_AFTER_MS).toBeGreaterThan(
      DEFAULT_WORKER_STALE_AFTER_MS,
    );
  });
});
