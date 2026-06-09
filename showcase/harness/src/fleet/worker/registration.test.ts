import { describe, it, expect, vi } from "vitest";
import {
  registerWorker,
  type RegistrationPbClient,
  type RegistrationLogger,
  type WorkerPoolBudgetSource,
} from "./registration.js";
import { WORKERS_COLLECTION } from "../contracts.js";
import type { BrowserPoolBudget } from "../../probes/helpers/browser-pool.js";

/** A fake upsert-by-field PB that records every call and keeps a 1-row state. */
function makeFakePb(): {
  pb: RegistrationPbClient;
  upserts: Array<{
    collection: string;
    field: string;
    value: string;
    record: Record<string, unknown>;
  }>;
  deletes: Array<{ collection: string; filter: string }>;
  /** Ordered log of write KINDS as they SETTLE — proves no re-upsert after delete. */
  settled: Array<"upsert" | "delete">;
  row: () => Record<string, unknown> | undefined;
} {
  const upserts: Array<{
    collection: string;
    field: string;
    value: string;
    record: Record<string, unknown>;
  }> = [];
  const deletes: Array<{ collection: string; filter: string }> = [];
  const settled: Array<"upsert" | "delete"> = [];
  let state: Record<string, unknown> | undefined;
  const pb: RegistrationPbClient = {
    async upsertByField<T>(
      collection: string,
      field: string,
      value: string,
      record: Record<string, unknown>,
    ): Promise<T> {
      upserts.push({ collection, field, value, record });
      settled.push("upsert");
      // Merge over existing state (mirrors PB upsert semantics).
      state = { ...(state ?? {}), [field]: value, ...record };
      return state as T;
    },
    async deleteByFilter(collection: string, filter: string): Promise<number> {
      deletes.push({ collection, filter });
      settled.push("delete");
      const had = state !== undefined ? 1 : 0;
      state = undefined;
      return had;
    },
  };
  return { pb, upserts, deletes, settled, row: () => state };
}

function makeBudget(over: Partial<BrowserPoolBudget> = {}): BrowserPoolBudget {
  return {
    inUse: 3,
    available: 21,
    max: 24,
    pidsCurrent: 412,
    pidsMax: 1000,
    ...over,
  };
}

function makePool(budget: BrowserPoolBudget): WorkerPoolBudgetSource {
  return { budget: () => budget };
}

