import { describe, it, expect, vi } from "vitest";
import {
  createFleetHealthMonitor,
  DEFAULT_WORKER_STALE_AFTER_MS,
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
    });
    expect(claim.releases).toEqual([]);
  });
});
