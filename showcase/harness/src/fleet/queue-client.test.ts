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

/**
 * An RNG that makes `claimNext`'s Fisher-Yates shuffle a NO-OP (identity order),
 * so a test that depends on the candidate page being tried in its listed order
 * (j1 before j2) is deterministic despite the fairness shuffle. For each
 * descending index `i`, Fisher-Yates picks `j = floor(rng() * (i + 1))`;
 * returning a value just under 1 yields `j = i` every step, leaving the array
 * unchanged. (Production omits `rng` and gets `Math.random` → real shuffle.)
 */
const IDENTITY_ORDER_RNG = (): number => 0.999999999;

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
    // Identity-order rng so j1 (the poison row) is tried before j2 despite the
    // fairness shuffle — this test pins the decode-failure release on j1.
    const q = createFleetQueueClient({
      pb,
      claim,
      logger,
      rng: IDENTITY_ORDER_RNG,
    });

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
    // Identity-order rng so j1 (the bad-meta row) is tried before j2 despite the
    // fairness shuffle.
    const q = createFleetQueueClient({
      pb,
      claim,
      logger,
      rng: IDENTITY_ORDER_RNG,
    });

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
    // Identity-order rng so the CAS-loss-then-fall-through is deterministic: j1
    // is tried first (lost), then j2 (won) — exactly 2 attempts. The fairness
    // shuffle (production default) would otherwise randomize which is tried
    // first; this test pins the fall-through mechanism, not the ordering.
    const q = createFleetQueueClient({
      pb,
      claim,
      logger,
      rng: IDENTITY_ORDER_RNG,
    });

    const claimed = await q.claimNext("worker-7", 30);

    expect(claim.claimJob).toHaveBeenCalledTimes(2);
    expect(claimed.claimed).toBe(true);
    expect(claimed.lease?.job.id).toBe("j2");
  });
});