function makeLogger(): RegistrationLogger & {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
} {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

describe("registerWorker", () => {
  it("upserts a workers row with the correct id, endpoint and capacity on boot", async () => {
    const { pb, upserts, row } = makeFakePb();
    const reg = await registerWorker({
      pb,
      pool: makePool(makeBudget()),
      logger: makeLogger(),
      workerId: "worker-7",
      endpoint: "10.0.0.7:8080",
      now: () => Date.parse("2026-06-04T12:00:00.000Z"),
      // No real timers in this test.
      setIntervalImpl: (() => 0) as unknown as typeof setInterval,
    });
    reg.stop();

    expect(upserts).toHaveLength(1);
    const call = upserts[0];
    expect(call.collection).toBe(WORKERS_COLLECTION);
    expect(call.field).toBe("worker_id");
    expect(call.value).toBe("worker-7");
    expect(call.record).toMatchObject({
      endpoint: "10.0.0.7:8080",
      capacity_in_use: 3,
      capacity_available: 21,
      capacity_max: 24,
      capacity_pids_current: 412,
      capacity_pids_max: 1000,
      current_job_id: "",
      registered_at: "2026-06-04T12:00:00.000Z",
      last_heartbeat_at: "2026-06-04T12:00:00.000Z",
    });
    expect(row()).toMatchObject({ worker_id: "worker-7" });
  });

  it("maps the -1 cgroup pids sentinel to null (unavailable, not a count)", async () => {
    const { pb, upserts } = makeFakePb();
    const reg = await registerWorker({
      pb,
      pool: makePool(makeBudget({ pidsCurrent: -1, pidsMax: -1 })),
      logger: makeLogger(),
      workerId: "w1",
      endpoint: "host:1",
      now: () => 0,
      setIntervalImpl: (() => 0) as unknown as typeof setInterval,
    });
    reg.stop();
    expect(upserts[0].record.capacity_pids_current).toBeNull();
    expect(upserts[0].record.capacity_pids_max).toBeNull();
  });

  it("heartbeats on cadence, updating capacity + last_heartbeat_at (fake clock + timer)", async () => {
    vi.useFakeTimers();
    try {
      const { pb, upserts } = makeFakePb();
      // Capacity changes between beats so we can prove the heartbeat re-reads it.
      let budget = makeBudget({ inUse: 1, available: 23 });
      const pool: WorkerPoolBudgetSource = { budget: () => budget };
      let clock = Date.parse("2026-06-04T12:00:00.000Z");

      const reg = await registerWorker({
        pb,
        pool,
        logger: makeLogger(),
        workerId: "w-beat",
        endpoint: "host:9",
        heartbeatMs: 75_000,
        now: () => clock,
      });

      // Boot upsert only, so far.
      expect(upserts).toHaveLength(1);
      expect(upserts[0].record.registered_at).toBe("2026-06-04T12:00:00.000Z");

      // Advance capacity + clock, then fire one cadence tick.
      budget = makeBudget({ inUse: 9, available: 15 });
      clock = Date.parse("2026-06-04T12:01:15.000Z");
      await vi.advanceTimersByTimeAsync(75_000);

      expect(upserts).toHaveLength(2);
      const beat = upserts[1].record;
      // Heartbeat patch must NOT re-seed registered_at (preserve original).
      expect(beat.registered_at).toBeUndefined();
      expect(beat.capacity_in_use).toBe(9);
      expect(beat.capacity_available).toBe(15);
      expect(beat.last_heartbeat_at).toBe("2026-06-04T12:01:15.000Z");
      expect(beat.current_job_id).toBe("");

      // A second tick produces a third upsert.
      clock = Date.parse("2026-06-04T12:02:30.000Z");
      await vi.advanceTimersByTimeAsync(75_000);
      expect(upserts).toHaveLength(3);

      // stop() cancels the loop: no further beats after more time passes.
      reg.stop();
      await vi.advanceTimersByTimeAsync(75_000 * 3);
      expect(upserts).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("explicit heartbeat(jobId) records the current job id", async () => {
    const { pb, upserts } = makeFakePb();
    const reg = await registerWorker({
      pb,
      pool: makePool(makeBudget()),
      logger: makeLogger(),
      workerId: "w2",
      endpoint: "host:2",
      now: () => 0,
      setIntervalImpl: (() => 0) as unknown as typeof setInterval,
    });
    await reg.heartbeat("job-abc");
    reg.stop();
    // [0] = boot register, [1] = explicit heartbeat.
    expect(upserts).toHaveLength(2);
    expect(upserts[1].record.current_job_id).toBe("job-abc");
    expect(upserts[1].record.registered_at).toBeUndefined();
  });

  it("is best-effort: a PB failure on register never throws into the worker", async () => {
    const logger = makeLogger();
    const failingPb: RegistrationPbClient = {
      async upsertByField<T>(): Promise<T> {
        throw new Error("pb create failed: 400 missing collection");
      },
      async deleteByFilter(): Promise<number> {
        return 0;
      },
    };
    // Must resolve (not reject) despite the PB error.
    const reg = await registerWorker({
      pb: failingPb,
      pool: makePool(makeBudget()),
      logger,
      workerId: "w3",
      endpoint: "host:3",
      now: () => 0,
      setIntervalImpl: (() => 0) as unknown as typeof setInterval,
    });
    reg.stop();
    expect(logger.warn).toHaveBeenCalledWith(
      "worker.register-failed",
      expect.objectContaining({ workerId: "w3" }),
    );
    // An explicit heartbeat must also swallow.
    await expect(reg.heartbeat(null)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      "worker.heartbeat-failed",
      expect.objectContaining({ workerId: "w3" }),
    );
  });

  // ── deregister (FIX 3: graceful-drain row removal) ───────────────────────

  it("deregister() deletes the worker's registry row by worker_id", async () => {
    const { pb, deletes } = makeFakePb();
    const logger = makeLogger();
    const reg = await registerWorker({
      pb,
      pool: makePool(makeBudget()),
      logger,
      workerId: "w-drain",
      endpoint: "host:7",
      now: () => 0,
      setIntervalImpl: (() => 0) as unknown as typeof setInterval,
    });
    reg.stop();
    await reg.deregister();
    // Exactly one delete, scoped to the workers collection by worker_id key.
    expect(deletes).toHaveLength(1);
    expect(deletes[0].collection).toBe(WORKERS_COLLECTION);
    expect(deletes[0].filter).toBe('worker_id = "w-drain"');
    expect(logger.info).toHaveBeenCalledWith(
      "worker.deregistered",
      expect.objectContaining({ workerId: "w-drain" }),
    );
  });

  it("deregister() is best-effort: a delete failure does not throw, just warns", async () => {
    const logger = makeLogger();
    const failingDeletePb: RegistrationPbClient = {
      async upsertByField<T>(): Promise<T> {
        return {} as T;
      },
      async deleteByFilter(): Promise<number> {
        throw new Error("pb delete failed: network blip");
      },
    };
    const reg = await registerWorker({
      pb: failingDeletePb,
      pool: makePool(makeBudget()),
      logger,
      workerId: "w-drain-fail",
      endpoint: "host:8",
      now: () => 0,
      setIntervalImpl: (() => 0) as unknown as typeof setInterval,
    });
    reg.stop();
    // Must resolve (not reject) despite the PB delete error.
    await expect(reg.deregister()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      "worker.deregister-failed",
      expect.objectContaining({ workerId: "w-drain-fail" }),
    );
  });

  it("deregister() AWAITS an in-flight heartbeat write BEFORE deleting (no re-upsert after delete)", async () => {
    // The load-bearing no-re-upsert invariant: the final job-settle heartbeat is
    // fire-and-forget (`void registration.heartbeat(...)`), so a still-in-flight
    // upsert could land AFTER deregister's delete and re-create the row. The
    // handle's lastWrite chain must make deregister await that pending upsert
    // FIRST, then delete.
    const settled: Array<"upsert" | "delete"> = [];
    // A deferred the test controls: it gates the SECOND upsert (the
    // fire-and-forget heartbeat; n===2), which stays pending until released.
    // The boot upsert (n===1) settles immediately.
    let releaseHeartbeatUpsert!: () => void;
    const heartbeatUpsertGate = new Promise<void>((res) => {
      releaseHeartbeatUpsert = res;
    });
    let upsertCalls = 0;
    let deleteCalls = 0;
    const slowPb: RegistrationPbClient = {
      async upsertByField<T>(): Promise<T> {
        const n = ++upsertCalls;
        // The boot upsert (n===1) settles immediately so registerWorker resolves;
        // the SECOND upsert (the fire-and-forget heartbeat) stays pending until
        // the test releases it.
        if (n === 2) {
          await heartbeatUpsertGate;
        }
        settled.push("upsert");
        return {} as T;
      },
      async deleteByFilter(): Promise<number> {
        deleteCalls++;
        settled.push("delete");
        return 1;
      },
    };
    const reg = await registerWorker({
      pb: slowPb,
      pool: makePool(makeBudget()),
      logger: makeLogger(),
      workerId: "w-race",
      endpoint: "host:9",
      now: () => 0,
      setIntervalImpl: (() => 0) as unknown as typeof setInterval,
    });
    // Boot upsert settled.
    expect(settled).toEqual(["upsert"]);

    // Fire the heartbeat WITHOUT awaiting it (mirrors the fire-and-forget
    // `void registration.heartbeat(...)` in `runWorker`'s `onCurrentJobChange`
    // wiring, orchestrator.ts).
    void reg.heartbeat("job-x");
    reg.stop();
    // Kick off deregister; it must NOT delete while the upsert is still pending.
    const deregisterPromise = reg.deregister();

    // Let microtasks flush — deregister should be parked awaiting the pending upsert.
    await Promise.resolve();
    await Promise.resolve();
    expect(deleteCalls).toBe(0);
    expect(settled).toEqual(["upsert"]); // still only the boot upsert settled

    // Release the pending heartbeat upsert: it settles FIRST, then the delete.
    releaseHeartbeatUpsert();
    await deregisterPromise;

    expect(settled).toEqual(["upsert", "upsert", "delete"]);
    expect(deleteCalls).toBe(1);
    // No upsert occurs AFTER the delete.
    expect(settled.lastIndexOf("upsert")).toBeLessThan(
      settled.indexOf("delete"),
    );
  });

  it("a heartbeat fired AFTER deregister does not re-create the row (delete is last)", async () => {
    const { pb, settled, deletes, upserts, row } = makeFakePb();
    const logger = makeLogger();
    const reg = await registerWorker({
      pb,
      pool: makePool(makeBudget()),
      logger,
      workerId: "w-last",
      endpoint: "host:10",
      now: () => 0,
      setIntervalImpl: (() => 0) as unknown as typeof setInterval,
    });
    await reg.heartbeat("job-1");
    reg.stop();
    await reg.deregister();
    expect(deletes).toHaveLength(1);
    expect(row()).toBeUndefined();
    const upsertsBeforeLateBeat = upserts.length;

    // THE LOAD-BEARING PART: fire a heartbeat AFTER deregister completed.
    // Production path: worker-loop stop()'s drain-grace DETACH resolves while
    // a wedged driver still runs; when that driver finally settles, the
    // drain-abandon branch fires the fire-and-forget
    // `void registration.heartbeat(null)` via `runWorker`'s
    // `onCurrentJobChange` wiring (orchestrator.ts) — AFTER stop ordering
    // already deregistered. Capture + await the promise to flush the handle's
    // write chain (production discards it with `void`).
    const lateBeat = reg.heartbeat("job-x");
    await expect(lateBeat).resolves.toBeUndefined();

    // The latched handle must NOT have re-created the row: no upsert landed
    // after the delete, and the delete stays the LAST settled write.
    expect(row()).toBeUndefined();
    expect(upserts).toHaveLength(upsertsBeforeLateBeat);
    expect(settled[settled.length - 1]).toBe("delete");
    expect(logger.debug).toHaveBeenCalledWith(
      "worker.heartbeat-after-deregister-skipped",
      expect.objectContaining({ workerId: "w-last" }),
    );
  });

  it("a heartbeat racing deregister cannot land after the delete (delete is the chain's terminal link)", async () => {
    // The narrow race the latch must also close: a deregister() that merely
    // awaited a SNAPSHOT of the write chain and then deleted OUTSIDE the chain
    // lets a heartbeat issued after the snapshot resolved — but before the
    // delete settled — upsert AFTER the delete and resurrect the row. The
    // handle must (a) latch synchronously at deregister() entry so the racing
    // heartbeat is a no-op, and (b) run the delete THROUGH the serialization
    // chain as its terminal link so no upsert can interleave.
    const settled: Array<"upsert" | "delete"> = [];
    let upsertCalls = 0;
    let releaseDelete!: () => void;
    const deleteGate = new Promise<void>((res) => {
      releaseDelete = res;
    });
    let releaseLateUpsert!: () => void;
    const lateUpsertGate = new Promise<void>((res) => {
      releaseLateUpsert = res;
    });
    let state: Record<string, unknown> | undefined;
    const racePb: RegistrationPbClient = {
      async upsertByField<T>(
        _collection: string,
        field: string,
        value: string,
        record: Record<string, unknown>,
      ): Promise<T> {
        const n = ++upsertCalls;
        // Boot upsert (n===1) settles immediately so registerWorker resolves.
        // Any LATER upsert (the racing heartbeat — only reachable if the
        // handle wrongly lets it through) is held until the test releases it
        // AFTER the delete settles, modeling the PB write landing last.
        if (n > 1) await lateUpsertGate;
        settled.push("upsert");
        state = { ...(state ?? {}), [field]: value, ...record };
        return state as T;
      },
      async deleteByFilter(): Promise<number> {
        await deleteGate;
        settled.push("delete");
        const had = state !== undefined ? 1 : 0;
        state = undefined;
        return had;
      },
    };
    const reg = await registerWorker({
      pb: racePb,
      pool: makePool(makeBudget()),
      logger: makeLogger(),
      workerId: "w-race-late",
      endpoint: "host:11",
      now: () => 0,
      setIntervalImpl: (() => 0) as unknown as typeof setInterval,
    });
    expect(settled).toEqual(["upsert"]);
    reg.stop();

    // Start deregister; its delete is parked on the gate (NOT yet settled).
    const deregPromise = reg.deregister();
    // While the delete is in flight, the late fire-and-forget heartbeat fires
    // (the drain-abandon `void registration.heartbeat(...)` path).
    const lateBeat = reg.heartbeat("job-z");

    // Let the delete settle FIRST, then release the (would-be) late upsert.
    releaseDelete();
    await deregPromise;
    releaseLateUpsert();
    await lateBeat;

    // Delete is final; the racing heartbeat never upserted, so the row stays
    // absent instead of being resurrected for fleet-health's 180s red reclaim.
    expect(settled[settled.length - 1]).toBe("delete");
    expect(state).toBeUndefined();
    expect(upsertCalls).toBe(1); // boot only
  });
});
