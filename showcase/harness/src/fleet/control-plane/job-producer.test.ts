import { describe, it, expect, afterEach, vi } from "vitest";
import {
  createJobProducer,
  DEFAULT_SWEEP_INTERVAL_MS,
  MAX_BUFFERED_SWEEP_COMM_ERRORS,
} from "./job-producer.js";
import type {
  JobProducer,
  ServiceJobSpec,
  TickResult,
} from "./job-producer.js";
import type {
  EnqueueJobInput,
  FleetQueueClient,
  JobView,
  PoolCommError,
  PruneAgedResult,
  SweepResult,
} from "../contracts.js";
import {
  createFleetQueueClient,
  PoisonedBacklogCountError,
} from "../queue-client.js";
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
  /** Pending-count per family for the backlog dedupe gate; default 0 (clear). */
  countPendingImpl?: (family: string) => Promise<number>;
  pruneImpl?: (nowMs: number) => Promise<PruneAgedResult>;
}): FleetQueueClient & {
  /**
   * Every enqueue ATTEMPT, recorded BEFORE a throwing `enqueueImpl` gets to
   * reject — so for failure-injection tests this is attempts, not successful
   * enqueues (`queue.enqueued.length` can exceed `result.enqueued`).
   */
  enqueued: EnqueueJobInput[];
  sweepCalls: number[];
  countCalls: string[];
  pruneCalls: number[];
} {
  const enqueued: EnqueueJobInput[] = [];
  const sweepCalls: number[] = [];
  const countCalls: string[] = [];
  const pruneCalls: number[] = [];
  let jobSeq = 0;
  return {
    enqueued,
    sweepCalls,
    countCalls,
    async countPendingForFamily(family: string): Promise<number> {
      countCalls.push(family);
      if (opts?.countPendingImpl) return opts.countPendingImpl(family);
      return 0;
    },
    pruneCalls,
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
    async pruneAged(nowMs: number): Promise<PruneAgedResult> {
      pruneCalls.push(nowMs);
      if (opts?.pruneImpl) return opts.pruneImpl(nowMs);
      return { terminal: 0, zombie: 0 };
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
  logger?: Logger;
  family?: string;
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
    logger: overrides?.logger ?? SILENT_LOGGER,
    family: overrides?.family ?? "d6",
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

  it("stamps enqueuedAt at ENQUEUE time, not tick start (a slow enumerate must not back-date it)", async () => {
    // nowMs used to be captured BEFORE the potentially-seconds-long
    // enumerate() await, so meta.enqueuedAt (documented as 'ISO timestamp the
    // control-plane enqueued the job') was the tick-START time.
    let t = 1_000;
    const queue = makeFakeQueue();
    const producer = createJobProducer({
      queue,
      enumerate: () => {
        t = 61_000; // a slow discovery: 60s elapse inside enumerate
        return d6Specs(["a"]);
      },
      logger: SILENT_LOGGER,
      family: "d6",
      now: () => t,
    });
    producer.start();
    await producer.tick();
    expect(queue.enqueued[0]!.payload.meta.enqueuedAt).toBe(
      new Date(61_000).toISOString(),
    );
  });

  it("re-reads the clock for the sweep AFTER enumerate (expiry decisions are not back-dated)", async () => {
    let t = 1_000;
    const queue = makeFakeQueue();
    const producer = createJobProducer({
      queue,
      enumerate: () => {
        t = 61_000;
        return d6Specs(["a"]);
      },
      logger: SILENT_LOGGER,
      family: "d6",
      now: () => t,
    });
    producer.start();
    await producer.tick();
    // sweepExpired must be evaluated against the post-enumerate clock.
    expect(queue.sweepCalls).toEqual([61_000]);
  });

  it("the default runId factory reads the INJECTED clock, not Date.now", async () => {
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(9_999_999_999_999);
    try {
      const queue = makeFakeQueue();
      const producer = createJobProducer({
        queue,
        enumerate: () => d6Specs(["a"]),
        logger: SILENT_LOGGER,
        family: "d6",
        now: () => 123_456,
        // no runIdFactory → default factory under test
      });
      producer.start();
      const result = await producer.tick();
      expect(result.runId.startsWith(`frun_${(123_456).toString(36)}_`)).toBe(
        true,
      );
    } finally {
      dateNowSpy.mockRestore();
    }
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
      family: "d6",
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

  it("does NOT forward a filter on a scheduled tick (a scheduled tick must never be scoped)", async () => {
    // The filter is documented trigger-only: an operator filter accidentally
    // threaded into a scheduled (cron) tick must not scope the run.
    const seen: Array<{ triggered: boolean; filter?: unknown }> = [];
    const queue = makeFakeQueue();
    const producer = createJobProducer({
      queue,
      enumerate: (ctx) => {
        seen.push({ triggered: ctx.triggered, filter: ctx.filter });
        return d6Specs(["a", "b"]);
      },
      logger: SILENT_LOGGER,
      family: "d6",
    });
    producer.start();
    await producer.tick({ filter: { slugs: ["crewai"] } }); // NOT triggered
    expect(seen).toHaveLength(1);
    expect(seen[0]!.triggered).toBe(false);
    expect(seen[0]!.filter).toBeUndefined();
  });

  it("enqueues nothing when the enumerator returns no services", async () => {
    const { producer, queue } = startedProducer({ specs: [] });
    const result = await producer.tick();
    expect(result.enqueued).toBe(0);
    expect(queue.enqueued).toHaveLength(0);
  });

  it("logs tick-start BEFORE the enumerator runs (a hung discovery still leaves a tick trace)", async () => {
    // tick-start used to be logged AFTER the enumerate await — a discovery
    // upstream that hung or threw left no trace that the tick had begun.
    const events: string[] = [];
    const logger: Logger = {
      ...SILENT_LOGGER,
      info: (msg) => {
        events.push(msg);
      },
    };
    const producer = createJobProducer({
      queue: makeFakeQueue(),
      enumerate: () => {
        events.push("enumerate-invoked");
        return d6Specs(["a"]);
      },
      logger,
      family: "d6",
    });
    producer.start();
    await producer.tick();
    const startIdx = events.indexOf("fleet.producer.tick-start");
    const enumIdx = events.indexOf("enumerate-invoked");
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(enumIdx).toBeGreaterThanOrEqual(0);
    expect(startIdx).toBeLessThan(enumIdx);
  });
});

describe("job-producer — per-family backlog dedupe", () => {
  // ── ROOT CAUSE (verified in prod + staging) ─────────────────────────────
  // Every scheduled tick enqueued a FRESH batch regardless of whether the
  // family's PREVIOUS batch had even been claimed — with 2 serial browser
  // workers against ~180 jobs/hr of inflow the backlog compounded without
  // bound (staging: 3,734 pending, oldest 22h). A scheduled tick must SKIP
  // its family's batch when that family already has pending (unclaimed)
  // jobs, bounding the per-family backlog to one batch.

  it("skips the whole batch when the family already has a pending backlog (scheduled tick)", async () => {
    const { producer, queue } = startedProducer({
      specs: d6Specs(["a", "b", "c"]),
      queue: makeFakeQueue({ countPendingImpl: async () => 4 }),
    });

    const result = await producer.tick();

    expect(queue.countCalls).toEqual(["d6"]);
    expect(queue.enqueued).toHaveLength(0);
    expect(result.enqueued).toBe(0);
    expect(result.enqueueFailures).toBe(0);
    expect(result.skippedForBacklog).toBe(3);
  });

  it("enqueues normally when the family has no pending backlog", async () => {
    const { producer, queue } = startedProducer({
      specs: d6Specs(["a", "b"]),
      queue: makeFakeQueue({ countPendingImpl: async () => 0 }),
    });

    const result = await producer.tick();

    expect(queue.enqueued).toHaveLength(2);
    expect(result.enqueued).toBe(2);
    expect(result.skippedForBacklog).toBe(0);
  });

  it("gates each family independently when a tick spans multiple families", async () => {
    const specs: ServiceJobSpec[] = [
      ...d6Specs(["a"]),
      {
        probeKey: "e2e-demos:a",
        serviceSlug: "a",
        driverKind: "e2e_demos",
      },
    ];
    const { producer, queue } = startedProducer({
      specs,
      queue: makeFakeQueue({
        countPendingImpl: async (family) => (family === "d6" ? 7 : 0),
      }),
    });

    const result = await producer.tick();

    // d6 is backlogged (skipped); e2e-demos is clear (enqueued).
    expect(queue.enqueued.map((e) => e.payload.probeKey)).toEqual([
      "e2e-demos:a",
    ]);
    expect(result.enqueued).toBe(1);
    expect(result.skippedForBacklog).toBe(1);
  });

  it("operator-triggered ticks BYPASS the backlog gate (explicit intent wins)", async () => {
    const { producer, queue } = startedProducer({
      specs: d6Specs(["a", "b"]),
      queue: makeFakeQueue({ countPendingImpl: async () => 99 }),
    });

    const result = await producer.tick({ triggered: true });

    expect(queue.countCalls).toEqual([]);
    expect(queue.enqueued).toHaveLength(2);
    expect(result.enqueued).toBe(2);
    expect(result.skippedForBacklog).toBe(0);
  });

  it("runs the sweep BEFORE the backlog gate so a tick whose own sweep drains a family's stale backlog enqueues in the SAME tick", async () => {
    // A family whose backlog consists ONLY of stale pending rows: the sweep's
    // stale-pending drain expires all of them. If the gate runs before the
    // sweep, the tick still counts the about-to-be-expired backlog and skips
    // the family — production resumes a full cron period late even though
    // this very tick cleared the blockage.
    let pending = 3;
    const queue = makeFakeQueue({
      countPendingImpl: async () => pending,
      sweepImpl: async () => {
        pending = 0; // the stale-pending drain expired the whole backlog
        return { reclaimed: 0, commErrors: [], expiredPending: 3 };
      },
    });
    const { producer } = startedProducer({ specs: d6Specs(["a"]), queue });

    const result = await producer.tick();

    expect(result.sweptExpired).toBe(true);
    expect(result.skippedForBacklog).toBe(0);
    expect(result.enqueued).toBe(1);
    expect(queue.enqueued).toHaveLength(1);
  });

  it("fails OPEN when the backlog check itself fails (a count blip must not stop production)", async () => {
    const { producer, queue } = startedProducer({
      specs: d6Specs(["a"]),
      queue: makeFakeQueue({
        countPendingImpl: async () => {
          throw new Error("transient PB count blip");
        },
      }),
    });

    const result = await producer.tick();

    expect(queue.enqueued).toHaveLength(1);
    expect(result.enqueued).toBe(1);
    expect(result.skippedForBacklog).toBe(0);
  });

  it("reports families KEPT via fail-open in TickResult.backlogGateFailedOpen and the tick-complete log (a failed gate must be distinguishable from a clean one)", async () => {
    // A family kept because countPendingForFamily FAILED (non-poisoned) was
    // indistinguishable in the tick outcome from a family whose gate read a
    // clean zero — the same ambiguity class sweepFailed/enumerateFailed were
    // added to remove. Surface the fail-open count.
    const tickCompleteMeta: Array<Record<string, unknown> | undefined> = [];
    const specs: ServiceJobSpec[] = [
      ...d6Specs(["a"]),
      { probeKey: "e2e-demos:a", serviceSlug: "a", driverKind: "e2e_demos" },
    ];
    const { producer } = startedProducer({
      specs,
      queue: makeFakeQueue({
        countPendingImpl: async (family) => {
          if (family === "d6") throw new Error("transient PB count blip");
          return 0; // e2e-demos reads a clean zero
        },
      }),
      logger: {
        ...SILENT_LOGGER,
        info: (msg, meta) => {
          if (msg === "fleet.producer.tick-complete")
            tickCompleteMeta.push(meta);
        },
      },
    });

    const result = await producer.tick();

    // Both families produced — but exactly ONE of them via fail-open.
    expect(result.enqueued).toBe(2);
    expect(result.backlogGateFailedOpen).toBe(1);
    expect(tickCompleteMeta).toHaveLength(1);
    expect(tickCompleteMeta[0]).toMatchObject({ backlogGateFailedOpen: 1 });
  });

  it("backlogGateFailedOpen is 0 on a clean gate, a triggered (gate-bypassing) tick, and a skipped tick", async () => {
    const clean = startedProducer({ specs: d6Specs(["a"]) });
    expect((await clean.producer.tick()).backlogGateFailedOpen).toBe(0);

    const triggered = startedProducer({
      specs: d6Specs(["a"]),
      queue: makeFakeQueue({
        countPendingImpl: async () => {
          throw new Error("would fail open if consulted");
        },
      }),
    });
    expect(
      (await triggered.producer.tick({ triggered: true }))
        .backlogGateFailedOpen,
    ).toBe(0);

    const stopped = startedProducer({ specs: d6Specs(["a"]) });
    await stopped.producer.stop();
    expect((await stopped.producer.tick()).backlogGateFailedOpen).toBe(0);
  });

  it("fails CLOSED when the backlog count is POISONED (the queue-client's fail-closed refusal must not be failed open)", async () => {
    // countPendingForFamily THROWS its documented refusal when PB hands back a
    // non-count totalItems (e.g. -1): returning the poisoned value would
    // silently open the gate on top of an existing backlog. The producer's
    // broad fail-open catch must NOT defeat that — for THIS error class the
    // family's batch is SKIPPED (fail closed), accounted as skippedForBacklog.
    const poisonedErrors: unknown[] = [];
    const { producer, queue } = startedProducer({
      specs: d6Specs(["a", "b"]),
      queue: makeFakeQueue({
        countPendingImpl: async () => {
          throw new PoisonedBacklogCountError("d6", -1);
        },
      }),
      logger: {
        ...SILENT_LOGGER,
        error: (msg) => {
          if (msg === "fleet.producer.backlog-check-poisoned")
            poisonedErrors.push(msg);
        },
      },
    });

    const result = await producer.tick();

    expect(queue.enqueued).toHaveLength(0);
    expect(result.enqueued).toBe(0);
    expect(result.skippedForBacklog).toBe(2);
    expect(poisonedErrors).toHaveLength(1);
  });

  it("a poisoned count gates ONLY its own family (other families still produce, fail-open class still fails open)", async () => {
    const specs: ServiceJobSpec[] = [
      ...d6Specs(["a"]),
      { probeKey: "e2e-demos:a", serviceSlug: "a", driverKind: "e2e_demos" },
    ];
    const { producer, queue } = startedProducer({
      specs,
      queue: makeFakeQueue({
        countPendingImpl: async (family) => {
          if (family === "d6") {
            throw new PoisonedBacklogCountError("d6", -1);
          }
          throw new Error("transient PB count blip");
        },
      }),
    });

    const result = await producer.tick();

    // d6 fails CLOSED (skipped); e2e-demos's transient blip fails OPEN (kept).
    expect(queue.enqueued.map((e) => e.payload.probeKey)).toEqual([
      "e2e-demos:a",
    ]);
    expect(result.enqueued).toBe(1);
    expect(result.skippedForBacklog).toBe(1);
  });

  it("fail-closed keys on the error CLASS, not message text — a reworded refusal still fails closed (drift guard)", async () => {
    // The old gate matched a message substring copied from queue-client.ts.
    // Any rewording of that message silently flipped this fail-closed class
    // into the generic fail-open catch — the exact silent-fail-open hole the
    // refusal exists to close. The class is the contract; pin it by throwing
    // a PoisonedBacklogCountError whose message has fully drifted.
    const drifted = new PoisonedBacklogCountError("d6", -1);
    drifted.message = "completely reworded refusal text with no marker phrase";
    const { producer, queue } = startedProducer({
      specs: d6Specs(["a"]),
      queue: makeFakeQueue({
        countPendingImpl: async () => {
          throw drifted;
        },
      }),
    });

    const result = await producer.tick();

    expect(queue.enqueued).toHaveLength(0);
    expect(result.enqueued).toBe(0);
    expect(result.skippedForBacklog).toBe(1);
  });

  it("the REAL queue-client poisoned-count refusal fails the gate closed end-to-end (no test-literal drift)", async () => {
    // Integration drift guard: drive the producer's gate through the REAL
    // createFleetQueueClient refusal (a backend returning totalItems -1
    // despite skipTotal:false) instead of a hand-copied error literal — so
    // a change to the refusal's class or construction breaks THIS test
    // rather than silently failing the gate open in production.
    const enqueued: EnqueueJobInput[] = [];
    const fakePb = {
      async list() {
        return {
          page: 1,
          perPage: 1,
          totalPages: -1,
          totalItems: -1, // the poisoned non-count despite skipTotal:false
          items: [],
        };
      },
      async create(_c: string, record: Record<string, unknown>) {
        enqueued.push({ payload: record.payload as never });
        return record;
      },
      async getOne() {
        return null;
      },
      async update() {
        throw new Error("not used");
      },
      async delete() {
        throw new Error("not used");
      },
    } as unknown as import("../../storage/pb-client.js").PbClient;
    const realQueue = createFleetQueueClient({
      pb: fakePb,
      claim: {
        claimJob: async () => ({ won: false }),
        renewLease: async () => ({ renewed: false }),
        releaseJob: async () => ({ released: false }),
      },
      logger: SILENT_LOGGER,
      // Disable the stale-pending drain so the producer's first-tick sweep
      // doesn't consume the fake's list responses (this test pins the GATE).
      stalePending: { expiryPeriods: 0 },
    });
    const producer = createJobProducer({
      queue: realQueue,
      enumerate: () => d6Specs(["a"]),
      logger: SILENT_LOGGER,
      family: "d6",
      sweepIntervalMs: Number.MAX_SAFE_INTEGER,
    });
    producer.start();

    const result = await producer.tick();

    expect(enqueued).toHaveLength(0);
    expect(result.enqueued).toBe(0);
    expect(result.skippedForBacklog).toBe(1);
  });
});

describe("job-producer — phantom probeKey guard", () => {
  // probeKeyFamily("") returns "" (contracts.ts), so an enumerator-supplied
  // EMPTY probeKey flowed into countPendingForFamily("") (a phantom ""
  // family gating nothing real) and, worse, into an enqueued claim row no
  // dashboard status row can ever join. The producer must drop the spec at
  // the boundary — loudly, and accounted in the tick's failure partition.

  const GHOST_SPEC: ServiceJobSpec = {
    probeKey: "",
    serviceSlug: "ghost",
    driverKind: "e2e_d6",
  };

  it("drops an empty-probeKey spec on a SCHEDULED tick (no phantom '' family count, no unjoinable row)", async () => {
    const errors: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
    const { producer, queue } = startedProducer({
      specs: [GHOST_SPEC, ...d6Specs(["alpha"])],
      logger: {
        ...SILENT_LOGGER,
        error: (msg, meta) => {
          errors.push({ msg, ...(meta !== undefined ? { meta } : {}) });
        },
      },
    });

    const result = await producer.tick();

    // The backlog gate never saw the phantom "" family…
    expect(queue.countCalls).toEqual(["d6"]);
    // …and no unjoinable claim row was enqueued.
    expect(queue.enqueued.map((e) => e.payload.probeKey)).toEqual(["d6:alpha"]);
    // Accounted honestly: the dropped spec is a failure, and the partition
    // invariant (services == enqueued + enqueueFailures + skippedForBacklog
    // + truncatedByStop) still holds for the 2 enumerated specs.
    expect(result.enqueued).toBe(1);
    expect(result.enqueueFailures).toBe(1);
    expect(result.skippedForBacklog).toBe(0);
    expect(result.truncatedByStop).toBe(0);
    // Logged loudly, with the offending spec identified.
    const dropped = errors.find(
      (e) => e.msg === "fleet.producer.spec-invalid-probekey",
    );
    expect(dropped).toBeDefined();
    expect(dropped!.meta).toMatchObject({ serviceSlug: "ghost" });
  });

  it("a NON-OBJECT enumerator element (null/undefined/number) never rejects the tick promise and is counted as a failure", async () => {
    // The phantom-probeKey guard dereferenced `spec.probeKey` without
    // checking the ELEMENT itself is a non-null object — `[null]` from a
    // misbehaving enumerator threw a TypeError out of the tick body,
    // REJECTING the tick promise and violating the documented "a tick
    // promise never rejects" invariant (a throw inside stop()'s shared
    // completion would poison stopPromise for every later caller).
    for (const ghost of [null, undefined, 42]) {
      const errors: string[] = [];
      const { producer, queue } = startedProducer({
        specs: [ghost as unknown as ServiceJobSpec, ...d6Specs(["alpha"])],
        logger: {
          ...SILENT_LOGGER,
          error: (msg) => {
            errors.push(msg);
          },
        },
      });

      // MUST resolve — never reject.
      const result = await producer.tick();

      // The valid spec still produced; the ghost is an honest failure in the
      // existing invalid-spec accounting (partition invariant holds).
      expect(queue.enqueued.map((e) => e.payload.probeKey)).toEqual([
        "d6:alpha",
      ]);
      expect(result.enqueued).toBe(1);
      expect(result.enqueueFailures).toBe(1);
      expect(result.skippedForBacklog).toBe(0);
      expect(result.truncatedByStop).toBe(0);
      // Logged loudly like the empty-probeKey drop.
      expect(errors).toContain("fleet.producer.spec-invalid-probekey");
    }
  });

  it("drops an empty-probeKey spec on a TRIGGERED tick too (gate bypass does not bypass the guard)", async () => {
    const { producer, queue } = startedProducer({
      specs: [GHOST_SPEC, ...d6Specs(["alpha"])],
    });

    const result = await producer.tick({ triggered: true });

    expect(queue.enqueued.map((e) => e.payload.probeKey)).toEqual(["d6:alpha"]);
    expect(result.enqueued).toBe(1);
    expect(result.enqueueFailures).toBe(1);
  });

  it("an empty-probeKey spec is never health-warmed (the warm loop only sees validated specs)", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const queue = makeFakeQueue();
    const producer = createJobProducer({
      queue,
      enumerate: () => [
        {
          ...GHOST_SPEC,
          driverInputs: { backendUrl: "https://ghost.example.com" },
        },
        ...d6Specs(["alpha"]),
      ],
      logger: SILENT_LOGGER,
      family: "d6",
      warmHealth: { fetchImpl },
    });
    producer.start();
    await producer.tick();
    expect(calls).toEqual(["https://alpha.example.com/health"]);
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
      family: "d6",
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

  it("routes an enumerator that resolves to a NON-ARRAY through the enumerate-failure handling", async () => {
    // A misbehaving enumerator (bad wiring, a mock resolving undefined) used
    // to bypass the enumerateFailed path entirely and blow up further down
    // the tick. A non-array resolution is a FAILED enumeration, not an empty
    // catalog.
    const queue = makeFakeQueue();
    const producer = createJobProducer({
      queue,
      enumerate: () =>
        Promise.resolve(null) as unknown as Promise<ServiceJobSpec[]>,
      logger: SILENT_LOGGER,
      family: "d6",
      now: () => 1_000,
    });
    producer.start();
    const result = await producer.tick();
    expect(result.enumerateFailed).toBe(true);
    expect(result.enqueued).toBe(0);
    expect(queue.enqueued).toHaveLength(0);
    // The sweep is still attempted, same as the throwing-enumerator path.
    expect(queue.sweepCalls).toEqual([1_000]);
  });

  it("a failing enumerate is reported as enumerateFailed (not a legitimately empty run)", async () => {
    // Mirror of the sweepFailed test: pre-fix the enumerate-throw path
    // returned the same shape as an enumerator that legitimately yielded no
    // services — `enqueued: 0` — so a discovery outage was indistinguishable
    // from an empty catalog in the TickResult.
    const queue = makeFakeQueue();
    const producer = createJobProducer({
      queue,
      enumerate: () => {
        throw new Error("railway discovery down");
      },
      logger: SILENT_LOGGER,
      family: "d6",
    });
    producer.start();
    const result = await producer.tick();
    expect(result.enqueued).toBe(0);
    expect(result.enumerateFailed).toBe(true);
  });

  it("an empty (but successful) enumeration reports enumerateFailed:false", async () => {
    const { producer } = startedProducer({ specs: [] });
    const result = await producer.tick();
    expect(result.enqueued).toBe(0);
    expect(result.enumerateFailed).toBe(false);
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

  it("a failing sweep is reported as sweepFailed (not a clean zero-reclaim sweep)", async () => {
    // Pre-fix the catch arm returned the same shape as a clean sweep that
    // reclaimed nothing — `sweptExpired: true, reclaimed: 0` — so a thrown
    // sweep was indistinguishable from success in the TickResult / tick log.
    const queue = makeFakeQueue({
      sweepImpl: async () => {
        throw new Error("sweep endpoint 500");
      },
    });
    const { producer } = startedProducer({
      specs: d6Specs(["a"]),
      queue,
    });
    const result = await producer.tick();
    // The sweep RAN (cadence window consumed) but FAILED.
    expect(result.sweptExpired).toBe(true);
    expect(result.sweepFailed).toBe(true);
    expect(result.reclaimed).toBe(0);
  });

  it("a clean sweep reports sweepFailed:false (and so does a skipped sweep)", async () => {
    let t = 0;
    const { producer } = startedProducer({
      specs: d6Specs(["a"]),
      now: () => t,
      sweepIntervalMs: 30_000,
    });
    t = 0;
    const first = await producer.tick(); // sweeps (first tick), succeeds
    expect(first.sweptExpired).toBe(true);
    expect(first.sweepFailed).toBe(false);
    t = 10_000; // inside the cadence window — no sweep runs
    const second = await producer.tick();
    expect(second.sweptExpired).toBe(false);
    expect(second.sweepFailed).toBe(false);
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
            kind: "worker-reclaimed-pending",
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

  it("surfaces the sweep's reclaimedIndeterminate split on the TickResult when the queue reports it (optional access)", async () => {
    // The queue-client splits out reclaims whose release outcome was
    // INDETERMINATE (a transport failure after the CAS — the at-least-once /
    // over-report slice of `reclaimed`). Read via optional access so the
    // producer compiles against a SweepResult that doesn't carry the split.
    const sweepResult = {
      reclaimed: 3,
      commErrors: [],
      reclaimedIndeterminate: 2,
    } as SweepResult;
    const { producer } = startedProducer({
      specs: d6Specs(["a"]),
      queue: makeFakeQueue({ sweepImpl: async () => sweepResult }),
    });
    const result = await producer.tick();
    expect(result.reclaimed).toBe(3);
    expect(result.reclaimedIndeterminate).toBe(2);
  });

  it("omits reclaimedIndeterminate when the queue's sweep result does not carry the split", async () => {
    const { producer } = startedProducer({
      specs: d6Specs(["a"]),
      queue: makeFakeQueue({
        sweepImpl: async () => ({ reclaimed: 1, commErrors: [] }),
      }),
    });
    const result = await producer.tick();
    expect(result.reclaimedIndeterminate).toBeUndefined();
  });

  it("[REQ-B] forwards the swept worker-reclaimed-pending comm errors to the onSweepCommErrors sink", async () => {
    // The whole point of REQ-B: a lease-expired worker's job is reclaimed
    // (re-queued to pending) and produces a worker-reclaimed-pending comm
    // error. Previously the producer only LOGGED commErrors.length and
    // DISCARDED the array, so the dashboard surface was never written. Now
    // the producer FORWARDS the array to an injected sink the control-plane
    // routes to the aggregator.
    const sweptErrors: PoolCommError[] = [
      {
        kind: "worker-reclaimed-pending",
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
      family: "d6",
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
      family: "d6",
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
            kind: "worker-reclaimed-pending",
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
      family: "d6",
      onSweepCommErrors: () => {
        throw new Error("aggregator down");
      },
    });
    producer.start();
    const result = await producer.tick();
    expect(result.enqueued).toBe(2);
    expect(result.reclaimed).toBe(1);
  });

  it("[REQ-B] a failed sink delivery is BUFFERED and redelivered (prepended) on the next sweep's delivery", async () => {
    // sweepExpired only synthesizes comm errors for rows reclaimed in THAT
    // call — a transient sink failure must not permanently drop the reclaimed
    // jobs' dashboard signal. Tick 1's sink throws; tick 2's sink call must
    // deliver BOTH batches, tick 1's first.
    const err = (jobId: string): PoolCommError => ({
      kind: "worker-reclaimed-pending",
      message: `lease for job ${jobId} expired; re-queued`,
      jobId,
      observedAt: "2026-06-04T00:00:09.000Z",
    });
    let sweepN = 0;
    const queue = makeFakeQueue({
      sweepImpl: async () => {
        sweepN += 1;
        return { reclaimed: 1, commErrors: [err(`j${sweepN}`)] };
      },
    });
    const received: PoolCommError[][] = [];
    let sinkCalls = 0;
    const producer = createJobProducer({
      queue,
      enumerate: () => d6Specs(["a"]),
      logger: SILENT_LOGGER,
      family: "d6",
      sweepIntervalMs: 0, // sweep every tick
      onSweepCommErrors: (errs) => {
        sinkCalls += 1;
        if (sinkCalls === 1) throw new Error("aggregator down");
        received.push(errs);
      },
    });
    producer.start();
    await producer.tick(); // sink fails — j1 buffered
    await producer.tick(); // sink succeeds — j1 prepended to j2
    expect(received).toHaveLength(1);
    expect(received[0]!.map((e) => e.jobId)).toEqual(["j1", "j2"]);
  });

  it("[REQ-B] drains the buffered batch even when the CURRENT sweep throws (a failing sweep must not starve a healthy sink)", async () => {
    // The buffer exists precisely to ride out transient failures — but the
    // drain used to live inside maybeSweep's try SUCCESS path, so a
    // persistently-throwing sweepExpired (the exact failure mode the buffer
    // rides out) never handed the buffered batch to a now-healthy sink.
    // Tick 1: sweep succeeds, sink throws → j1 buffered. Tick 2: sweep
    // THROWS, sink healthy → j1 must still be delivered.
    const err = (jobId: string): PoolCommError => ({
      kind: "worker-reclaimed-pending",
      message: `lease for job ${jobId} expired; re-queued`,
      jobId,
      observedAt: "2026-06-04T00:00:09.000Z",
    });
    let sweepN = 0;
    const queue = makeFakeQueue({
      sweepImpl: async () => {
        sweepN += 1;
        if (sweepN === 1) return { reclaimed: 1, commErrors: [err("j1")] };
        throw new Error("sweep endpoint 500");
      },
    });
    const received: PoolCommError[][] = [];
    let sinkCalls = 0;
    const producer = createJobProducer({
      queue,
      enumerate: () => d6Specs(["a"]),
      logger: SILENT_LOGGER,
      family: "d6",
      sweepIntervalMs: 0, // sweep every tick
      onSweepCommErrors: (errs) => {
        sinkCalls += 1;
        if (sinkCalls === 1) throw new Error("aggregator down");
        received.push(errs);
      },
    });
    producer.start();
    await producer.tick(); // sweep ok, sink fails — j1 buffered
    const second = await producer.tick(); // sweep throws, sink healthy
    expect(second.sweepFailed).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0]!.map((e) => e.jobId)).toEqual(["j1"]);
  });

  it("[REQ-B] caps the undelivered buffer at MAX_BUFFERED_SWEEP_COMM_ERRORS, dropping oldest", async () => {
    const errs = (n: number, prefix: string): PoolCommError[] =>
      Array.from({ length: n }, (_, i) => ({
        kind: "worker-reclaimed-pending" as const,
        message: "lease expired",
        jobId: `${prefix}${i}`,
        observedAt: "2026-06-04T00:00:09.000Z",
      }));
    // Derived from the cap so a retuned MAX_BUFFERED_SWEEP_COMM_ERRORS can't
    // silently turn this into a no-overflow (vacuously green) test.
    const OVERFLOW = 100;
    const seeded = MAX_BUFFERED_SWEEP_COMM_ERRORS + OVERFLOW;
    let sweepN = 0;
    const queue = makeFakeQueue({
      sweepImpl: async () => {
        sweepN += 1;
        // Tick 1 reclaims more than the cap; tick 2 reclaims one more.
        return sweepN === 1
          ? { reclaimed: seeded, commErrors: errs(seeded, "old") }
          : { reclaimed: 1, commErrors: errs(1, "fresh") };
      },
    });
    const received: PoolCommError[][] = [];
    let sinkCalls = 0;
    const producer = createJobProducer({
      queue,
      enumerate: () => d6Specs(["a"]),
      logger: SILENT_LOGGER,
      family: "d6",
      sweepIntervalMs: 0,
      onSweepCommErrors: (batch) => {
        sinkCalls += 1;
        if (sinkCalls === 1) throw new Error("aggregator down");
        received.push(batch);
      },
    });
    producer.start();
    await producer.tick(); // `seeded` buffered → trimmed to the newest cap-ful
    await producer.tick(); // delivers the capped buffer + 1 fresh
    expect(received).toHaveLength(1);
    expect(received[0]).toHaveLength(MAX_BUFFERED_SWEEP_COMM_ERRORS + 1);
    // The OVERFLOW oldest entries were dropped: the buffer starts at the
    // first surviving entry, ends with the fresh one.
    expect(received[0]![0]!.jobId).toBe(`old${OVERFLOW}`);
    expect(received[0]![received[0]!.length - 1]!.jobId).toBe("fresh0");
  });

  it("[REQ-B] the buffer-overflow warn identifies the dropped jobs (capped jobIds sample), like its sibling drop paths", async () => {
    // The overflow drop is one of THREE paths that permanently lose a comm
    // error's dashboard signal. The other two (no-sink drop, stop()-drain
    // drop) log the dropped jobIds; the overflow warn carried only a count —
    // an operator could see THAT signals were lost but never WHICH jobs.
    const errs = (n: number, prefix: string): PoolCommError[] =>
      Array.from({ length: n }, (_, i) => ({
        kind: "worker-reclaimed-pending" as const,
        message: "lease expired",
        jobId: `${prefix}${i}`,
        observedAt: "2026-06-04T00:00:09.000Z",
      }));
    const OVERFLOW = 5;
    const seeded = MAX_BUFFERED_SWEEP_COMM_ERRORS + OVERFLOW;
    const queue = makeFakeQueue({
      sweepImpl: async () => ({
        reclaimed: seeded,
        commErrors: errs(seeded, "old"),
      }),
    });
    const warns: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
    const producer = createJobProducer({
      queue,
      enumerate: () => d6Specs(["a"]),
      logger: {
        ...SILENT_LOGGER,
        warn: (msg, meta) => {
          warns.push({ msg, ...(meta !== undefined ? { meta } : {}) });
        },
      },
      family: "d6",
      sweepIntervalMs: 0,
      onSweepCommErrors: () => {
        throw new Error("aggregator down");
      },
    });
    producer.start();
    await producer.tick();

    const overflow = warns.find(
      (w) => w.msg === "fleet.producer.sweep-commerror-buffer-overflow",
    );
    expect(overflow).toBeDefined();
    expect(overflow!.meta).toMatchObject({ dropped: OVERFLOW });
    // The DROPPED (oldest) entries' jobIds, not the survivors'.
    expect(overflow!.meta!.jobIds).toEqual([
      "old0",
      "old1",
      "old2",
      "old3",
      "old4",
    ]);
  });

  it("[REQ-B] the buffer-overflow warn caps its jobIds sample (a mass drop must not flood one log line)", async () => {
    const errs = (n: number): PoolCommError[] =>
      Array.from({ length: n }, (_, i) => ({
        kind: "worker-reclaimed-pending" as const,
        message: "lease expired",
        jobId: `old${i}`,
        observedAt: "2026-06-04T00:00:09.000Z",
      }));
    const OVERFLOW = 50; // more than the sample cap
    const queue = makeFakeQueue({
      sweepImpl: async () => ({
        reclaimed: MAX_BUFFERED_SWEEP_COMM_ERRORS + OVERFLOW,
        commErrors: errs(MAX_BUFFERED_SWEEP_COMM_ERRORS + OVERFLOW),
      }),
    });
    const warns: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
    const producer = createJobProducer({
      queue,
      enumerate: () => d6Specs(["a"]),
      logger: {
        ...SILENT_LOGGER,
        warn: (msg, meta) => {
          warns.push({ msg, ...(meta !== undefined ? { meta } : {}) });
        },
      },
      family: "d6",
      sweepIntervalMs: 0,
      onSweepCommErrors: () => {
        throw new Error("aggregator down");
      },
    });
    producer.start();
    await producer.tick();

    const overflow = warns.find(
      (w) => w.msg === "fleet.producer.sweep-commerror-buffer-overflow",
    );
    expect(overflow).toBeDefined();
    expect(overflow!.meta).toMatchObject({ dropped: OVERFLOW });
    const jobIds = overflow!.meta!.jobIds as string[];
    expect(jobIds.length).toBeLessThan(OVERFLOW);
    expect(jobIds[0]).toBe("old0");
  });

  it("[REQ-B] warns ONCE (with jobIds) when swept comm errors exist but no sink is configured", async () => {
    // Legacy logged-only mode drops the batch's dashboard signal with only a
    // count in the sweep-reclaimed warn. Surface the wiring gap explicitly —
    // once, with the dropped jobIds — without burying logs on every sweep.
    const warns: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
    const logger: Logger = {
      ...SILENT_LOGGER,
      warn: (msg, meta) => {
        warns.push({ msg, ...(meta !== undefined ? { meta } : {}) });
      },
    };
    const queue = makeFakeQueue({
      sweepImpl: async () => ({
        reclaimed: 1,
        commErrors: [
          {
            kind: "worker-reclaimed-pending",
            message: "lease for job j1 expired; re-queued",
            jobId: "j1",
            observedAt: "2026-06-04T00:00:09.000Z",
          },
        ],
      }),
    });
    const producer = createJobProducer({
      queue,
      enumerate: () => d6Specs(["a"]),
      logger,
      family: "d6",
      sweepIntervalMs: 0, // sweep (and drop) on every tick
      // no onSweepCommErrors sink
    });
    producer.start();
    await producer.tick();
    await producer.tick();
    const noSinkWarns = warns.filter(
      (w) => w.msg === "fleet.producer.sweep-commerrors-no-sink",
    );
    expect(noSinkWarns).toHaveLength(1);
    expect(noSinkWarns[0]!.meta).toMatchObject({
      commErrors: 1,
      jobIds: ["j1"],
      droppedTotal: 1,
    });
  });

  it("[REQ-B] no-sink drops AFTER the first warn are logged at debug with jobIds + a running dropped-total", async () => {
    // The one-shot warn keeps a sink-less deployment from burying its logs —
    // but it made every SUBSEQUENT drop fully silent: reclaims kept being
    // dropped with no trace at all of which jobs or how many. Later drops are
    // logged at debug (greppable, not log-burying) with the dropped jobIds
    // and a running dropped-total; the total also rides the first warn.
    const warns: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
    const debugs: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
    const logger: Logger = {
      ...SILENT_LOGGER,
      warn: (msg, meta) => {
        warns.push({ msg, ...(meta !== undefined ? { meta } : {}) });
      },
      debug: (msg, meta) => {
        debugs.push({ msg, ...(meta !== undefined ? { meta } : {}) });
      },
    };
    let sweepN = 0;
    const queue = makeFakeQueue({
      sweepImpl: async () => {
        sweepN += 1;
        return {
          reclaimed: 1,
          commErrors: [
            {
              kind: "worker-reclaimed-pending",
              message: `lease for job j${sweepN} expired; re-queued`,
              jobId: `j${sweepN}`,
              observedAt: "2026-06-04T00:00:09.000Z",
            },
          ],
        };
      },
    });
    const producer = createJobProducer({
      queue,
      enumerate: () => d6Specs(["a"]),
      logger,
      family: "d6",
      sweepIntervalMs: 0, // sweep (and drop) on every tick
      // no onSweepCommErrors sink
    });
    producer.start();
    await producer.tick(); // first drop — the one-shot warn
    await producer.tick(); // second drop — debug
    await producer.tick(); // third drop — debug
    const noSinkWarns = warns.filter(
      (w) => w.msg === "fleet.producer.sweep-commerrors-no-sink",
    );
    expect(noSinkWarns).toHaveLength(1);
    const noSinkDebugs = debugs.filter(
      (d) => d.msg === "fleet.producer.sweep-commerrors-no-sink",
    );
    expect(noSinkDebugs).toHaveLength(2);
    expect(noSinkDebugs[0]!.meta).toMatchObject({
      commErrors: 1,
      jobIds: ["j2"],
      droppedTotal: 2,
    });
    expect(noSinkDebugs[1]!.meta).toMatchObject({
      commErrors: 1,
      jobIds: ["j3"],
      droppedTotal: 3,
    });
  });

  it("defaults the sweep cadence to DEFAULT_SWEEP_INTERVAL_MS", async () => {
    let t = 0;
    const queue = makeFakeQueue();
    const producer = createJobProducer({
      queue,
      enumerate: () => d6Specs(["a"]),
      logger: SILENT_LOGGER,
      family: "d6",
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

describe("job-producer — family stamping + d6-gated retention prune", () => {
  it("tick stamps options.family onto every EnqueueJobInput it builds", async () => {
    const { producer, queue } = startedProducer({
      specs: d6Specs(["a", "b", "c"]),
      family: "d6",
    });
    await producer.tick();
    expect(queue.enqueued).toHaveLength(3);
    for (const input of queue.enqueued) {
      expect(input.family).toBe("d6");
    }
  });

  it("stamps a non-d6 family verbatim (the §5.1 registry id, not a derivation)", async () => {
    const { producer, queue } = startedProducer({
      specs: d6Specs(["a"]),
      family: "e2e-demos",
    });
    await producer.tick();
    expect(queue.enqueued[0]!.family).toBe("e2e-demos");
  });

  it("the d6 producer invokes queue.pruneAged when the sweep window is due", async () => {
    const { producer, queue } = startedProducer({
      specs: d6Specs(["a"]),
      family: "d6",
      now: () => 5_000,
    });
    await producer.tick(); // first tick: sweep due (lastSweepAt seeded null)
    expect(queue.sweepCalls).toEqual([5_000]);
    expect(queue.pruneCalls).toEqual([5_000]);
  });

  it("a non-d6 producer never invokes queue.pruneAged (single-owner prune)", async () => {
    const { producer, queue } = startedProducer({
      specs: d6Specs(["a"]),
      family: "e2e-smoke",
      sweepIntervalMs: 0, // sweep due on EVERY tick — prune still must not fire
    });
    await producer.tick();
    await producer.tick();
    expect(queue.sweepCalls).toHaveLength(2);
    expect(queue.pruneCalls).toHaveLength(0);
  });

  it("pruneAged is not invoked when the sweep cadence window has not elapsed", async () => {
    let t = 0;
    const { producer, queue } = startedProducer({
      specs: d6Specs(["a"]),
      family: "d6",
      now: () => t,
      sweepIntervalMs: 30_000,
    });
    t = 0;
    await producer.tick(); // sweep + prune @0
    t = 10_000; // < 30s later — window not elapsed
    await producer.tick(); // no sweep, no prune
    expect(queue.pruneCalls).toEqual([0]);
  });

  it("a pruneAged failure is logged and never aborts production", async () => {
    const queue = makeFakeQueue({
      pruneImpl: async () => {
        throw new Error("PB delete blip");
      },
    });
    const warns: string[] = [];
    const producer = createJobProducer({
      queue,
      enumerate: () => d6Specs(["a", "b"]),
      logger: {
        ...SILENT_LOGGER,
        warn: (msg: string) => {
          warns.push(msg);
        },
      },
      family: "d6",
    });
    producer.start();
    const result = await producer.tick();
    // Production completed despite the prune throwing (mirror maybeSweep's
    // swallow discipline).
    expect(result.enqueued).toBe(2);
    expect(warns).toContain("fleet.producer.prune-failed");
  });
});

describe("job-producer — #72 pre-dispatch health warm-up", () => {
  afterEach(() => {
    // restoreAllMocks does NOT undo vi.stubGlobal — a leaked global fetch stub
    // poisons unrelated files under fork-reuse (repo discipline).
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /** A fetch spy that records each warm URL and resolves a 200. */
  function makeFetchSpy(): {
    fetchImpl: typeof fetch;
    calls: { url: string; method: string | undefined }[];
  } {
    const calls: { url: string; method: string | undefined }[] = [];
    const fetchImpl = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      calls.push({ url: String(input), method: init?.method });
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    return { fetchImpl, calls };
  }

  it("fires a health GET for every enumerated spec BEFORE dispatch", async () => {
    const { fetchImpl, calls } = makeFetchSpy();
    // Track enqueue ordering: the warm must fire before any enqueue. We assert
    // this by capturing the warm-call count observed at first enqueue time.
    let warmCountAtFirstEnqueue = -1;
    const queue = makeFakeQueue({
      enqueueImpl: async (input) => {
        if (warmCountAtFirstEnqueue === -1) {
          warmCountAtFirstEnqueue = calls.length;
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
    const producer = createJobProducer({
      queue,
      enumerate: () => d6Specs(["alpha", "beta"]),
      logger: SILENT_LOGGER,
      family: "d6",
      warmHealth: { fetchImpl },
    });
    producer.start();
    await producer.tick();

    // One warm GET per enumerated spec.
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.method).toBe("GET");
    }
    // deriveHealthUrl appends /health to the spec's backendUrl base.
    const urls = calls.map((c) => c.url).sort();
    expect(urls).toEqual([
      "https://alpha.example.com/health",
      "https://beta.example.com/health",
    ]);
    // Both warm GETs fired BEFORE the first job was enqueued.
    expect(warmCountAtFirstEnqueue).toBe(2);
  });

  it("does NOT warm when no warmHealth config is supplied (legacy behavior)", async () => {
    // Stub the GLOBAL fetch: the meaningful no-warm guarantee is that an
    // unconfigured producer never falls back to `globalThis.fetch` for warm
    // GETs. (The prior shape of this test asserted zero calls on a local spy
    // it never wired in — vacuously true by construction.)
    const globalFetchSpy = vi.fn(
      async (): Promise<Response> => new Response(null, { status: 200 }),
    );
    vi.stubGlobal("fetch", globalFetchSpy);
    const queue = makeFakeQueue();
    const producer = createJobProducer({
      queue,
      enumerate: () => d6Specs(["alpha"]),
      logger: SILENT_LOGGER,
      family: "d6",
      // no warmHealth
    });
    producer.start();
    const result = await producer.tick();
    // The tick produced normally but fired no warm GET at all.
    expect(result.enqueued).toBe(1);
    expect(globalFetchSpy).not.toHaveBeenCalled();
  });

  it("a rejecting warm fetch never aborts job production (best-effort)", async () => {
    const failingFetch = (async (): Promise<Response> => {
      throw new Error("ECONNREFUSED (cold container still booting)");
    }) as typeof fetch;
    const queue = makeFakeQueue();
    const producer = createJobProducer({
      queue,
      enumerate: () => d6Specs(["alpha", "beta"]),
      logger: SILENT_LOGGER,
      family: "d6",
      warmHealth: { fetchImpl: failingFetch },
    });
    producer.start();
    const result = await producer.tick();
    // Production proceeded despite every warm GET rejecting.
    expect(result.enqueued).toBe(2);
  });

  it("a SYNCHRONOUSLY-throwing warm fetch never aborts the tick (per-spec dispatch is isolated)", async () => {
    // An injected fetchImpl that throws synchronously (not a rejected promise)
    // must not escape the warm loop and abort the whole tick before any job
    // is enqueued — warm-up must NEVER block or fail job production.
    const fetchImpl = (() => {
      throw new Error("sync EINVAL from fetch impl");
    }) as unknown as typeof fetch;
    const queue = makeFakeQueue();
    const producer = createJobProducer({
      queue,
      enumerate: () => d6Specs(["alpha", "beta"]),
      logger: SILENT_LOGGER,
      family: "d6",
      warmHealth: { fetchImpl },
    });
    producer.start();
    const result = await producer.tick();
    expect(result.enqueued).toBe(2);
    expect(queue.enqueued).toHaveLength(2);
  });

  it("aborts a hanging warm GET once the timeout elapses (AbortController path)", async () => {
    // COUPLING PIN: this test (and the implementation) depend on the warm
    // timeout being an AbortController + setTimeout pair. Do NOT "simplify"
    // the implementation to AbortSignal.timeout() — its timer lives outside
    // vitest's fake-timer patching, so advanceTimersByTime below would never
    // fire the abort and this test would hang/fail for the wrong reason.
    vi.useFakeTimers();
    let abortedCount = 0;
    // A fetch that never settles until its signal aborts — models a hung cold
    // container that would otherwise pin the request forever.
    const fetchImpl = ((
      _input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          abortedCount += 1;
          reject(new Error("aborted"));
        });
      })) as typeof fetch;
    const queue = makeFakeQueue();
    const producer = createJobProducer({
      queue,
      enumerate: () => d6Specs(["alpha"]),
      logger: SILENT_LOGGER,
      family: "d6",
      warmHealth: { fetchImpl, timeoutMs: 1_000 },
    });
    producer.start();
    const result = await producer.tick();
    // The hung GET never blocked production…
    expect(result.enqueued).toBe(1);
    expect(abortedCount).toBe(0);
    // …and the timeout reaps it.
    vi.advanceTimersByTime(1_000);
    expect(abortedCount).toBe(1);
  });

  it("consumes (cancels) the warm response body so an unread body can't pin the socket", async () => {
    let cancelled = 0;
    const fetchImpl = (async (): Promise<Response> => {
      const body = new ReadableStream<Uint8Array>({
        cancel() {
          cancelled += 1;
        },
      });
      return new Response(body, { status: 200 });
    }) as typeof fetch;
    const queue = makeFakeQueue();
    const producer = createJobProducer({
      queue,
      enumerate: () => d6Specs(["alpha"]),
      logger: SILENT_LOGGER,
      family: "d6",
      warmHealth: { fetchImpl },
    });
    producer.start();
    await producer.tick();
    // The .then success handler runs on a later microtask than tick's return —
    // yield so the fire-and-forget chain settles.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cancelled).toBe(1);
  });

  it("counts a warm GET as fired only when the dispatch succeeded (sync-throwing fetch is not 'warmed')", async () => {
    // `fired` used to be incremented BEFORE the dispatch try — a fetchImpl
    // that threw synchronously still counted, so the `warmed` log overstated
    // how many backends were actually poked.
    const infos: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
    const logger: Logger = {
      ...SILENT_LOGGER,
      info: (msg, meta) => {
        infos.push({ msg, ...(meta !== undefined ? { meta } : {}) });
      },
    };
    const fetchImpl = ((input: string | URL | Request): Promise<Response> => {
      if (String(input).includes("alpha")) {
        throw new Error("sync EINVAL from fetch impl");
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    }) as typeof fetch;
    const queue = makeFakeQueue();
    const producer = createJobProducer({
      queue,
      enumerate: () => d6Specs(["alpha", "beta"]),
      logger,
      family: "d6",
      warmHealth: { fetchImpl },
    });
    producer.start();
    await producer.tick();
    const warmed = infos.find((e) => e.msg === "fleet.producer.warmed");
    expect(warmed).toBeDefined();
    expect(warmed!.meta).toMatchObject({ warmed: 1 }); // beta only
  });

  it("a settled-but-failing warm response (e.g. 503) logs warm-failed with the status, NOT warm-ok", async () => {
    // The success handler used to log warm-ok for ANY settled response —
    // including 404/500/503 — so a misderived backendUrl could masquerade
    // as healthy forever. A non-ok status is a warm FAILURE.
    const debugs: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
    const logger: Logger = {
      ...SILENT_LOGGER,
      debug: (msg, meta) => {
        debugs.push({ msg, ...(meta !== undefined ? { meta } : {}) });
      },
    };
    const fetchImpl = (async (): Promise<Response> =>
      new Response(null, { status: 503 })) as typeof fetch;
    const producer = createJobProducer({
      queue: makeFakeQueue(),
      enumerate: () => d6Specs(["alpha"]),
      logger,
      family: "d6",
      warmHealth: { fetchImpl },
    });
    producer.start();
    await producer.tick();
    // Let the fire-and-forget chain settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(debugs.map((e) => e.msg)).not.toContain("fleet.producer.warm-ok");
    const failed = debugs.find((e) => e.msg === "fleet.producer.warm-failed");
    expect(failed).toBeDefined();
    expect(failed!.meta).toMatchObject({
      serviceSlug: "alpha",
      healthUrl: "https://alpha.example.com/health",
      status: 503,
    });
  });

  it("an ok warm response logs warm-ok WITH the status", async () => {
    const debugs: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
    const logger: Logger = {
      ...SILENT_LOGGER,
      debug: (msg, meta) => {
        debugs.push({ msg, ...(meta !== undefined ? { meta } : {}) });
      },
    };
    const fetchImpl = (async (): Promise<Response> =>
      new Response(null, { status: 200 })) as typeof fetch;
    const producer = createJobProducer({
      queue: makeFakeQueue(),
      enumerate: () => d6Specs(["alpha"]),
      logger,
      family: "d6",
      warmHealth: { fetchImpl },
    });
    producer.start();
    await producer.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const ok = debugs.find((e) => e.msg === "fleet.producer.warm-ok");
    expect(ok).toBeDefined();
    expect(ok!.meta).toMatchObject({ status: 200 });
  });

  it("a throwing logger inside the warm chain never raises an unhandled rejection", async () => {
    // The fire-and-forget chain's own handlers can throw (an injected logger
    // whose transport is down). Without a terminal catch that surfaces as an
    // unhandled rejection from a chain nobody awaits.
    const throwingDebugLogger: Logger = {
      ...SILENT_LOGGER,
      debug: () => {
        throw new Error("logger transport down");
      },
    };
    const failingFetch = (async (): Promise<Response> => {
      throw new Error("ECONNREFUSED (cold container still booting)");
    }) as typeof fetch;
    const queue = makeFakeQueue();
    const producer = createJobProducer({
      queue,
      enumerate: () => d6Specs(["alpha"]),
      logger: throwingDebugLogger,
      family: "d6",
      warmHealth: { fetchImpl: failingFetch },
    });
    producer.start();
    const result = await producer.tick();
    expect(result.enqueued).toBe(1);
    // Let the fire-and-forget chain settle: an unhandled rejection from the
    // throwing logger fails the test run.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("skips specs with no backendUrl (no bogus warm GET)", async () => {
    const { fetchImpl, calls } = makeFetchSpy();
    const queue = makeFakeQueue();
    const producer = createJobProducer({
      queue,
      enumerate: () => [
        {
          probeKey: "d6:nourl",
          serviceSlug: "nourl",
          driverKind: "e2e_d6",
          // no driverInputs.backendUrl
        },
      ],
      logger: SILENT_LOGGER,
      family: "d6",
      warmHealth: { fetchImpl },
    });
    producer.start();
    await producer.tick();
    expect(calls).toHaveLength(0);
  });

  it("logs a per-spec warm-skipped debug naming the slug and the skip reason (missing vs malformed backendUrl)", async () => {
    // A warm-configured deployment whose enumerator stopped threading
    // backendUrl (or threads a garbage one) silently lost ALL warm coverage
    // — the skips left no trace at any level. Each skip names its spec and
    // why, so the gap is greppable.
    const debugs: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
    const { fetchImpl, calls } = makeFetchSpy();
    const producer = createJobProducer({
      queue: makeFakeQueue(),
      enumerate: () => [
        {
          probeKey: "d6:nourl",
          serviceSlug: "nourl",
          driverKind: "e2e_d6",
          // no driverInputs.backendUrl → "missing"
        },
        {
          probeKey: "d6:badurl",
          serviceSlug: "badurl",
          driverKind: "e2e_d6",
          // unparseable URL → deriveHealthUrl("") → "malformed"
          driverInputs: { backendUrl: "::::not-a-url" },
        },
        ...d6Specs(["alpha"]), // still warmable — no zero-warmable warn
      ],
      logger: {
        ...SILENT_LOGGER,
        debug: (msg, meta) => {
          if (msg === "fleet.producer.warm-skipped")
            debugs.push({ msg, ...(meta !== undefined ? { meta } : {}) });
        },
      },
      family: "d6",
      warmHealth: { fetchImpl },
    });
    producer.start();
    await producer.tick();

    expect(calls).toHaveLength(1); // alpha still warmed
    expect(debugs).toHaveLength(2);
    expect(debugs[0]!.meta).toMatchObject({
      serviceSlug: "nourl",
      reason: "missing-backendUrl",
    });
    expect(debugs[1]!.meta).toMatchObject({
      serviceSlug: "badurl",
      reason: "malformed-backendUrl",
    });
  });

  it("warns ONCE per tick when warmHealth is configured but ZERO of N specs are warmable", async () => {
    // The per-spec skips are debug-level; a tick where NOTHING could be
    // warmed despite warm-up being configured is a wiring regression worth
    // a warn (the #72 cold-start mitigation is silently inert).
    const warns: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
    const { fetchImpl, calls } = makeFetchSpy();
    const producer = createJobProducer({
      queue: makeFakeQueue(),
      enumerate: () => [
        { probeKey: "d6:a", serviceSlug: "a", driverKind: "e2e_d6" },
        { probeKey: "d6:b", serviceSlug: "b", driverKind: "e2e_d6" },
      ],
      logger: {
        ...SILENT_LOGGER,
        warn: (msg, meta) => {
          if (msg === "fleet.producer.warm-none-warmable")
            warns.push({ msg, ...(meta !== undefined ? { meta } : {}) });
        },
      },
      family: "d6",
      warmHealth: { fetchImpl },
    });
    producer.start();
    await producer.tick();

    expect(calls).toHaveLength(0);
    expect(warns).toHaveLength(1);
    expect(warns[0]!.meta).toMatchObject({ services: 2 });
  });

  it("does NOT warn zero-warmable on an empty tick or when at least one spec warms", async () => {
    const warns: string[] = [];
    const logger: Logger = {
      ...SILENT_LOGGER,
      warn: (msg) => {
        warns.push(msg);
      },
    };
    const { fetchImpl } = makeFetchSpy();

    // Empty enumeration: nothing to warm is not a warm-coverage gap.
    const empty = createJobProducer({
      queue: makeFakeQueue(),
      enumerate: () => [],
      logger,
      family: "d6",
      warmHealth: { fetchImpl },
    });
    empty.start();
    await empty.tick();

    // Mixed: one warmable spec means coverage is not zero.
    const mixed = createJobProducer({
      queue: makeFakeQueue(),
      enumerate: () => [
        { probeKey: "d6:nourl", serviceSlug: "nourl", driverKind: "e2e_d6" },
        ...d6Specs(["alpha"]),
      ],
      logger,
      family: "d6",
      warmHealth: { fetchImpl },
    });
    mixed.start();
    await mixed.tick();

    expect(warns).not.toContain("fleet.producer.warm-none-warmable");
  });
});

describe("job-producer — default run-id factory", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("two producers created back-to-back never collide for equal (timestamp, counter)", async () => {
    // Two producers each get an INDEPENDENT default factory with its counter
    // starting at 0 — same-ms ticks with equal counts used to produce the SAME
    // id, and the aggregator groups by meta.runId. Pin the clock so both
    // producers see an identical (ts, counter) pair; the per-factory random
    // discriminator must still keep the ids distinct.
    vi.spyOn(Date, "now").mockReturnValue(1_765_000_000_000);
    // Derandomize with a never-exhausting deterministic sequence (distinct
    // value per call). The previous two-shot mockReturnValueOnce form was
    // fragile: a third Math.random call anywhere in the factory would fall
    // through to the spy's undefined default and silently break the test's
    // premise. The call-count guard below pins the one-draw-per-factory
    // assumption instead.
    let randomCalls = 0;
    const randomSpy = vi.spyOn(Math, "random").mockImplementation(() => {
      randomCalls += 1;
      return randomCalls / 10;
    });
    const make = () => {
      const producer = createJobProducer({
        queue: makeFakeQueue(),
        enumerate: () => d6Specs(["a"]),
        logger: SILENT_LOGGER,
        family: "d6",
        // no runIdFactory → the DEFAULT factory under test
      });
      producer.start();
      return producer;
    };
    const p1 = make();
    const p2 = make();
    // Length guard: the default factory draws its discriminator exactly ONCE
    // per producer — if this count changes, revisit the derandomization.
    expect(randomSpy).toHaveBeenCalledTimes(2);
    const r1 = await p1.tick();
    const r2 = await p2.tick();
    expect(r1.runId).not.toBe(r2.runId);
    // Ids stay sortable-prefixed (timestamp segment leads).
    const ts36 = (1_765_000_000_000).toString(36);
    expect(r1.runId.startsWith(`frun_${ts36}_`)).toBe(true);
    expect(r2.runId.startsWith(`frun_${ts36}_`)).toBe(true);
  });
});

describe("job-producer — tick re-entrancy guard", () => {
  it("skips a tick that arrives while a previous tick is still in flight (gate-TOCTOU double-enqueue)", async () => {
    // A slow tick (sluggish enumerate/PB) overlapping the next cron tick
    // double-enqueued the same family: both ticks read the backlog gate's
    // pending count BEFORE either had enqueued (classic TOCTOU), so both
    // saw "no backlog" and both produced a batch — the exact concurrent
    // same-service overlap the gate exists to prevent.
    let releaseEnumerate!: () => void;
    const gate = new Promise<void>((resolve) => (releaseEnumerate = resolve));
    const warns: string[] = [];
    const logger: Logger = {
      ...SILENT_LOGGER,
      warn: (msg) => {
        warns.push(msg);
      },
    };
    const queue = makeFakeQueue();
    const producer = createJobProducer({
      queue,
      enumerate: async () => {
        await gate;
        return d6Specs(["a"]);
      },
      logger,
      family: "d6",
    });
    producer.start();
    const firstP = producer.tick(); // blocked inside enumerate
    // The overlapping cron tick. Raced against a short timer so a broken
    // guard fails DIAGNOSTICALLY: an un-skipped second tick would await the
    // same enumerate gate and deadlock the test into its global timeout.
    let raceTimer!: ReturnType<typeof setTimeout>;
    const notSkipped = new Promise<never>((_resolve, reject) => {
      raceTimer = setTimeout(
        () =>
          reject(
            new Error(
              "overlapping scheduled tick was not skipped — it ran (and hung on the enumerate gate) instead of returning the skip sentinel",
            ),
          ),
        1_000,
      );
    });
    let second: TickResult;
    try {
      second = await Promise.race([producer.tick(), notSkipped]);
    } finally {
      clearTimeout(raceTimer); // the loser must not fire as an unhandled rejection
    }
    // The overlapping tick is SKIPPED — no second batch, no phantom runId.
    expect(second.enqueued).toBe(0);
    expect(second.runId).toBe("");
    expect(warns).toContain("fleet.producer.tick-overlap-skipped");
    releaseEnumerate();
    const first = await firstP;
    expect(first.enqueued).toBe(1);
    expect(queue.enqueued).toHaveLength(1); // exactly ONE batch was produced
    // The guard releases once the slow tick completes.
    const third = await producer.tick();
    expect(third.enqueued).toBe(1);
    expect(queue.enqueued).toHaveLength(2);
  });

  it("queues an operator-TRIGGERED tick behind the in-flight tick instead of dropping it (operator intent wins)", async () => {
    // The guard's rationale is backpressure on SCHEDULED ticks — but it used
    // to skip TRIGGERED ticks too, silently losing an explicit operator "run
    // it NOW" (the CLI even treats 0 enqueued as a failure) whenever a slow
    // scheduled tick happened to be in flight. A triggered tick that hits the
    // guard must QUEUE BEHIND the in-flight tick and run once it completes.
    let releaseEnumerate!: () => void;
    const gate = new Promise<void>((resolve) => (releaseEnumerate = resolve));
    let enumerateCalls = 0;
    const queue = makeFakeQueue();
    const producer = createJobProducer({
      queue,
      enumerate: async () => {
        enumerateCalls += 1;
        if (enumerateCalls === 1) await gate; // only the FIRST tick is slow
        return d6Specs(["a"]);
      },
      logger: SILENT_LOGGER,
      family: "d6",
    });
    producer.start();
    const firstP = producer.tick(); // scheduled, blocked inside enumerate
    await vi.waitFor(() => expect(enumerateCalls).toBe(1));
    const triggeredP = producer.tick({ triggered: true });
    // The triggered tick is QUEUED, not skipped: it must not resolve while
    // the in-flight tick is still blocked.
    let triggeredResolved = false;
    void triggeredP.then(() => {
      triggeredResolved = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(triggeredResolved).toBe(false);
    releaseEnumerate();
    const first = await firstP;
    const triggered = await triggeredP;
    // BOTH ticks produced — the operator's batch ran after the in-flight one.
    expect(first.enqueued).toBe(1);
    expect(triggered.enqueued).toBe(1);
    expect(triggered.runId).not.toBe("");
    expect(queue.enqueued).toHaveLength(2);
    expect(queue.enqueued[0]!.payload.meta.triggered).toBe(false);
    expect(queue.enqueued[1]!.payload.meta.triggered).toBe(true);
  });

  it("caps the queue-behind at ONE trigger: a second concurrent trigger gets the skip + warn", async () => {
    // Unbounded trigger queuing would let a trigger-happy operator stack an
    // arbitrary backlog of "run NOW" batches behind one slow tick. One queued
    // trigger preserves the intent; a second concurrent one is dropped (the
    // queued trigger already covers "run after the in-flight tick").
    let releaseEnumerate!: () => void;
    const gate = new Promise<void>((resolve) => (releaseEnumerate = resolve));
    let enumerateCalls = 0;
    const warns: string[] = [];
    const logger: Logger = {
      ...SILENT_LOGGER,
      warn: (msg) => {
        warns.push(msg);
      },
    };
    const queue = makeFakeQueue();
    const producer = createJobProducer({
      queue,
      enumerate: async () => {
        enumerateCalls += 1;
        if (enumerateCalls === 1) await gate;
        return d6Specs(["a"]);
      },
      logger,
      family: "d6",
    });
    producer.start();
    const firstP = producer.tick(); // blocked inside enumerate
    await vi.waitFor(() => expect(enumerateCalls).toBe(1));
    const queuedP = producer.tick({ triggered: true }); // queued behind
    const second = await producer.tick({ triggered: true }); // dropped
    expect(second.runId).toBe("");
    expect(second.enqueued).toBe(0);
    expect(warns).toContain("fleet.producer.tick-overlap-skipped");
    releaseEnumerate();
    await firstP;
    const queued = await queuedP;
    expect(queued.enqueued).toBe(1);
    // Exactly TWO batches: the in-flight tick's and the ONE queued trigger's.
    expect(queue.enqueued).toHaveLength(2);
  });
});

describe("job-producer — stop() quiesce", () => {
  /** A JobView for the fake enqueueImpl gates below. */
  function jobView(input: EnqueueJobInput): JobView {
    return {
      id: `job-${input.payload.serviceSlug}`,
      probe_key: input.payload.probeKey,
      status: "pending",
      claimed_by: "",
      lease_expires_at: null,
      version: 1,
    };
  }

  it("stop() awaits an in-flight tick (the tick cannot continue past stop()'s resolution)", async () => {
    // stop() used to flip `running` and resolve immediately — an in-flight
    // tick kept enumerating/sweeping/enqueueing AFTER stop() resolved, so
    // "stopped" was a lie to the shutdown sequence that called it.
    let releaseEnqueue!: () => void;
    const gate = new Promise<void>((resolve) => (releaseEnqueue = resolve));
    const queue = makeFakeQueue({
      enqueueImpl: async (input) => {
        await gate;
        return jobView(input);
      },
    });
    const producer = createJobProducer({
      queue,
      enumerate: () => d6Specs(["a"]),
      logger: SILENT_LOGGER,
      family: "d6",
    });
    producer.start();
    const tickP = producer.tick();
    await vi.waitFor(() => {
      expect(queue.enqueued).toHaveLength(1); // tick reached the gated enqueue
    });
    let stopResolved = false;
    const stopP = producer.stop().then(() => {
      stopResolved = true;
    });
    // Give stop() every chance to (incorrectly) resolve before the tick ends.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stopResolved).toBe(false);
    releaseEnqueue();
    await tickP;
    await stopP;
    expect(stopResolved).toBe(true);
  });

  it("a SECOND concurrent stop() also awaits the in-flight tick (no early-return without quiescing)", async () => {
    // The first stop() flips `running` synchronously, so a second concurrent
    // stop() used to hit the !running early-return and resolve IMMEDIATELY —
    // while the tick the first stop() was quiescing on kept enqueueing. For
    // that second caller, "stopped" was a lie: a shutdown sequence racing two
    // stop() calls could tear down the queue under a still-writing tick.
    let releaseEnqueue!: () => void;
    const gate = new Promise<void>((resolve) => (releaseEnqueue = resolve));
    const queue = makeFakeQueue({
      enqueueImpl: async (input) => {
        await gate;
        return jobView(input);
      },
    });
    const producer = createJobProducer({
      queue,
      enumerate: () => d6Specs(["a"]),
      logger: SILENT_LOGGER,
      family: "d6",
    });
    producer.start();
    const tickP = producer.tick();
    await vi.waitFor(() => {
      expect(queue.enqueued).toHaveLength(1); // tick reached the gated enqueue
    });
    const stop1 = producer.stop(); // flips running=false, quiesces
    let stop2Resolved = false;
    const stop2 = producer.stop().then(() => {
      stop2Resolved = true;
    });
    // Give the second stop() every chance to (incorrectly) resolve early.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stop2Resolved).toBe(false);
    releaseEnqueue();
    await tickP;
    await stop1;
    await stop2;
    expect(stop2Resolved).toBe(true);
  });

  it("a concurrent stop() awaits the QUEUED trigger too (the queued trigger cannot outlive stop())", async () => {
    // A triggered tick queued behind the in-flight one (see the re-entrancy
    // guard) is part of the producer's outstanding work: stop() resolving
    // while the queued trigger is still waiting would let it observe the
    // stopped producer only via its own skipped runTick — fine — but a stop()
    // that doesn't await it at all cannot guarantee even that ordering.
    let releaseEnumerate!: () => void;
    const gate = new Promise<void>((resolve) => (releaseEnumerate = resolve));
    let enumerateCalls = 0;
    const queue = makeFakeQueue();
    const producer = createJobProducer({
      queue,
      enumerate: async () => {
        enumerateCalls += 1;
        if (enumerateCalls === 1) await gate;
        return d6Specs(["a"]);
      },
      logger: SILENT_LOGGER,
      family: "d6",
    });
    producer.start();
    const firstP = producer.tick(); // blocked inside enumerate
    await vi.waitFor(() => expect(enumerateCalls).toBe(1));
    const queuedP = producer.tick({ triggered: true }); // queued behind
    let queuedResolved = false;
    void queuedP.then(() => {
      queuedResolved = true;
    });
    const stopP = producer.stop();
    releaseEnumerate();
    await firstP;
    await stopP;
    // stop() resolved only AFTER the queued trigger fully unwound.
    expect(queuedResolved).toBe(true);
    const queued = await queuedP;
    // The queued trigger observed the stop and produced nothing — and the
    // first tick, released after stop flipped `running`, truncated before
    // its first enqueue.
    expect(queued.enqueued).toBe(0);
    expect(queue.enqueued).toHaveLength(0);
  });

  it("a queued trigger that executes AFTER stop logs its own debug event, not the misleading tick-while-stopped warn", async () => {
    // Ordering: a trigger queues behind an in-flight tick, stop() flips
    // `running` while it waits, then the queued trigger's turn arrives. That
    // is a NORMAL quiesce ordering the producer itself orchestrated — logging
    // the defensive "tick-while-stopped" WARN for it pointed operators at a
    // scheduler-wiring bug that doesn't exist. It gets a distinct debug event.
    const warns: string[] = [];
    const debugs: string[] = [];
    let releaseEnumerate!: () => void;
    const gate = new Promise<void>((resolve) => (releaseEnumerate = resolve));
    let enumerateCalls = 0;
    const queue = makeFakeQueue();
    const producer = createJobProducer({
      queue,
      enumerate: async () => {
        enumerateCalls += 1;
        if (enumerateCalls === 1) await gate;
        return d6Specs(["a"]);
      },
      logger: {
        ...SILENT_LOGGER,
        warn: (msg) => warns.push(msg),
        debug: (msg) => debugs.push(msg),
      },
      family: "d6",
    });
    producer.start();
    const firstP = producer.tick(); // blocked inside enumerate
    await vi.waitFor(() => expect(enumerateCalls).toBe(1));
    const queuedP = producer.tick({ triggered: true }); // queued behind
    const stopP = producer.stop();
    releaseEnumerate();
    await firstP;
    await stopP;
    const queued = await queuedP;

    expect(queued.enqueued).toBe(0);
    expect(queued.runId).toBe("");
    expect(debugs).toContain("fleet.producer.queued-trigger-after-stop");
    expect(warns).not.toContain("fleet.producer.tick-while-stopped");
  });

  it("a tick stopped mid-batch truncates the remaining enqueues (and logs the truncation)", async () => {
    let releaseEnqueue!: () => void;
    const gate = new Promise<void>((resolve) => (releaseEnqueue = resolve));
    const warns: string[] = [];
    const logger: Logger = {
      ...SILENT_LOGGER,
      warn: (msg) => {
        warns.push(msg);
      },
    };
    const queue = makeFakeQueue({
      enqueueImpl: async (input) => {
        if (input.payload.serviceSlug === "a") await gate;
        return jobView(input);
      },
    });
    const producer = createJobProducer({
      queue,
      enumerate: () => d6Specs(["a", "b", "c"]),
      logger,
      family: "d6",
    });
    producer.start();
    const tickP = producer.tick();
    await vi.waitFor(() => {
      expect(queue.enqueued).toHaveLength(1);
    });
    const stopP = producer.stop(); // flips running=false, then quiesces
    releaseEnqueue();
    const result = await tickP;
    await stopP;
    // "a" completed; "b" and "c" were truncated, not enqueued post-stop.
    expect(result.enqueued).toBe(1);
    expect(queue.enqueued).toHaveLength(1);
    expect(warns).toContain("fleet.producer.enqueue-truncated-stopped");
  });

  it("stop-truncated specs are ACCOUNTED in TickResult.truncatedByStop (and tick-complete's services line up)", async () => {
    // Truncated specs used to VANISH from the tick outcome: services said 3,
    // but enqueued + enqueueFailures + skippedForBacklog only summed to 1 —
    // the two truncated jobs were uncounted in both the TickResult and the
    // tick-complete log, so a stop-truncated run was indistinguishable from
    // a partially-failed one whose failures went unreported.
    let releaseEnqueue!: () => void;
    const gate = new Promise<void>((resolve) => (releaseEnqueue = resolve));
    const infos: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
    const logger: Logger = {
      ...SILENT_LOGGER,
      info: (msg, meta) => {
        infos.push({ msg, ...(meta !== undefined ? { meta } : {}) });
      },
    };
    const queue = makeFakeQueue({
      enqueueImpl: async (input) => {
        if (input.payload.serviceSlug === "a") await gate;
        return jobView(input);
      },
    });
    const producer = createJobProducer({
      queue,
      enumerate: () => d6Specs(["a", "b", "c"]),
      logger,
      family: "d6",
    });
    producer.start();
    const tickP = producer.tick();
    await vi.waitFor(() => {
      expect(queue.enqueued).toHaveLength(1);
    });
    const stopP = producer.stop();
    releaseEnqueue();
    const result = await tickP;
    await stopP;
    // "b" and "c" were truncated by the stop — and COUNTED.
    expect(result.truncatedByStop).toBe(2);
    expect(result.enqueued).toBe(1);
    // The tick outcome partitions the enumerated services exactly.
    const complete = infos.find(
      (e) => e.msg === "fleet.producer.tick-complete",
    );
    expect(complete).toBeDefined();
    const meta = complete!.meta as {
      services: number;
      enqueued: number;
      enqueueFailures: number;
      skippedForBacklog: number;
      truncatedByStop: number;
    };
    expect(meta.truncatedByStop).toBe(2);
    expect(meta.services).toBe(
      meta.enqueued +
        meta.enqueueFailures +
        meta.skippedForBacklog +
        meta.truncatedByStop,
    );
  });

  it("a tick that runs to completion reports truncatedByStop:0", async () => {
    const { producer } = startedProducer({ specs: d6Specs(["a", "b"]) });
    const result = await producer.tick();
    expect(result.truncatedByStop).toBe(0);
    expect(result.enqueued).toBe(2);
  });

  it("stop() makes one final delivery attempt of buffered sweep comm errors", async () => {
    // Buffered comm errors used to be silently DROPPED at shutdown — the
    // reclaimed jobs' dashboard signal vanished with the process.
    const queue = makeFakeQueue({
      sweepImpl: async () => ({
        reclaimed: 1,
        commErrors: [
          {
            kind: "worker-reclaimed-pending",
            message: "lease for job j1 expired; re-queued",
            jobId: "j1",
            observedAt: "2026-06-04T00:00:09.000Z",
          },
        ],
      }),
    });
    const received: PoolCommError[][] = [];
    let sinkCalls = 0;
    const producer = createJobProducer({
      queue,
      enumerate: () => d6Specs(["a"]),
      logger: SILENT_LOGGER,
      family: "d6",
      onSweepCommErrors: (errs) => {
        sinkCalls += 1;
        if (sinkCalls === 1) throw new Error("aggregator down");
        received.push(errs);
      },
    });
    producer.start();
    await producer.tick(); // sink fails — j1 buffered
    await producer.stop(); // final drain: sink healthy again
    expect(received).toHaveLength(1);
    expect(received[0]!.map((e) => e.jobId)).toEqual(["j1"]);
  });

  it("stop() logs the dropped count + jobIds at error level when the final delivery also fails", async () => {
    const errorLogs: Array<{ msg: string; meta?: Record<string, unknown> }> =
      [];
    const logger: Logger = {
      ...SILENT_LOGGER,
      error: (msg, meta) => {
        errorLogs.push({ msg, ...(meta !== undefined ? { meta } : {}) });
      },
    };
    const queue = makeFakeQueue({
      sweepImpl: async () => ({
        reclaimed: 1,
        commErrors: [
          {
            kind: "worker-reclaimed-pending",
            message: "lease for job j1 expired; re-queued",
            jobId: "j1",
            observedAt: "2026-06-04T00:00:09.000Z",
          },
        ],
      }),
    });
    const producer = createJobProducer({
      queue,
      enumerate: () => d6Specs(["a"]),
      logger,
      family: "d6",
      onSweepCommErrors: () => {
        throw new Error("aggregator down for good");
      },
    });
    producer.start();
    await producer.tick(); // sink fails — j1 buffered
    await producer.stop(); // final drain fails too — dropped, loudly
    const dropLog = errorLogs.find(
      (e) => e.msg === "fleet.producer.stop-commerrors-dropped",
    );
    expect(dropLog).toBeDefined();
    expect(dropLog!.meta).toMatchObject({ dropped: 1, jobIds: ["j1"] });
  });

  it("a SECOND concurrent stop() does not resolve before the FIRST stop's final comm-error drain completes", async () => {
    // The secondary stop() path used to await only the in-flight tick /
    // queued trigger — with neither in flight it returned IMMEDIATELY, while
    // the primary stop() was still mid final-drain (awaiting the sink). A
    // shutdown sequenced on the second stop() could then tear the aggregator
    // down under the still-delivering drain. EVERY stop() resolution must
    // imply the drain finished — both paths share one stop completion.
    const queue = makeFakeQueue({
      sweepImpl: async () => ({
        reclaimed: 1,
        commErrors: [
          {
            kind: "worker-reclaimed-pending",
            message: "lease for job j1 expired; re-queued",
            jobId: "j1",
            observedAt: "2026-06-04T00:00:09.000Z",
          },
        ],
      }),
    });
    let releaseDrain!: () => void;
    const drainGate = new Promise<void>((resolve) => {
      releaseDrain = resolve;
    });
    let sinkCalls = 0;
    const producer = createJobProducer({
      queue,
      enumerate: () => d6Specs(["a"]),
      logger: SILENT_LOGGER,
      family: "d6",
      onSweepCommErrors: async () => {
        sinkCalls += 1;
        if (sinkCalls === 1) throw new Error("aggregator down"); // buffer j1
        await drainGate; // the stop()-drain delivery hangs until released
      },
    });
    producer.start();
    await producer.tick(); // sink fails — j1 buffered

    const first = producer.stop(); // primary: quiesce + (gated) final drain
    const second = producer.stop(); // concurrent secondary
    let firstResolved = false;
    let secondResolved = false;
    void first.then(() => {
      firstResolved = true;
    });
    void second.then(() => {
      secondResolved = true;
    });

    // Let microtasks settle: the drain is gated, so NEITHER stop may resolve.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sinkCalls).toBe(2); // the drain delivery is in flight
    expect(firstResolved).toBe(false);
    expect(secondResolved).toBe(false);

    releaseDrain();
    await Promise.all([first, second]);
    expect(firstResolved).toBe(true);
    expect(secondResolved).toBe(true);
  });
});

describe("job-producer — lifecycle seams (start/stop/tick)", () => {
  it("isRunning reflects start()/stop()", async () => {
    const queue = makeFakeQueue();
    const producer = createJobProducer({
      queue,
      enumerate: () => [],
      logger: SILENT_LOGGER,
      family: "d6",
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
      family: "d6",
    });
    const result = await producer.tick();
    expect(result.enqueued).toBe(0);
    expect(queue.enqueued).toHaveLength(0);
  });

  it("a stopped tick does not mint a runId (no counter burn, no phantom runIds in logs)", async () => {
    // The runId used to be minted BEFORE the running check — every tick that
    // arrived outside the lifecycle burned the factory counter and logged a
    // phantom runId no job would ever carry.
    const runIdFactory = vi.fn(() => "run-phantom");
    const queue = makeFakeQueue();
    const producer = createJobProducer({
      queue,
      enumerate: () => d6Specs(["a"]),
      logger: SILENT_LOGGER,
      family: "d6",
      runIdFactory,
    });
    // Never started.
    const result = await producer.tick();
    expect(result.runId).toBe("");
    expect(runIdFactory).not.toHaveBeenCalled();
  });

  it("a tick after stop() enqueues nothing (no jobs leak past lifecycle)", async () => {
    const { producer, queue } = startedProducer({ specs: d6Specs(["a"]) });
    await producer.stop();
    const result = await producer.tick();
    expect(result.enqueued).toBe(0);
    expect(queue.enqueued).toHaveLength(0);
  });

  it("stop() BEFORE start() is a no-op: the producer can still start afterwards (no permanent brick)", async () => {
    // The old !running early path latched `stopped` UNCONDITIONALLY, so a
    // stop() that raced ahead of start() (e.g. a teardown registered before
    // boot finished wiring) permanently bricked the producer: every later
    // start() hit the start-after-stop latch. Stop-before-start must be a
    // no-op (debug-logged), not a one-way latch.
    const debugEvents: string[] = [];
    const queue = makeFakeQueue();
    const producer = createJobProducer({
      queue,
      enumerate: () => d6Specs(["a"]),
      logger: {
        ...SILENT_LOGGER,
        debug: (msg) => debugEvents.push(msg),
      },
      family: "d6",
    });

    await producer.stop(); // never started — must NOT latch `stopped`
    expect(debugEvents).toContain("fleet.producer.stop-before-start");

    producer.start();
    expect(producer.isRunning()).toBe(true);
    const result = await producer.tick();
    expect(result.enqueued).toBe(1);

    await producer.stop();
    expect(producer.isRunning()).toBe(false);
  });

  it("the tick-while-stopped warn discriminates never-started from stopped-after-running", async () => {
    // The warn meta carried only `triggered` — an operator chasing a
    // scheduler-wiring bug could not tell whether the stray tick fired
    // BEFORE boot wiring started the producer or AFTER a shutdown stopped
    // it; the two point at opposite ends of the lifecycle.
    const warnMeta = (): {
      producer: JobProducer;
      metas: Array<Record<string, unknown> | undefined>;
    } => {
      const metas: Array<Record<string, unknown> | undefined> = [];
      const producer = createJobProducer({
        queue: makeFakeQueue(),
        enumerate: () => d6Specs(["a"]),
        logger: {
          ...SILENT_LOGGER,
          warn: (msg, meta) => {
            if (msg === "fleet.producer.tick-while-stopped") metas.push(meta);
          },
        },
        family: "d6",
      });
      return { producer, metas };
    };

    // Never started.
    const before = warnMeta();
    await before.producer.tick();
    expect(before.metas).toHaveLength(1);
    expect(before.metas[0]).toMatchObject({
      triggered: false,
      started: false,
      stopped: false,
    });

    // Stopped after running.
    const after = warnMeta();
    after.producer.start();
    await after.producer.stop();
    await after.producer.tick();
    expect(after.metas).toHaveLength(1);
    expect(after.metas[0]).toMatchObject({
      triggered: false,
      started: true,
      stopped: true,
    });
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
      family: "d6",
    });
    producer.start();
    await producer.tick();
    expect(claimSpy).not.toHaveBeenCalled();
    expect(renewSpy).not.toHaveBeenCalled();
    expect(reportSpy).not.toHaveBeenCalled();
  });
});

describe("job-producer — throwing-logger hardening", () => {
  // The documented invariant at `inFlightTick` — "a tick promise never
  // rejects" — must hold even when the injected logger's TRANSPORT throws:
  // the warm chain already hardens for this failure mode (its terminal
  // .catch), but an unguarded logger.* call in the tick body rejected the
  // tick promise, and one inside stop()'s completion permanently POISONED
  // stopPromise (re-thrown to every later stop() caller). Logging is
  // observability, never a correctness gate.

  /** Every method throws — models a logger whose transport is down. */
  function makeThrowingLogger(): Logger {
    const boom = () => {
      throw new Error("logger transport down");
    };
    return { info: boom, warn: boom, error: boom, debug: boom };
  }

  it("a throwing logger never rejects the tick promise (happy path)", async () => {
    const queue = makeFakeQueue();
    const producer = createJobProducer({
      queue,
      enumerate: () => d6Specs(["alpha"]),
      logger: makeThrowingLogger(),
      family: "d6",
    });
    producer.start();
    const result = await producer.tick(); // must resolve, not reject
    expect(result.enqueued).toBe(1);
    expect(queue.enqueued).toHaveLength(1);
  });

  it("a throwing logger never rejects the tick promise on the enumerate-failed path", async () => {
    const producer = createJobProducer({
      queue: makeFakeQueue(),
      enumerate: () => {
        throw new Error("discovery down");
      },
      logger: makeThrowingLogger(),
      family: "d6",
    });
    producer.start();
    const result = await producer.tick(); // logger.error in the catch throws
    expect(result.enumerateFailed).toBe(true);
    expect(result.enqueued).toBe(0);
  });

  it("a throwing logger never rejects the tick promise on the enqueue-failed path", async () => {
    const queue = makeFakeQueue({
      enqueueImpl: async () => {
        throw new Error("PB down");
      },
    });
    const producer = createJobProducer({
      queue,
      enumerate: () => d6Specs(["alpha"]),
      logger: makeThrowingLogger(),
      family: "d6",
    });
    producer.start();
    const result = await producer.tick();
    expect(result.enqueueFailures).toBe(1);
  });

  it("a throwing logger never rejects a tick that arrives outside the lifecycle", async () => {
    const producer = createJobProducer({
      queue: makeFakeQueue(),
      enumerate: () => d6Specs(["alpha"]),
      logger: makeThrowingLogger(),
      family: "d6",
    });
    // Never started — the tick-while-stopped warn throws.
    const result = await producer.tick();
    expect(result.runId).toBe("");
  });

  it("a throwing logger in stop() does not poison stopPromise (every stop() caller resolves)", async () => {
    const producer = createJobProducer({
      queue: makeFakeQueue(),
      enumerate: () => d6Specs(["alpha"]),
      logger: makeThrowingLogger(),
      family: "d6",
    });
    producer.start();
    await producer.tick();
    // The primary stop()'s trailing logger.info throws inside the shared
    // completion — without hardening that rejects stopPromise FOREVER.
    await expect(producer.stop()).resolves.toBeUndefined();
    // A later stop() shares stopPromise: it must not re-throw.
    await expect(producer.stop()).resolves.toBeUndefined();
  });

  it("a throwing logger in the final-drain catch does not poison stopPromise", async () => {
    // Buffered comm errors whose final-drain delivery ALSO fails route
    // through the dropped-loudly logger.error — a throw there must not
    // reject stop().
    const queue = makeFakeQueue({
      sweepImpl: async () => ({
        reclaimed: 1,
        commErrors: [
          {
            kind: "worker-reclaimed-pending",
            message: "lease for job j1 expired; re-queued",
            jobId: "j1",
            observedAt: "2026-06-04T00:00:09.000Z",
          },
        ],
      }),
    });
    const producer = createJobProducer({
      queue,
      enumerate: () => d6Specs(["alpha"]),
      logger: makeThrowingLogger(),
      family: "d6",
      onSweepCommErrors: () => {
        throw new Error("aggregator down for good");
      },
    });
    producer.start();
    await producer.tick(); // sink fails — j1 buffered
    await expect(producer.stop()).resolves.toBeUndefined();
    await expect(producer.stop()).resolves.toBeUndefined();
  });
});