describe("FleetQueueClient.claimNext — CLAIM FAIRNESS (Part B contention)", () => {
  // ── ROOT CAUSE ──────────────────────────────────────────────────────────────
  // Every worker lists the SAME deterministically-ordered pending page (PB's
  // default order is caller-independent) and USED to attack it HEAD-FIRST — so
  // all 6 replicas thunder on the same head row every poll. Under the atomic
  // exactly-one-winner CAS only one wins the head; the losers serialize behind
  // it, burning extra CAS round-trips walking the list. Those extra round-trips
  // are latency: a loser re-polls later, claims less, and the worker that keeps
  // winning the head compounds into a ~4x hot outlier (the staging skew that
  // tipped legit settles past the per-turn budget).
  //
  // ── THE FIX (what this test pins) ────────────────────────────────────────────
  // `claimNext` now SHUFFLES its candidate-attempt order per poll. The
  // load-bearing change is the ATTEMPT ORDER: instead of every worker trying the
  // SAME head row first (the herd), each worker tries a DIFFERENT first
  // candidate, so the herd spreads across the whole page and a worker rarely has
  // to walk past a peer-held head to find a free job. These tests assert that
  // distribution of FIRST-attempted candidates directly: head-first concentrates
  // every poll on index 0; the shuffle spreads first-attempts uniformly.

  interface ListedRow {
    id: string;
    payload: ServiceJobPayload;
  }

  /** A pb that lists a FIXED ordered pending page (the shared snapshot all
   *  workers see). Only `list` is exercised — claimNext never mutates here. */
  function makeOrderedPb(orderedIds: string[]): PbClient {
    const unsupported = (name: string) => () => {
      throw new Error(`ordered-pb: ${name} not implemented`);
    };
    return {
      async list<T>(_c: string, opts: ListOpts = {}): Promise<ListResult<T>> {
        const items: ListedRow[] = orderedIds.map((id) => ({
          ...jobView({ id, status: "pending" }),
          payload: samplePayload(),
        }));
        return {
          page: 1,
          perPage: opts.perPage ?? items.length,
          totalPages: 1,
          totalItems: items.length,
          items: items as unknown as T[],
        };
      },
      create: unsupported("create") as PbClient["create"],
      getOne: unsupported("getOne") as PbClient["getOne"],
      getFirst: unsupported("getFirst") as PbClient["getFirst"],
      update: unsupported("update") as PbClient["update"],
      upsertByField: unsupported("upsertByField") as PbClient["upsertByField"],
      delete: unsupported("delete") as PbClient["delete"],
      deleteByFilter: unsupported(
        "deleteByFilter",
      ) as PbClient["deleteByFilter"],
      health: unsupported("health") as PbClient["health"],
      createBackup: unsupported("createBackup") as PbClient["createBackup"],
      downloadBackup: unsupported(
        "downloadBackup",
      ) as PbClient["downloadBackup"],
      deleteBackup: unsupported("deleteBackup") as PbClient["deleteBackup"],
    };
  }

  // Seeded deterministic PRNG so the shuffled run is reproducible (mulberry32).
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const PAGE_IDS = Array.from({ length: 12 }, (_, i) => `j${i}`);

  /** Run `polls` claimNext calls and return how many times each candidate index
   *  was the FIRST one attempted. */
  async function firstAttemptHistogram(
    rng: () => number,
    polls: number,
  ): Promise<number[]> {
    const firstAttempts: string[] = [];
    let sawThisCall = false;
    const claim: JobClaimClient = {
      async claimJob(jobId, workerId): Promise<ClaimResult> {
        if (!sawThisCall) {
          firstAttempts.push(jobId);
          sawThisCall = true;
        }
        return {
          won: true,
          job: jobView({ id: jobId, status: "claimed", claimed_by: workerId }),
        };
      },
      renewLease: vi.fn(async (): Promise<RenewResult> => ({ renewed: false })),
      releaseJob: vi.fn(
        async (): Promise<ReleaseResult> => ({ released: false }),
      ),
    };
    const q = createFleetQueueClient({
      pb: makeOrderedPb(PAGE_IDS),
      claim,
      logger,
      rng,
    });
    for (let i = 0; i < polls; i++) {
      sawThisCall = false;
      await q.claimNext(`w${i % 6}`, 30);
    }
    const hist = new Array(PAGE_IDS.length).fill(0);
    for (const id of firstAttempts) {
      hist[PAGE_IDS.indexOf(id)] += 1;
    }
    return hist;
  }

  it("RED (contrast): head-first order makes EVERY poll attack the same head row (index 0)", async () => {
    // IDENTITY_ORDER_RNG drives the REAL claimNext in head-first (no-shuffle)
    // order: the herd concentrates entirely on candidate index 0 every poll —
    // the exact thundering-herd that compounds into the claim skew.
    const hist = await firstAttemptHistogram(IDENTITY_ORDER_RNG, 600);
    // 100% of first-attempts landed on the head; every other slot got zero.
    expect(hist[0]).toBe(600);
    expect(hist.slice(1).every((c) => c === 0)).toBe(true);
  });

  it("GREEN: shuffled order spreads first-attempts ~uniformly across the page (herd dispersed)", async () => {
    const polls = 600;
    const hist = await firstAttemptHistogram(mulberry32(98765), polls);
    const expectedPerSlot = polls / PAGE_IDS.length; // 50
    // Every candidate slot gets a meaningful share of first-attempts — no single
    // head row absorbs the herd. A uniform shuffle keeps each slot within a loose
    // band of the expected count, and the head (index 0) is NOT a hot outlier.
    for (const count of hist) {
      expect(count).toBeGreaterThan(expectedPerSlot * 0.4);
      expect(count).toBeLessThan(expectedPerSlot * 1.6);
    }
    const max = Math.max(...hist);
    const mean = polls / PAGE_IDS.length;
    expect(max / mean).toBeLessThan(1.6);
  });
});

