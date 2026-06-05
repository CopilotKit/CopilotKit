import { describe, it, expect, vi } from "vitest";
import {
  createJobProducer,
  DEFAULT_SWEEP_INTERVAL_MS,
} from "./job-producer.js";
import type { JobProducer, ServiceJobSpec } from "./job-producer.js";
import type {
  EnqueueJobInput,
  FleetQueueClient,
  JobView,
  PoolCommError,
  SweepResult,
} from "../contracts.js";
import type { Logger } from "../../types/index.js";

/**
 * Pins the control-plane JOB PRODUCER contract (BLITZ S4):
 *   - one tick enqueues exactly one job PER SERVICE for the run, all
 *     sharing a single runId, with correct ServiceJobPayload/ServiceJobMeta;
 *   - sweepExpired() is invoked on cadence (fake clock + fake queue client);
 *   - operator-triggered runs stamp `triggered: true` and forward the filter;
 *   - per-service enqueue failures + enumeration failures are isolated;
 *   - start()/stop() bracket the producer's lifecycle (the wiring seams).
 *
 * All collaborators are injected fakes — no PocketBase, no Railway, no
 * Chromium (the control-plane runs none). The clock is injected so the
 * sweep-cadence gate is deterministic.
 */

const SILENT_LOGGER: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

/**
 * Fake FleetQueueClient that records every enqueue + sweep call. Only the
 * producer-facing methods (enqueue, sweepExpired) carry real behavior; the
 * consumer methods throw if the producer ever touches them (it must not).
 */
function makeFakeQueue(opts?: {
  enqueueImpl?: (input: EnqueueJobInput) => Promise<JobView>;
  sweepImpl?: (nowMs: number) => Promise<SweepResult>;
}): FleetQueueClient & {
  enqueued: EnqueueJobInput[];
  sweepCalls: number[];
} {
  const enqueued: EnqueueJobInput[] = [];
  const sweepCalls: number[] = [];
  let jobSeq = 0;
  return {
    enqueued,
    sweepCalls,
    async enqueue(input: EnqueueJobInput): Promise<JobView> {
      enqueued.push(input);
      if (opts?.enqueueImpl) return opts.enqueueImpl(input);
      jobSeq += 1;
      return {
        id: `job-${jobSeq}`,
        probe_key: input.payload.probeKey,
        status: "pending",
        claimed_by: "",
        lease_expires_at: null,
        version: 1,
      };
    },
    async sweepExpired(nowMs: number): Promise<SweepResult> {
      sweepCalls.push(nowMs);
      if (opts?.sweepImpl) return opts.sweepImpl(nowMs);
      return { reclaimed: 0, commErrors: [] };
    },
    claimNext() {
      throw new Error("producer must not call claimNext");
    },
    renewLease() {
      throw new Error("producer must not call renewLease");
    },
    report() {
      throw new Error("producer must not call report");
    },
  };
}

function d6Specs(slugs: string[]): ServiceJobSpec[] {
  return slugs.map((slug) => ({
    probeKey: `d6:${slug}`,
    serviceSlug: slug,
    driverKind: "e2e_d6",
    driverInputs: { backendUrl: `https://${slug}.example.com` },
  }));
}

/** A producer started and ready to tick, with its fake queue exposed. */
function startedProducer(overrides?: {
  specs?: ServiceJobSpec[];
  now?: () => number;
  sweepIntervalMs?: number;
  queue?: ReturnType<typeof makeFakeQueue>;
  runIdFactory?: () => string;
}): {
  producer: JobProducer;
  queue: ReturnType<typeof makeFakeQueue>;
} {
  const queue = overrides?.queue ?? makeFakeQueue();
  const specs =
    overrides?.specs ?? d6Specs(["langgraph-python", "crewai", "mastra"]);
  const producer = createJobProducer({
    queue,
    enumerate: () => specs,
    logger: SILENT_LOGGER,
    ...(overrides?.now ? { now: overrides.now } : {}),
    ...(overrides?.sweepIntervalMs !== undefined
      ? { sweepIntervalMs: overrides.sweepIntervalMs }
      : {}),
    ...(overrides?.runIdFactory
      ? { runIdFactory: overrides.runIdFactory }
      : {}),
  });
  producer.start();
  return { producer, queue };
}

