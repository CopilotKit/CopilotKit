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
  row: () => Record<string, unknown> | undefined;
} {
  const upserts: Array<{
    collection: string;
    field: string;
    value: string;
    record: Record<string, unknown>;
  }> = [];
  let state: Record<string, unknown> | undefined;
  const pb: RegistrationPbClient = {
    async upsertByField<T>(
      collection: string,
      field: string,
      value: string,
      record: Record<string, unknown>,
    ): Promise<T> {
      upserts.push({ collection, field, value, record });
      // Merge over existing state (mirrors PB upsert semantics).
      state = { ...(state ?? {}), [field]: value, ...record };
      return state as T;
    },
  };
  return { pb, upserts, row: () => state };
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

function makeLogger(): RegistrationLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
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
});
