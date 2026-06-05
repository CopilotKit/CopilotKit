import { describe, it, expect, vi } from "vitest";
import { createFleetQueueClient, leaseExpired } from "./queue-client.js";
import type {
  JobClaimClient,
  ClaimResult,
  RenewResult,
  ReleaseResult,
  JobView,
  JobStatus,
} from "./job-claim.js";
import type { PbClient, ListOpts, ListResult } from "../storage/pb-client.js";
import type {
  EnqueueJobInput,
  ServiceJobPayload,
  ServiceJobResult,
  ReportJobInput,
} from "./contracts.js";
import { logger } from "../logger.js";

/**
 * Pins the control-plane ↔ worker QUEUE layer (S3): FleetQueueClient layered
 * over S0's JobClaimClient + the PB client. The three load-bearing behaviors
 * are an enqueue→claimNext round-trip (payload survives the row), report mapping
 * a result onto the terminal JobStatus S0's releaseJob expects, and
 * sweepExpired surfacing `worker-crashed-mid-job` comm errors for leases that
 * expired mid-run.
 */

function samplePayload(
  overrides: Partial<ServiceJobPayload> = {},
): ServiceJobPayload {
  return {
    probeKey: "d6:langgraph-python",
    serviceSlug: "langgraph-python",
    driverKind: "e2e_d6",
    meta: {
      runId: "run-1",
      triggered: false,
      enqueuedAt: "2026-06-04T00:00:00.000Z",
    },
    ...overrides,
  };
}

function jobView(overrides: Partial<JobView> = {}): JobView {
  return {
    id: "j1",
    probe_key: "d6:langgraph-python",
    status: "pending",
    claimed_by: "",
    lease_expires_at: null,
    version: 0,
    ...overrides,
  };
}

/** A typed in-memory row the fake PB returns from list/getOne. */
interface JobRow extends JobView {
  payload: ServiceJobPayload;
  /** Result-flow columns (migration 1779989700) the report path writes. */
  result?: unknown;
  result_processed?: boolean;
}

/**
 * Minimal fake PbClient backed by an in-memory row map. Only the methods the
 * queue-client actually calls are implemented; the rest throw so an accidental
 * dependency surfaces loudly rather than silently returning undefined.
 */
function makeFakePb(rows: JobRow[] = []): {
  pb: PbClient;
  rows: JobRow[];
} {
  const store = [...rows];
  const unsupported = (name: string) => () => {
    throw new Error(`fake-pb: ${name} not implemented`);
  };
  const pb: PbClient = {
    async create<T>(
      _collection: string,
      record: Record<string, unknown>,
    ): Promise<T> {
      const row: JobRow = {
        id: `j${store.length + 1}`,
        probe_key: String(record.probe_key),
        status: record.status as JobStatus,
        claimed_by: String(record.claimed_by ?? ""),
        lease_expires_at: (record.lease_expires_at as string | null) ?? null,
        version: Number(record.version ?? 0),
        payload: record.payload as ServiceJobPayload,
      };
      store.push(row);
      return row as unknown as T;
    },
    async list<T>(
      _collection: string,
      opts: ListOpts = {},
    ): Promise<ListResult<T>> {
      let items = store;
      // Honor a `status = "x"` / `status = "x" || status = "y"` filter the way
      // the real client would, so both the claimNext candidate scan and the
      // sweepExpired claimed-or-running scan are exercised faithfully.
      const matches = [
        ...(opts.filter ?? "").matchAll(/status\s*=\s*"(\w+)"/g),
      ];
      if (matches.length > 0) {
        const wanted = new Set(matches.map((mm) => mm[1]));
        items = store.filter((r) => wanted.has(r.status));
      }
      return {
        page: 1,
        perPage: opts.perPage ?? items.length,
        totalPages: 1,
        totalItems: items.length,
        items: items as unknown as T[],
      };
    },
    async getOne<T>(_collection: string, id: string): Promise<T | null> {
      return (store.find((r) => r.id === id) ?? null) as unknown as T | null;
    },
    getFirst: unsupported("getFirst") as PbClient["getFirst"],
    async update<T>(
      _collection: string,
      id: string,
      record: Record<string, unknown>,
    ): Promise<T> {
      const row = store.find((r) => r.id === id);
      if (!row) throw new Error(`fake-pb: update of missing row ${id}`);
      Object.assign(row as unknown as Record<string, unknown>, record);
      return row as unknown as T;
    },
    upsertByField: unsupported("upsertByField") as PbClient["upsertByField"],
    delete: unsupported("delete") as PbClient["delete"],
    deleteByFilter: unsupported("deleteByFilter") as PbClient["deleteByFilter"],
    health: unsupported("health") as PbClient["health"],
    createBackup: unsupported("createBackup") as PbClient["createBackup"],
    downloadBackup: unsupported("downloadBackup") as PbClient["downloadBackup"],
    deleteBackup: unsupported("deleteBackup") as PbClient["deleteBackup"],
  };
  return { pb, rows: store };
}