describe("FleetQueueClient — FAMILY FAIRNESS (backlogged families must not starve)", () => {
  // ── ROOT CAUSE (verified in prod + staging) ─────────────────────────────────
  // claimNext listed ONE global pending page (the oldest CLAIM_CANDIDATE_PAGE
  // rows). With a persistent backlog from the high-frequency families (d4 + d5
  // tick every 15min ≈ ~180 jobs/hr against 2 serial browser workers), the
  // oldest-50 page is permanently saturated by those families — a low-frequency
  // family's jobs (e2e-demos, hourly) NEVER enter the candidate page and are
  // NEVER claimed. Prod: all 18 e2e-demos jobs stuck pending forever behind a
  // 137-job backlog; staging: 3,734 pending with the oldest 22h old.
  //
  // ── THE FIX (what these tests pin) ──────────────────────────────────────────
  // claimNext now discovers the DISTINCT families present in pending (oldest
  // first) and tries them in ROTATION (round-robin across calls, resuming after
  // the last family this client claimed), listing a PER-FAMILY candidate page
  // for each. Every discovered family is attempted before claimNext gives up,
  // so no family can starve while any of its jobs are claimable. The CAS
  // exactly-one-winner semantics are untouched — only the candidate SELECTION
  // changed.

  /** probe_key → family (prefix before the first ":"), local to these tests. */
  const famOf = (probeKey: string): string => {
    const idx = probeKey.indexOf(":");
    return idx === -1 ? probeKey : probeKey.slice(0, idx);
  };

  /** A JobRow carrying PB's system `created` column (the paging sort key). */
  interface CreatedJobRow extends JobRow {
    created: string;
  }

  /**
   * A PAGING-FAITHFUL fake pb: unlike `makeFakePb` (which ignores `perPage` and
   * probe_key clauses), this fake honors the parts of the PB list API the
   * fairness fix depends on — `status` equality, `probe_key` `~`/`!~`/`=`/`!=`
   * clauses with `%` globs, `created` ascending sort, and `perPage` truncation —
   * so the production starvation (oldest-50 page saturated by one family) is
   * reproduced faithfully.
   */
  function makePagingPb(rows: CreatedJobRow[]): {
    pb: PbClient;
    store: CreatedJobRow[];
  } {
    const store = [...rows];
    const unsupported = (name: string) => () => {
      throw new Error(`paging-pb: ${name} not implemented`);
    };
    const globToRegExp = (pattern: string): RegExp =>
      new RegExp(
        `^${pattern
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          .replace(/%/g, ".*")}$`,
      );
    const rowMatches = (row: CreatedJobRow, filter?: string): boolean => {
      if (!filter) return true;
      const statuses = [...filter.matchAll(/status\s*=\s*"(\w+)"/g)].map(
        (m) => m[1],
      );
      if (statuses.length > 0 && !statuses.includes(row.status)) return false;
      const clauses = [
        ...filter.matchAll(/probe_key\s*(!~|!=|~|=)\s*"([^"]*)"/g),
      ];
      const positives = clauses.filter((m) => m[1] === "~" || m[1] === "=");
      const negatives = clauses.filter((m) => m[1] === "!~" || m[1] === "!=");
      for (const m of negatives) {
        const matches =
          m[1] === "!~"
            ? globToRegExp(m[2]).test(row.probe_key)
            : row.probe_key === m[2];
        if (matches) return false;
      }
      if (positives.length > 0) {
        const anyMatch = positives.some((m) =>
          m[1] === "~"
            ? globToRegExp(m[2]).test(row.probe_key)
            : row.probe_key === m[2],
        );
        if (!anyMatch) return false;
      }
      return true;
    };
    const pb: PbClient = {
      async list<T>(
        _collection: string,
        opts: ListOpts = {},
      ): Promise<ListResult<T>> {
        let items = store.filter((r) => rowMatches(r, opts.filter));
        if (opts.sort && opts.sort.includes("created")) {
          items = [...items].sort((a, b) => a.created.localeCompare(b.created));
        }
        const totalItems = items.length;
        if (opts.perPage !== undefined) items = items.slice(0, opts.perPage);
        return {
          page: 1,
          perPage: opts.perPage ?? items.length,
          totalPages: 1,
          totalItems,
          items: items as unknown as T[],
        };
      },
      getOne: unsupported("getOne") as PbClient["getOne"],
      getFirst: unsupported("getFirst") as PbClient["getFirst"],
      create: unsupported("create") as PbClient["create"],
      update: unsupported("update") as PbClient["update"],
      upsertByField: unsupported("upsertByField") as PbClient["upsertByField"],
      async delete(_collection: string, id: string): Promise<void> {
        const idx = store.findIndex((r) => r.id === id);
        if (idx === -1) throw new Error(`paging-pb: delete of missing ${id}`);
        store.splice(idx, 1);
      },
      deleteByFilter: unsupported(
        "deleteByFilter",
      ) as PbClient["deleteByFilter"],
      health: unsupported("health") as PbClient["health"],
      createBackup: unsupported("createBackup") as PbClient["createBackup"],
      downloadBackup: unsupported(
        "downloadBackup",
      ) as PbClient["downloadBackup"],
      deleteBackup: unsupported("deleteBackup") as PbClient["deleteBackup"],
    };
    return { pb, store };
  }

  /** A store-mutating CAS fake: exactly-one-winner over the shared store. */
  function makeStoreClaim(
    store: CreatedJobRow[],
    opts?: { loseFor?: (row: CreatedJobRow) => boolean },
  ): JobClaimClient {
    return {
      async claimJob(jobId, workerId): Promise<ClaimResult> {
        const row = store.find((r) => r.id === jobId);
        if (!row || row.status !== "pending") return { won: false };
        if (opts?.loseFor?.(row)) return { won: false };
        row.status = "claimed";
        row.claimed_by = workerId;
        row.version += 1;
        return { won: true, job: { ...row } };
      },
      renewLease: vi.fn(async (): Promise<RenewResult> => ({ renewed: false })),
      releaseJob: vi.fn(
        async (): Promise<ReleaseResult> => ({ released: false }),
      ),
    };
  }

  /** Seed: 60 old d4 jobs (oldest-50 page saturators) + 18 newer e2e-demos. */
  function starvedStore(): CreatedJobRow[] {
    const t0 = Date.parse("2026-06-04T00:00:00.000Z");
    const rows: CreatedJobRow[] = [];
    for (let i = 0; i < 60; i++) {
      const probeKey = `d4:svc-${String(i).padStart(2, "0")}`;
      rows.push({
        ...jobView({ id: `d4-${i}`, probe_key: probeKey }),
        payload: samplePayload({ probeKey, serviceSlug: `svc-${i}` }),
        created: new Date(t0 + i * 1000).toISOString(),
      });
    }
    for (let i = 0; i < 18; i++) {
      const probeKey = `e2e-demos:svc-${String(i).padStart(2, "0")}`;
      rows.push({
        ...jobView({ id: `demos-${i}`, probe_key: probeKey }),
        payload: samplePayload({ probeKey, serviceSlug: `svc-${i}` }),
        created: new Date(t0 + 3_600_000 + i * 1000).toISOString(),
      });
    }
    return rows;
  }

  it("claims a low-frequency family's jobs even when an older backlog saturates the candidate page (round-robin across families)", async () => {
    const { pb, store } = makePagingPb(starvedStore());
    const claim = makeStoreClaim(store);
    const q = createFleetQueueClient({ pb, claim, logger });

    const claimedFamilies: string[] = [];
    for (let i = 0; i < 6; i++) {
      const c = await q.claimNext("w1", 30);
      expect(c.claimed).toBe(true);
      claimedFamilies.push(famOf(c.lease!.job.probe_key));
    }

    // The e2e-demos jobs sit ENTIRELY outside the oldest-50 global page (60
    // older d4 rows precede them) — head-of-queue paging never claims them.
    expect(claimedFamilies).toContain("e2e-demos");
    // Round-robin: while BOTH families have pending jobs, consecutive claims
    // alternate families instead of draining the older family first.
    expect(new Set(claimedFamilies.slice(0, 2))).toEqual(
      new Set(["d4", "e2e-demos"]),
    );
    expect(new Set(claimedFamilies.slice(2, 4))).toEqual(
      new Set(["d4", "e2e-demos"]),
    );
  });

  it("tries EVERY pending family before reporting not-claimed (peer contention on one family cannot starve the rest)", async () => {
    const { pb, store } = makePagingPb(starvedStore());
    // Peers win every d4 CAS race; only the e2e-demos family is winnable.
    const claim = makeStoreClaim(store, {
      loseFor: (row) => row.probe_key.startsWith("d4:"),
    });
    const q = createFleetQueueClient({ pb, claim, logger });

    const c = await q.claimNext("w1", 30);

    expect(c.claimed).toBe(true);
    expect(famOf(c.lease!.job.probe_key)).toBe("e2e-demos");
  });

  it("countPendingForFamily counts ONLY that family's pending rows (producer backlog gate)", async () => {
    const t0 = Date.parse("2026-06-04T00:00:00.000Z");
    const rows: CreatedJobRow[] = [
      // Two pending e2e-demos rows (the countable backlog)...
      {
        ...jobView({ id: "demos-0", probe_key: "e2e-demos:a" }),
        payload: samplePayload({ probeKey: "e2e-demos:a" }),
        created: new Date(t0).toISOString(),
      },
      {
        ...jobView({ id: "demos-1", probe_key: "e2e-demos:b" }),
        payload: samplePayload({ probeKey: "e2e-demos:b" }),
        created: new Date(t0 + 1000).toISOString(),
      },
      // ...one CLAIMED e2e-demos row (in flight — NOT backlog)...
      {
        ...jobView({
          id: "demos-2",
          probe_key: "e2e-demos:c",
          status: "claimed",
          claimed_by: "w9",
        }),
        payload: samplePayload({ probeKey: "e2e-demos:c" }),
        created: new Date(t0 + 2000).toISOString(),
      },
      // ...and a pending row from a DIFFERENT family (must not count).
      {
        ...jobView({ id: "d4-0", probe_key: "d4:x" }),
        payload: samplePayload({ probeKey: "d4:x" }),
        created: new Date(t0 + 3000).toISOString(),
      },
    ];
    const { pb, store } = makePagingPb(rows);
    const q = createFleetQueueClient({
      pb,
      claim: makeStoreClaim(store),
      logger,
    });

    expect(await q.countPendingForFamily("e2e-demos")).toBe(2);
    expect(await q.countPendingForFamily("d4")).toBe(1);
    expect(await q.countPendingForFamily("d6")).toBe(0);
  });

  it("drains the remaining family once the other is exhausted", async () => {
    const t0 = Date.parse("2026-06-04T00:00:00.000Z");
    const rows: CreatedJobRow[] = [
      {
        ...jobView({ id: "d4-0", probe_key: "d4:only" }),
        payload: samplePayload({ probeKey: "d4:only" }),
        created: new Date(t0).toISOString(),
      },
      {
        ...jobView({ id: "demos-0", probe_key: "e2e-demos:a" }),
        payload: samplePayload({ probeKey: "e2e-demos:a" }),
        created: new Date(t0 + 1000).toISOString(),
      },
      {
        ...jobView({ id: "demos-1", probe_key: "e2e-demos:b" }),
        payload: samplePayload({ probeKey: "e2e-demos:b" }),
        created: new Date(t0 + 2000).toISOString(),
      },
    ];
    const { pb, store } = makePagingPb(rows);
    const claim = makeStoreClaim(store);
    const q = createFleetQueueClient({ pb, claim, logger });

    const claimedIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const c = await q.claimNext("w1", 30);
      expect(c.claimed).toBe(true);
      claimedIds.push(c.lease!.job.id);
    }
    // All three jobs are claimed across families; nothing is stranded.
    expect(new Set(claimedIds)).toEqual(
      new Set(["d4-0", "demos-0", "demos-1"]),
    );
    // The queue is now empty.
    const done = await q.claimNext("w1", 30);
    expect(done.claimed).toBe(false);
  });

  describe("sweepExpired — STALE-PENDING EXPIRY (structural backlog drain)", () => {
    // sweepExpired only reclaimed claimed/running leases — a pending row had
    // NO terminal path, so an accumulated backlog (staging: 3,734 pending,
    // oldest 22h) could only drain through 2 serial workers and effectively
    // never did. The sweep now ALSO expires pending jobs older than
    // expiryPeriods × their family's production period (the job's data is
    // stale — its family has long since enqueued fresher batches): each stale
    // row is first CLAIMED via the S0 CAS under a synthetic sweeper id (so a
    // racing worker can never lose a row out from under itself) and then
    // DELETED.

    const T = Date.parse("2026-06-04T12:00:00.000Z");
    const HOUR = 60 * 60 * 1000;
    const MIN = 60 * 1000;

    function pendingRow(
      id: string,
      probeKey: string,
      createdMs: number,
    ): CreatedJobRow {
      return {
        ...jobView({ id, probe_key: probeKey }),
        payload: samplePayload({ probeKey }),
        created: new Date(createdMs).toISOString(),
      };
    }

    it("claims-then-deletes pending jobs older than expiryPeriods × the (default) family period", async () => {
      const stale = pendingRow("old", "d6:a", T - 4 * HOUR); // > 3 × 60min
      const fresh = pendingRow("new", "d6:b", T - 10 * MIN);
      const { pb, store } = makePagingPb([stale, fresh]);
      const claimJobCalls: Array<[string, string]> = [];
      const base = makeStoreClaim(store);
      const claim: JobClaimClient = {
        ...base,
        async claimJob(jobId, workerId, leaseSeconds) {
          claimJobCalls.push([jobId, workerId]);
          return base.claimJob(jobId, workerId, leaseSeconds);
        },
      };
      const q = createFleetQueueClient({ pb, claim, logger });

      const sweep = await q.sweepExpired(T);

      expect(sweep.expiredPending).toBe(1);
      // The stale row was CLAIMED first (CAS — never delete a row a worker
      // could be racing for) and then deleted.
      expect(claimJobCalls.map(([id]) => id)).toEqual(["old"]);
      expect(store.find((r) => r.id === "old")).toBeUndefined();
      // The fresh row is untouched and still claimable.
      expect(store.find((r) => r.id === "new")?.status).toBe("pending");
      // No comm error for an expired-pending row — it never ran.
      expect(sweep.commErrors).toHaveLength(0);
    });

    it("does NOT delete a stale pending row whose claim is lost to a racing worker", async () => {
      const stale = pendingRow("old", "d6:a", T - 4 * HOUR);
      const { pb, store } = makePagingPb([stale]);
      // A worker wins every CAS race — the sweeper must back off.
      const claim = makeStoreClaim(store, { loseFor: () => true });
      const q = createFleetQueueClient({ pb, claim, logger });

      const sweep = await q.sweepExpired(T);

      expect(sweep.expiredPending).toBe(0);
      expect(store.find((r) => r.id === "old")?.status).toBe("pending");
    });

    it("honors per-family periods from stalePending.familyPeriodsMs", async () => {
      // 50min-old rows: stale for d4 (3 × 15min = 45min) but NOT for d6
      // (default 3 × 60min = 3h).
      const d4 = pendingRow("d4-old", "d4:a", T - 50 * MIN);
      const d6 = pendingRow("d6-young", "d6:a", T - 50 * MIN);
      const { pb, store } = makePagingPb([d4, d6]);
      const q = createFleetQueueClient({
        pb,
        claim: makeStoreClaim(store),
        logger,
        stalePending: { familyPeriodsMs: { d4: 15 * MIN } },
      });

      const sweep = await q.sweepExpired(T);

      expect(sweep.expiredPending).toBe(1);
      expect(store.find((r) => r.id === "d4-old")).toBeUndefined();
      expect(store.find((r) => r.id === "d6-young")?.status).toBe("pending");
    });

    it("is disabled when expiryPeriods <= 0", async () => {
      const stale = pendingRow("old", "d6:a", T - 48 * HOUR);
      const { pb, store } = makePagingPb([stale]);
      const q = createFleetQueueClient({
        pb,
        claim: makeStoreClaim(store),
        logger,
        stalePending: { expiryPeriods: 0 },
      });

      const sweep = await q.sweepExpired(T);

      expect(sweep.expiredPending).toBe(0);
      expect(store.find((r) => r.id === "old")?.status).toBe("pending");
    });

    it("conservatively skips a pending row whose created timestamp is unparseable (delete is destructive)", async () => {
      const garbage = {
        ...pendingRow("odd", "d6:a", T),
        created: "not-a-date",
      };
      const { pb, store } = makePagingPb([garbage]);
      const q = createFleetQueueClient({
        pb,
        claim: makeStoreClaim(store),
        logger,
      });

      const sweep = await q.sweepExpired(T);

      expect(sweep.expiredPending).toBe(0);
      expect(store.find((r) => r.id === "odd")?.status).toBe("pending");
    });
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
  it("reclaims expired leases and emits worker-reclaimed-pending comm errors (flap-band #70)", async () => {
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
    // flap-band #70: the sweep boundary cannot tell a real crash from an
    // expected platform teardown (both leave an identical expired lease), and
    // the job is RE-QUEUED to pending (back in flight), so the sweep emits the
    // NEUTRAL `worker-reclaimed-pending` kind — NOT `worker-crashed-mid-job`,
    // which would flap the service red on every routine teardown.
    expect(sweep.commErrors[0].kind).toBe("worker-reclaimed-pending");
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