describe("job-producer — per-service enqueue", () => {
  it("enqueues exactly one job per enumerated service on a tick", async () => {
    const { producer, queue } = startedProducer({
      specs: d6Specs(["a", "b", "c"]),
    });
    const result = await producer.tick();
    expect(result.enqueued).toBe(3);
    expect(queue.enqueued).toHaveLength(3);
    expect(queue.enqueued.map((e) => e.payload.serviceSlug)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("stamps every job in a tick with the SAME runId (one run = a set of jobs)", async () => {
    const { producer, queue } = startedProducer({
      specs: d6Specs(["a", "b"]),
      runIdFactory: () => "run-fixed",
    });
    const result = await producer.tick();
    expect(result.runId).toBe("run-fixed");
    const runIds = new Set(queue.enqueued.map((e) => e.payload.meta.runId));
    expect(runIds).toEqual(new Set(["run-fixed"]));
  });

  it("gives DIFFERENT runIds to two separate ticks (two runs)", async () => {
    let n = 0;
    const { producer, queue } = startedProducer({
      specs: d6Specs(["a"]),
      runIdFactory: () => `run-${++n}`,
    });
    await producer.tick();
    await producer.tick();
    const runIds = queue.enqueued.map((e) => e.payload.meta.runId);
    expect(runIds).toEqual(["run-1", "run-2"]);
  });

  it("builds a correct ServiceJobPayload (probeKey/serviceSlug/driverKind/inputs)", async () => {
    const { producer, queue } = startedProducer({
      specs: [
        {
          probeKey: "d6:langgraph-python",
          serviceSlug: "langgraph-python",
          driverKind: "e2e_d6",
          cellIds: ["shared-state"],
          driverInputs: { backendUrl: "https://lg.example.com" },
          priority: 5,
          leaseSeconds: 600,
        },
      ],
    });
    await producer.tick();
    const input = queue.enqueued[0]!;
    expect(input.payload.probeKey).toBe("d6:langgraph-python");
    expect(input.payload.serviceSlug).toBe("langgraph-python");
    expect(input.payload.driverKind).toBe("e2e_d6");
    expect(input.payload.cellIds).toEqual(["shared-state"]);
    expect(input.payload.driverInputs).toEqual({
      backendUrl: "https://lg.example.com",
    });
    expect(input.payload.meta.priority).toBe(5);
    expect(input.leaseSeconds).toBe(600);
  });

  it("stamps ServiceJobMeta.enqueuedAt from the injected clock", async () => {
    const fixedMs = Date.parse("2026-06-04T12:00:00.000Z");
    const { producer, queue } = startedProducer({
      specs: d6Specs(["a"]),
      now: () => fixedMs,
    });
    await producer.tick();
    expect(queue.enqueued[0]!.payload.meta.enqueuedAt).toBe(
      "2026-06-04T12:00:00.000Z",
    );
  });

  it("marks scheduled (cron) ticks as triggered:false", async () => {
    const { producer, queue } = startedProducer({ specs: d6Specs(["a"]) });
    await producer.tick();
    expect(queue.enqueued[0]!.payload.meta.triggered).toBe(false);
  });

  it("marks operator-triggered runs as triggered:true and forwards the filter", async () => {
    const seen: Array<{ triggered: boolean; filter?: unknown }> = [];
    const queue = makeFakeQueue();
    const producer = createJobProducer({
      queue,
      enumerate: (ctx) => {
        seen.push({ triggered: ctx.triggered, filter: ctx.filter });
        return d6Specs(ctx.filter?.slugs ?? ["a"]);
      },
      logger: SILENT_LOGGER,
    });
    producer.start();
    await producer.tick({ triggered: true, filter: { slugs: ["crewai"] } });
    expect(seen[0]).toEqual({
      triggered: true,
      filter: { slugs: ["crewai"] },
    });
    expect(queue.enqueued[0]!.payload.serviceSlug).toBe("crewai");
    expect(queue.enqueued[0]!.payload.meta.triggered).toBe(true);
  });

  it("enqueues nothing when the enumerator returns no services", async () => {
    const { producer, queue } = startedProducer({ specs: [] });
    const result = await producer.tick();
    expect(result.enqueued).toBe(0);
    expect(queue.enqueued).toHaveLength(0);
  });
});

describe("job-producer — failure isolation", () => {
  it("isolates a per-service enqueue failure (other services still enqueue)", async () => {
    const queue = makeFakeQueue({
      enqueueImpl: async (input) => {
        if (input.payload.serviceSlug === "b") {
          throw new Error("PB write blip");
        }
        return {
          id: `job-${input.payload.serviceSlug}`,
          probe_key: input.payload.probeKey,
          status: "pending",
          claimed_by: "",
          lease_expires_at: null,
          version: 1,
        };
      },
    });
    const { producer } = startedProducer({
      specs: d6Specs(["a", "b", "c"]),
      queue,
    });
    const result = await producer.tick();
    expect(result.enqueued).toBe(2);
    expect(result.enqueueFailures).toBe(1);
  });

  it("does not throw when enumeration fails; still attempts the sweep", async () => {
    const queue = makeFakeQueue();
    const producer = createJobProducer({
      queue,
      enumerate: () => {
        throw new Error("railway discovery down");
      },
      logger: SILENT_LOGGER,
      now: () => 1_000,
    });
    producer.start();
    const result = await producer.tick();
    expect(result.enqueued).toBe(0);
    expect(queue.enqueued).toHaveLength(0);
    // First tick always sweeps (lastSweepAt seeded null) — reclamation must
    // not be starved by a flaky enumerator.
    expect(result.sweptExpired).toBe(true);
    expect(queue.sweepCalls).toEqual([1_000]);
  });

  it("a failing sweep does not abort job production", async () => {
    const queue = makeFakeQueue({
      sweepImpl: async () => {
        throw new Error("sweep endpoint 500");
      },
    });
    const { producer } = startedProducer({
      specs: d6Specs(["a", "b"]),
      queue,
    });
    const result = await producer.tick();
    expect(result.enqueued).toBe(2);
    expect(result.reclaimed).toBe(0);
  });
});

describe("job-producer — sweep cadence", () => {
  it("sweeps on the FIRST tick (reclaims orphans from a prior crash)", async () => {
    const { producer, queue } = startedProducer({
      specs: d6Specs(["a"]),
      now: () => 5_000,
    });
    await producer.tick();
    expect(queue.sweepCalls).toEqual([5_000]);
  });

  it("does NOT sweep again before the cadence window elapses", async () => {
    let t = 0;
    const { producer, queue } = startedProducer({
      specs: d6Specs(["a"]),
      now: () => t,
      sweepIntervalMs: 30_000,
    });
    t = 0;
    await producer.tick(); // sweeps (first)
    t = 10_000; // < 30s later
    await producer.tick(); // must NOT sweep
    t = 20_000;
    await producer.tick(); // must NOT sweep
    expect(queue.sweepCalls).toEqual([0]);
  });

  it("sweeps again once the cadence window has elapsed", async () => {
    let t = 0;
    const { producer, queue } = startedProducer({
      specs: d6Specs(["a"]),
      now: () => t,
      sweepIntervalMs: 30_000,
    });
    t = 0;
    await producer.tick(); // sweep @0
    t = 40_000; // > 30s later
    await producer.tick(); // sweep @40_000
    expect(queue.sweepCalls).toEqual([0, 40_000]);
  });

  it("sweeps on EVERY tick when sweepIntervalMs <= 0", async () => {
    let t = 0;
    const { producer, queue } = startedProducer({
      specs: d6Specs(["a"]),
      now: () => t,
      sweepIntervalMs: 0,
    });
    t = 1;
    await producer.tick();
    t = 2;
    await producer.tick();
    t = 3;
    await producer.tick();
    expect(queue.sweepCalls).toEqual([1, 2, 3]);
  });

  it("surfaces reclaimed lease count from the sweep", async () => {
    const queue = makeFakeQueue({
      sweepImpl: async (nowMs) => ({
        reclaimed: 2,
        commErrors: [
          {
            kind: "worker-crashed-mid-job",
            message: "lease expired",
            observedAt: new Date(nowMs).toISOString(),
          },
        ],
      }),
    });
    const { producer } = startedProducer({ specs: d6Specs(["a"]), queue });
    const result = await producer.tick();
    expect(result.reclaimed).toBe(2);
  });

  it("[REQ-B] forwards the swept worker-crashed comm errors to the onSweepCommErrors sink", async () => {
    // The whole point of REQ-B: a crashed/lease-expired worker's job is
    // reclaimed and produces a worker-crashed-mid-job comm error. Previously
    // the producer only LOGGED commErrors.length and DISCARDED the array, so
    // the dashboard overlay was never written (the red state). Now the producer
    // FORWARDS the array to an injected sink the control-plane routes to the
    // aggregator.
    const sweptErrors: PoolCommError[] = [
      {
        kind: "worker-crashed-mid-job",
        message: "lease for job j1 expired; re-queued",
        workerId: "worker-dead",
        jobId: "j1",
        observedAt: "2026-06-04T00:00:09.000Z",
      },
    ];
    const queue = makeFakeQueue({
      sweepImpl: async () => ({ reclaimed: 1, commErrors: sweptErrors }),
    });
    const received: PoolCommError[][] = [];
    const producer = createJobProducer({
      queue,
      enumerate: () => d6Specs(["a"]),
      logger: SILENT_LOGGER,
      onSweepCommErrors: (errs) => {
        received.push(errs);
      },
    });
    producer.start();
    await producer.tick();

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(sweptErrors);
  });

  it("[REQ-B] does NOT call the sink when the sweep produced no comm errors", async () => {
    const queue = makeFakeQueue({
      sweepImpl: async () => ({ reclaimed: 0, commErrors: [] }),
    });
    let calls = 0;
    const producer = createJobProducer({
      queue,
      enumerate: () => d6Specs(["a"]),
      logger: SILENT_LOGGER,
      onSweepCommErrors: () => {
        calls += 1;
      },
    });
    producer.start();
    await producer.tick();
    expect(calls).toBe(0);
  });

  it("[REQ-B] a throwing comm-error sink does not abort job production", async () => {
    const queue = makeFakeQueue({
      sweepImpl: async () => ({
        reclaimed: 1,
        commErrors: [
          {
            kind: "worker-crashed-mid-job",
            message: "lease expired",
            jobId: "j1",
            observedAt: "2026-06-04T00:00:09.000Z",
          },
        ],
      }),
    });
    const producer = createJobProducer({
      queue,
      enumerate: () => d6Specs(["a", "b"]),
      logger: SILENT_LOGGER,
      onSweepCommErrors: () => {
        throw new Error("aggregator down");
      },
    });
    producer.start();
    const result = await producer.tick();
    expect(result.enqueued).toBe(2);
    expect(result.reclaimed).toBe(1);
  });

  it("defaults the sweep cadence to DEFAULT_SWEEP_INTERVAL_MS", async () => {
    let t = 0;
    const queue = makeFakeQueue();
    const producer = createJobProducer({
      queue,
      enumerate: () => d6Specs(["a"]),
      logger: SILENT_LOGGER,
      now: () => t,
    });
    producer.start();
    t = 0;
    await producer.tick(); // first sweep @0
    t = DEFAULT_SWEEP_INTERVAL_MS - 1; // just inside the window
    await producer.tick(); // no sweep
    t = DEFAULT_SWEEP_INTERVAL_MS; // window reached
    await producer.tick(); // sweep
    expect(queue.sweepCalls).toEqual([0, DEFAULT_SWEEP_INTERVAL_MS]);
  });
});

describe("job-producer — lifecycle seams (start/stop/tick)", () => {
  it("isRunning reflects start()/stop()", async () => {
    const queue = makeFakeQueue();
    const producer = createJobProducer({
      queue,
      enumerate: () => [],
      logger: SILENT_LOGGER,
    });
    expect(producer.isRunning()).toBe(false);
    producer.start();
    expect(producer.isRunning()).toBe(true);
    await producer.stop();
    expect(producer.isRunning()).toBe(false);
  });

  it("a tick before start() enqueues nothing", async () => {
    const queue = makeFakeQueue();
    const producer = createJobProducer({
      queue,
      enumerate: () => d6Specs(["a"]),
      logger: SILENT_LOGGER,
    });
    const result = await producer.tick();
    expect(result.enqueued).toBe(0);
    expect(queue.enqueued).toHaveLength(0);
  });

  it("a tick after stop() enqueues nothing (no jobs leak past lifecycle)", async () => {
    const { producer, queue } = startedProducer({ specs: d6Specs(["a"]) });
    await producer.stop();
    const result = await producer.tick();
    expect(result.enqueued).toBe(0);
    expect(queue.enqueued).toHaveLength(0);
  });

  it("does not restart after stop() (start-after-stop is a no-op)", async () => {
    const { producer } = startedProducer({ specs: d6Specs(["a"]) });
    await producer.stop();
    producer.start();
    expect(producer.isRunning()).toBe(false);
  });

  it("never touches consumer-side queue methods (claimNext/renewLease/report)", async () => {
    const queue = makeFakeQueue();
    const claimSpy = vi.spyOn(queue, "claimNext");
    const renewSpy = vi.spyOn(queue, "renewLease");
    const reportSpy = vi.spyOn(queue, "report");
    const producer = createJobProducer({
      queue,
      enumerate: () => d6Specs(["a", "b"]),
      logger: SILENT_LOGGER,
    });
    producer.start();
    await producer.tick();
    expect(claimSpy).not.toHaveBeenCalled();
    expect(renewSpy).not.toHaveBeenCalled();
    expect(reportSpy).not.toHaveBeenCalled();
  });
});