/** Configurable fake JobClaimClient — each method is a vi.fn the test wires. */
function makeFakeClaim(
  overrides: Partial<JobClaimClient> = {},
): JobClaimClient {
  return {
    claimJob: vi.fn(async (): Promise<ClaimResult> => ({ won: false })),
    renewLease: vi.fn(async (): Promise<RenewResult> => ({ renewed: false })),
    releaseJob: vi.fn(
      async (): Promise<ReleaseResult> => ({ released: false }),
    ),
    ...overrides,
  };
}

function sampleResult(
  overrides: Partial<ServiceJobResult> = {},
): ServiceJobResult {
  return {
    jobId: "j1",
    probeKey: "e2e_d6:langgraph-python",
    serviceSlug: "langgraph-python",
    runId: "run-1",
    workerId: "worker-7",
    aggregateState: "green",
    aggregateKey: "e2e_d6:langgraph-python",
    aggregateSignal: { failedCount: 0 },
    cells: [],
    rollup: { total: 1, passed: 1, failed: 0 },
    finishedAt: "2026-06-04T00:00:02.000Z",
    ...overrides,
  };
}

describe("FleetQueueClient.enqueue", () => {
  it("writes a pending probe_jobs row carrying the serialized payload", async () => {
    const { pb, rows } = makeFakePb();
    const claim = makeFakeClaim();
    const q = createFleetQueueClient({ pb, claim, logger });

    const input: EnqueueJobInput = { payload: samplePayload() };
    const view = await q.enqueue(input);

    expect(view.status).toBe("pending");
    expect(view.probe_key).toBe("d6:langgraph-python");
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending");
    expect(rows[0].claimed_by).toBe("");
    expect(rows[0].payload).toEqual(samplePayload());
  });
});

describe("FleetQueueClient.claimNext", () => {
  it("claims the next pending job and returns a lease with the decoded payload", async () => {
    const payload = samplePayload();
    const { pb } = makeFakePb([{ ...jobView(), payload }]);
    const claim = makeFakeClaim({
      claimJob: vi.fn(
        async (jobId, workerId): Promise<ClaimResult> => ({
          won: true,
          job: jobView({
            id: jobId,
            status: "claimed",
            claimed_by: workerId,
            lease_expires_at: "2026-06-04T00:01:00.000Z",
            version: 1,
          }),
        }),
      ),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    const claimed = await q.claimNext("worker-7", 30);

    expect(claim.claimJob).toHaveBeenCalledWith("j1", "worker-7", 30);
    expect(claimed.claimed).toBe(true);
    expect(claimed.lease?.job.claimed_by).toBe("worker-7");
    expect(claimed.lease?.payload).toEqual(payload);
    expect(claimed.lease?.leaseExpiresAt).toBe("2026-06-04T00:01:00.000Z");
  });

  it("enqueue → claimNext round-trips the payload through the row", async () => {
    const { pb, rows } = makeFakePb();
    const claim = makeFakeClaim({
      claimJob: vi.fn(async (jobId, workerId): Promise<ClaimResult> => {
        const row = rows.find((r) => r.id === jobId);
        return {
          won: true,
          job: jobView({
            id: jobId,
            probe_key: row?.probe_key ?? "",
            status: "claimed",
            claimed_by: workerId,
            lease_expires_at: "2026-06-04T00:01:00.000Z",
            version: 1,
          }),
        };
      }),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    const payload = samplePayload({ cellIds: ["shared-state"] });
    await q.enqueue({ payload });
    const claimed = await q.claimNext("worker-7", 30);

    expect(claimed.claimed).toBe(true);
    expect(claimed.lease?.payload).toEqual(payload);
  });

  it("reports not-claimed when no pending jobs exist", async () => {
    const { pb } = makeFakePb();
    const claim = makeFakeClaim();
    const q = createFleetQueueClient({ pb, claim, logger });

    const claimed = await q.claimNext("worker-7", 30);

    expect(claimed.claimed).toBe(false);
    expect(claimed.lease).toBeUndefined();
    expect(claim.claimJob).not.toHaveBeenCalled();
  });

  it("releases and skips a won job whose payload fails to decode (never strands it)", async () => {
    // The CAS WON on j1, but its row payload is garbage (null) → decodePayload
    // throws. The job is already claimed/owned; if claimNext let the throw
    // escape, the job would be stranded (re-listed + re-thrown forever, then a
    // FALSE worker-crashed when the sweeper reclaims it). Instead it must
    // release the won job as `failed` and fall through to the next candidate.
    const { pb } = makeFakePb([
      // j1's payload is non-decodable; cast through unknown to seed garbage.
      {
        ...jobView({ id: "j1" }),
        payload: null as unknown as ServiceJobPayload,
      },
      { ...jobView({ id: "j2" }), payload: samplePayload() },
    ]);
    const releaseJob = vi.fn(
      async (): Promise<ReleaseResult> => ({ released: true }),
    );
    const claim = makeFakeClaim({
      releaseJob,
      claimJob: vi.fn(
        async (jobId, workerId): Promise<ClaimResult> => ({
          won: true,
          job: jobView({ id: jobId, status: "claimed", claimed_by: workerId }),
        }),
      ),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    // Must NOT throw — the decode failure on the won j1 is contained.
    const claimed = await q.claimNext("worker-7", 30);

    // j1 was released as failed (we owned it), then j2 was claimed.
    expect(releaseJob).toHaveBeenCalledWith("j1", "worker-7", "failed");
    expect(claimed.claimed).toBe(true);
    expect(claimed.lease?.job.id).toBe("j2");
  });

  it("treats a payload with a non-object meta as a decode failure (releases + skips)", async () => {
    // decodePayload must assert `meta` is a non-null object with a string
    // runId, failing LOUD at the boundary — a string/array meta satisfies the
    // `meta !== undefined` check but would deref to undefined deep in the
    // aggregator (it groups by meta.runId). The won job is released + skipped.
    const badMetaPayload = {
      ...samplePayload(),
      meta: "not-an-object",
    } as unknown as ServiceJobPayload;
    const { pb } = makeFakePb([
      { ...jobView({ id: "j1" }), payload: badMetaPayload },
      { ...jobView({ id: "j2" }), payload: samplePayload() },
    ]);
    const releaseJob = vi.fn(
      async (): Promise<ReleaseResult> => ({ released: true }),
    );
    const claim = makeFakeClaim({
      releaseJob,
      claimJob: vi.fn(
        async (jobId, workerId): Promise<ClaimResult> => ({
          won: true,
          job: jobView({ id: jobId, status: "claimed", claimed_by: workerId }),
        }),
      ),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    const claimed = await q.claimNext("worker-7", 30);

    expect(releaseJob).toHaveBeenCalledWith("j1", "worker-7", "failed");
    expect(claimed.claimed).toBe(true);
    expect(claimed.lease?.job.id).toBe("j2");
  });

  it("falls through to the next candidate when it loses the CAS on the first", async () => {
    const { pb } = makeFakePb([
      { ...jobView({ id: "j1" }), payload: samplePayload() },
      { ...jobView({ id: "j2" }), payload: samplePayload() },
    ]);
    const claim = makeFakeClaim({
      claimJob: vi.fn(async (jobId, workerId): Promise<ClaimResult> => {
        if (jobId === "j1") return { won: false };
        return {
          won: true,
          job: jobView({ id: jobId, status: "claimed", claimed_by: workerId }),
        };
      }),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    const claimed = await q.claimNext("worker-7", 30);

    expect(claim.claimJob).toHaveBeenCalledTimes(2);
    expect(claimed.claimed).toBe(true);
    expect(claimed.lease?.job.id).toBe("j2");
  });
});

describe("FleetQueueClient.renewLease", () => {
  it("delegates to S0 renewLease and returns the refreshed lease", async () => {
    const { pb } = makeFakePb([{ ...jobView(), payload: samplePayload() }]);
    const claim = makeFakeClaim({
      renewLease: vi.fn(
        async (): Promise<RenewResult> => ({
          renewed: true,
          job: jobView({
            id: "j1",
            status: "running",
            claimed_by: "worker-7",
            lease_expires_at: "2026-06-04T00:02:00.000Z",
            version: 2,
          }),
        }),
      ),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    const lease = await q.renewLease("j1", "worker-7", 30);

    expect(claim.renewLease).toHaveBeenCalledWith("j1", "worker-7", 30);
    expect(lease?.job.status).toBe("running");
    expect(lease?.leaseExpiresAt).toBe("2026-06-04T00:02:00.000Z");
    expect(lease?.payload).toEqual(samplePayload());
  });

  it("returns null when the lease was lost", async () => {
    const { pb } = makeFakePb([{ ...jobView(), payload: samplePayload() }]);
    const claim = makeFakeClaim();
    const q = createFleetQueueClient({ pb, claim, logger });

    const lease = await q.renewLease("j1", "worker-7", 30);

    expect(lease).toBeNull();
  });

  it("still renews when the convenience re-read returns null (CAS won)", async () => {
    // The CAS renewed and returned the lifecycle columns; a momentary PB read
    // blip makes the convenience getOne return null. The heartbeat must NOT
    // throw on that blip (throwing permanently stops heartbeating → the sweeper
    // later reclaims a LIVE job and synthesizes a FALSE worker-crashed comm
    // error). The payload is re-hydrated from the claim-time cache, so the
    // re-read is unnecessary and its failure is non-fatal.
    const payload = samplePayload();
    // Seed the store so claimNext can populate the payload cache, then the
    // renew re-read still works against this same row.
    const { pb } = makeFakePb([{ ...jobView({ id: "j1" }), payload }]);
    const claim = makeFakeClaim({
      claimJob: vi.fn(
        async (jobId, workerId): Promise<ClaimResult> => ({
          won: true,
          job: jobView({
            id: jobId,
            status: "claimed",
            claimed_by: workerId,
            lease_expires_at: "2026-06-04T00:01:00.000Z",
            version: 1,
          }),
        }),
      ),
      renewLease: vi.fn(
        async (): Promise<RenewResult> => ({
          renewed: true,
          job: jobView({
            id: "j1",
            status: "running",
            claimed_by: "worker-7",
            lease_expires_at: "2026-06-04T00:02:00.000Z",
            version: 2,
          }),
        }),
      ),
      // getOne is never required for a successful renew.
    });
    // Make the convenience re-read fail outright (null) to prove non-fatality.
    pb.getOne = vi.fn(async () => null) as PbClient["getOne"];
    const q = createFleetQueueClient({ pb, claim, logger });

    // Claim first so the payload cache is populated for this jobId.
    await q.claimNext("worker-7", 30);

    const lease = await q.renewLease("j1", "worker-7", 30);

    expect(lease).not.toBeNull();
    expect(lease?.job.status).toBe("running");
    expect(lease?.leaseExpiresAt).toBe("2026-06-04T00:02:00.000Z");
    expect(lease?.payload).toEqual(payload);
  });

  it("returns a lease on a SUCCESSFUL CAS even when cache miss AND reread fail", async () => {
    // The CAS renewed (won), but there is NO prior same-process claim (cache
    // empty) AND the convenience re-read THROWS (PB blip). A successful CAS
    // renew must keep the heartbeat ALIVE — returning null here would make the
    // heartbeat misread a healthy renew as a lost lease, stop, and let the
    // sweeper reclaim a LIVE job → a FALSE worker-crashed. So renewLease must
    // still return a lease (best-effort empty payload from the CAS row); null
    // is reserved for a FAILED CAS only.
    const { pb } = makeFakePb([
      { ...jobView({ id: "j1" }), payload: samplePayload() },
    ]);
    pb.getOne = vi.fn(async () => {
      throw new Error("transient PB read blip");
    }) as PbClient["getOne"];
    const claim = makeFakeClaim({
      renewLease: vi.fn(
        async (): Promise<RenewResult> => ({
          renewed: true,
          job: jobView({
            id: "j1",
            probe_key: "d6:langgraph-python",
            status: "running",
            claimed_by: "worker-7",
            lease_expires_at: "2026-06-04T00:02:00.000Z",
            version: 2,
          }),
        }),
      ),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    // No prior claimNext → payload cache is empty for j1.
    const lease = await q.renewLease("j1", "worker-7", 30);

    expect(lease).not.toBeNull();
    expect(lease?.job.status).toBe("running");
    expect(lease?.leaseExpiresAt).toBe("2026-06-04T00:02:00.000Z");
    // Best-effort payload carries the join key from the CAS row.
    expect(lease?.payload.probeKey).toBe("d6:langgraph-python");
  });
});

describe("FleetQueueClient.report", () => {
  /** A terminal-row seed so the post-release `pb.update` has a row to patch. */
  function seededRow(): JobRow {
    return { ...jobView({ id: "j1" }), payload: samplePayload() };
  }

  it("maps an all-green result to releaseJob(done)", async () => {
    const { pb } = makeFakePb([seededRow()]);
    const releaseJob = vi.fn(
      async (): Promise<ReleaseResult> => ({ released: true }),
    );
    const claim = makeFakeClaim({ releaseJob });
    const q = createFleetQueueClient({ pb, claim, logger });

    const input: ReportJobInput = {
      jobId: "j1",
      workerId: "worker-7",
      result: sampleResult(),
    };
    await q.report(input);

    expect(releaseJob).toHaveBeenCalledWith("j1", "worker-7", "done");
  });

  it("maps a red aggregate to releaseJob(failed)", async () => {
    const { pb } = makeFakePb([seededRow()]);
    const releaseJob = vi.fn(
      async (): Promise<ReleaseResult> => ({ released: true }),
    );
    const claim = makeFakeClaim({ releaseJob });
    const q = createFleetQueueClient({ pb, claim, logger });

    await q.report({
      jobId: "j1",
      workerId: "worker-7",
      result: sampleResult({ aggregateState: "red" }),
    });

    expect(releaseJob).toHaveBeenCalledWith("j1", "worker-7", "failed");
  });

  it("maps a comm-error result to releaseJob(failed) regardless of state", async () => {
    const { pb } = makeFakePb([seededRow()]);
    const releaseJob = vi.fn(
      async (): Promise<ReleaseResult> => ({ released: true }),
    );
    const claim = makeFakeClaim({ releaseJob });
    const q = createFleetQueueClient({ pb, claim, logger });

    await q.report({
      jobId: "j1",
      workerId: "worker-7",
      result: sampleResult({
        aggregateState: "green",
        commError: {
          kind: "worker-protocol-violation",
          message: "bad shape",
          observedAt: "2026-06-04T00:00:03.000Z",
        },
      }),
    });

    expect(releaseJob).toHaveBeenCalledWith("j1", "worker-7", "failed");
  });

  it("persists the ServiceJobResult onto the row, unprocessed, after the release", async () => {
    const { pb, rows } = makeFakePb([seededRow()]);
    // Assert ordering: the result is only written AFTER the CAS release wins.
    let releasedFirst = false;
    const releaseJob = vi.fn(async (): Promise<ReleaseResult> => {
      releasedFirst = true;
      return { released: true };
    });
    const claim = makeFakeClaim({ releaseJob });
    const q = createFleetQueueClient({ pb, claim, logger });

    const result = sampleResult();
    await q.report({ jobId: "j1", workerId: "worker-7", result });

    expect(releasedFirst).toBe(true);
    // The control-plane consumer reads this back to aggregate exactly once.
    expect(rows[0].result).toEqual(result);
    expect(rows[0].result_processed).toBe(false);
  });

  it("retries the result write, then throws a DISTINCT 'result lost' error when it keeps failing", async () => {
    // The release CAS SUCCEEDS (row is now terminal), but the SEPARATE result
    // write keeps failing. Giving up silently would DROP the result (terminal
    // row, no result → consumer latches it resultless, dashboard never
    // updates). report() must retry the write (bounded) and, when exhausted,
    // throw an error that DISTINGUISHES "release succeeded but result write
    // FAILED (result lost)" from a refused release.
    const { pb } = makeFakePb([seededRow()]);
    let updateAttempts = 0;
    pb.update = vi.fn(async () => {
      updateAttempts++;
      throw new Error("transient PB write blip");
    }) as PbClient["update"];
    const releaseJob = vi.fn(
      async (): Promise<ReleaseResult> => ({ released: true }),
    );
    const claim = makeFakeClaim({ releaseJob });
    const q = createFleetQueueClient({ pb, claim, logger });

    await expect(
      q.report({ jobId: "j1", workerId: "worker-7", result: sampleResult() }),
    ).rejects.toThrow(/result lost/i);
    // The release was attempted (and won) before the result write.
    expect(releaseJob).toHaveBeenCalledWith("j1", "worker-7", "done");
    // The write was RETRIED, not attempted once.
    expect(updateAttempts).toBeGreaterThan(1);
  });

  it("succeeds when the result write fails once then recovers (bounded retry)", async () => {
    const { pb, rows } = makeFakePb([seededRow()]);
    const realUpdate = pb.update.bind(pb);
    let updateAttempts = 0;
    pb.update = vi.fn(
      async (
        collection: string,
        id: string,
        record: Record<string, unknown>,
      ) => {
        updateAttempts++;
        if (updateAttempts === 1) throw new Error("transient blip");
        return realUpdate(collection, id, record);
      },
    ) as PbClient["update"];
    const claim = makeFakeClaim({
      releaseJob: vi.fn(
        async (): Promise<ReleaseResult> => ({ released: true }),
      ),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    const result = sampleResult();
    await q.report({ jobId: "j1", workerId: "worker-7", result });

    expect(updateAttempts).toBe(2);
    expect(rows[0].result).toEqual(result);
    expect(rows[0].result_processed).toBe(false);
  });

  it("does NOT persist a result when the release CAS is refused", async () => {
    const { pb, rows } = makeFakePb([seededRow()]);
    const claim = makeFakeClaim({
      releaseJob: vi.fn(
        async (): Promise<ReleaseResult> => ({ released: false }),
      ),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    await expect(
      q.report({ jobId: "j1", workerId: "worker-7", result: sampleResult() }),
    ).rejects.toThrow(/release/i);
    // A refused release must never leave a result on a row this worker no
    // longer owns — the consumer would otherwise aggregate a stale result.
    expect(rows[0].result).toBeUndefined();
  });
});

describe("FleetQueueClient.sweepExpired", () => {
  it("reclaims expired leases and emits worker-crashed-mid-job comm errors", async () => {
    const now = Date.parse("2026-06-04T00:05:00.000Z");
    // One running row with an EXPIRED lease (crashed worker), one with a live
    // lease that must NOT be swept.
    const expired: JobRow = {
      ...jobView({
        id: "j1",
        status: "running",
        claimed_by: "worker-dead",
        lease_expires_at: "2026-06-04T00:04:00.000Z",
        version: 3,
      }),
      payload: samplePayload(),
    };
    const live: JobRow = {
      ...jobView({
        id: "j2",
        status: "running",
        claimed_by: "worker-alive",
        lease_expires_at: "2026-06-04T00:06:00.000Z",
        version: 1,
      }),
      payload: samplePayload(),
    };
    const { pb } = makeFakePb([expired, live]);
    // The sweeper re-queues an expired row via S0 releaseJob(pending) on
    // behalf of the dead holder.
    const releaseJob = vi.fn(
      async (
        jobId: string,
        workerId: string,
        status: "done" | "failed" | "pending",
      ): Promise<ReleaseResult> => ({
        released: true,
        job: jobView({ id: jobId, status, claimed_by: "" }),
      }),
    );
    const claim = makeFakeClaim({ releaseJob });
    const q = createFleetQueueClient({ pb, claim, logger });

    const sweep = await q.sweepExpired(now);

    expect(sweep.reclaimed).toBe(1);
    expect(sweep.commErrors).toHaveLength(1);
    expect(sweep.commErrors[0].kind).toBe("worker-crashed-mid-job");
    expect(sweep.commErrors[0].jobId).toBe("j1");
    expect(sweep.commErrors[0].workerId).toBe("worker-dead");
    expect(releaseJob).toHaveBeenCalledWith("j1", "worker-dead", "pending");
    // The live lease must be untouched.
    expect(releaseJob).not.toHaveBeenCalledWith(
      "j2",
      expect.anything(),
      expect.anything(),
    );
  });

  it("reports nothing reclaimed when no leases are expired", async () => {
    const now = Date.parse("2026-06-04T00:05:00.000Z");
    const live: JobRow = {
      ...jobView({
        id: "j2",
        status: "running",
        claimed_by: "worker-alive",
        lease_expires_at: "2026-06-04T00:06:00.000Z",
      }),
      payload: samplePayload(),
    };
    const { pb } = makeFakePb([live]);
    const claim = makeFakeClaim();
    const q = createFleetQueueClient({ pb, claim, logger });

    const sweep = await q.sweepExpired(now);

    expect(sweep.reclaimed).toBe(0);
    expect(sweep.commErrors).toHaveLength(0);
    expect(claim.releaseJob).not.toHaveBeenCalled();
  });
});

describe("leaseExpired (anchored PB date-separator parse)", () => {
  const now = Date.parse("2026-06-04T00:05:00.000Z");

  it("treats null/empty as expired (never wedge the queue)", () => {
    expect(leaseExpired(null, now)).toBe(true);
    expect(leaseExpired("", now)).toBe(true);
  });

  it("parses the canonical PB space-separated form (expired in the past)", () => {
    // PB stores dates as "YYYY-MM-DD HH:MM:SS.sssZ" (space separator). The
    // anchored rewrite converts the date/time boundary so the value parses.
    expect(leaseExpired("2026-06-04 00:04:00.000Z", now)).toBe(true);
  });

  it("parses the canonical PB space-separated form (live in the future)", () => {
    expect(leaseExpired("2026-06-04 00:06:00.000Z", now)).toBe(false);
  });

  it("parses an already-ISO ('T'-separated) value unchanged", () => {
    expect(leaseExpired("2026-06-04T00:06:00.000Z", now)).toBe(false);
  });

  it("ANCHORS the space rewrite to the date/time boundary, not the FIRST space anywhere", () => {
    // A leading-space value is NOT the canonical `^YYYY-MM-DD ` shape, so the
    // anchored rewrite must leave it UNTOUCHED (the date/time boundary further
    // in is preserved). A bare String.replace(" ", "T") would rewrite the
    // LEADING space into "T2099-..." → NaN → wrongly EXPIRED. The anchored
    // form leaves the (future, year-2099) value parseable → correctly LIVE.
    // This pins the client to the JSVM hook's anchored regex; it FAILS under a
    // bare first-space replace.
    expect(leaseExpired(" 2099-01-01 00:00:00.000Z", now)).toBe(false);
  });

  it("treats a genuinely-unparseable value as expired (NaN → expired, not coerced)", () => {
    // An odd shape falls through to NaN → expired BY POLICY (never wedge the
    // queue) — but only because it genuinely failed to parse, NOT because a
    // bare first-space replace mangled it into something parseable.
    expect(leaseExpired("2099-01-01 garbage", now)).toBe(true);
  });
});
