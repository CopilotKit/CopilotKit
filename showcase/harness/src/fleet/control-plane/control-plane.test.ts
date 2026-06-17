import { describe, it, expect, vi } from "vitest";
import {
  createControlPlane,
  buildJobProducer,
  FLEET_PRODUCER_SCHEDULE_ID,
  FLEET_PRODUCER_SMOKE_SCHEDULE_ID,
  FLEET_PRODUCER_DEMOS_SCHEDULE_ID,
  FLEET_PRODUCER_DEEP_SCHEDULE_ID,
  DEFAULT_PRODUCER_CRON,
} from "./control-plane.js";
import type { JobProducer, TickResult } from "./job-producer.js";
import type { ResultConsumer, ConsumeResult } from "./result-consumer.js";
import type {
  ResultAggregator,
  CommErrorAggregateInput,
} from "./result-aggregator.js";
import type { FleetHealthMonitor, FleetHealthResult } from "./fleet-health.js";
import type { Scheduler, ScheduleEntry } from "../../scheduler/scheduler.js";
import type { Logger } from "../../types/index.js";
import type {
  EnqueueJobInput,
  FleetQueueClient,
  JobView,
  PoolCommError,
} from "../contracts.js";

/**
 * Pins the control-plane ASSEMBLY: start() registers the producer's tick as the
 * scheduler handler AND starts a consumer poll loop; the consumer's
 * `consumeOnce` runs on the interval; stop() tears both down. All collaborators
 * are injected fakes — no PocketBase, no scheduler internals, no real timers.
 */

const SILENT_LOGGER: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function makeFakeProducer(): JobProducer & {
  started: boolean;
  stopped: boolean;
  ticks: number;
} {
  const state = { started: false, stopped: false, ticks: 0 };
  return {
    ...state,
    start() {
      (this as { started: boolean }).started = true;
    },
    async stop() {
      (this as { stopped: boolean }).stopped = true;
    },
    async tick(): Promise<TickResult> {
      (this as { ticks: number }).ticks += 1;
      return {
        runId: "r",
        enqueued: 0,
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
    isRunning() {
      return (
        (this as { started: boolean; stopped: boolean }).started &&
        !(this as { stopped: boolean }).stopped
      );
    },
  } as JobProducer & { started: boolean; stopped: boolean; ticks: number };
}

function makeFakeConsumer(
  impl?: () => Promise<ConsumeResult>,
): ResultConsumer & { calls: number } {
  const wrapper = {
    calls: 0,
    async consumeOnce(): Promise<ConsumeResult> {
      wrapper.calls += 1;
      if (impl) return impl();
      return { processed: 0, failures: 0 };
    },
  };
  return wrapper;
}

function makeFakeAggregator(): ResultAggregator & {
  commErrorCalls: CommErrorAggregateInput[];
} {
  const commErrorCalls: CommErrorAggregateInput[] = [];
  return {
    commErrorCalls,
    async aggregate() {
      throw new Error("fake-aggregator: aggregate not used by these tests");
    },
    async aggregateCommError(input) {
      commErrorCalls.push(input);
      return { statusOutcomes: [], overlayOutcomes: [] };
    },
  };
}

function makeFakeFleetHealth(
  result: FleetHealthResult,
): FleetHealthMonitor & { calls: number } {
  const wrapper = {
    calls: 0,
    async checkOnce(): Promise<FleetHealthResult> {
      wrapper.calls += 1;
      return result;
    },
  };
  return wrapper;
}

function emptyHealthResult(
  over: Partial<FleetHealthResult> = {},
): FleetHealthResult {
  return {
    online: 0,
    unhealthy: 0,
    reclaimed: 0,
    commErrors: [],
    reclaimedOverlays: [],
    restartsAttempted: 0,
    gcDeleted: 0,
    ...over,
  };
}

function makeFakeScheduler(): Scheduler & {
  entries: Map<string, ScheduleEntry>;
} {
  const entries = new Map<string, ScheduleEntry>();
  const unsupported = (n: string) => () => {
    throw new Error(`fake-scheduler: ${n} not implemented`);
  };
  const fake = {
    entries,
    register(entry: ScheduleEntry) {
      entries.set(entry.id, entry);
    },
    async unregister(id: string): Promise<boolean> {
      return entries.delete(id);
    },
    hasEntry(id: string) {
      return entries.has(id);
    },
    list() {
      return [...entries.values()];
    },
    start() {},
    async stop() {},
    isStarted: () => true,
    isStopped: () => false,
    getJobCount: () => entries.size,
    getEntry: unsupported("getEntry"),
    setEntryTracker: unsupported("setEntryTracker"),
    seedEntryLastRun: unsupported("seedEntryLastRun"),
    trigger: unsupported("trigger"),
    nextRun: unsupported("nextRun"),
  };
  return fake as unknown as Scheduler & {
    entries: Map<string, ScheduleEntry>;
  };
}

/**
 * A controllable fake setInterval/clearInterval pair. PER-HANDLE like the
 * real timers: the control-plane registers up to TWO intervals (consumer
 * poll + fleet-health), and the old single-callback-slot fake let the
 * second registration silently overwrite the first — any test "driving" the
 * consumer loop with fleet-health injected was vacuous, and a leaked
 * (never-cleared) interval was invisible to the `cleared` flag.
 */
class FakeTimers {
  private handles = new Map<number, () => void>();
  private nextHandle = 1;
  /** Total intervals ever registered (cleared or not). */
  registered = 0;
  setIntervalImpl = ((fn: () => void) => {
    const handle = this.nextHandle++;
    this.registered += 1;
    this.handles.set(handle, fn);
    return handle as unknown as ReturnType<typeof setInterval>;
  }) as unknown as typeof setInterval;
  clearIntervalImpl = ((handle: unknown) => {
    this.handles.delete(handle as number);
  }) as unknown as typeof clearInterval;
  /** True when at least one interval was registered and ALL were cleared. */
  get cleared(): boolean {
    return this.registered > 0 && this.handles.size === 0;
  }
  /** Fire every ACTIVE (uncleared) interval callback once. */
  async fire(): Promise<void> {
    for (const cb of [...this.handles.values()]) cb();
    // Let the void-returned async cycle settle.
    await Promise.resolve();
    await Promise.resolve();
  }
}

function makeFakeTimers(): FakeTimers {
  return new FakeTimers();
}

describe("createControlPlane.start", () => {
  it("starts the producer and registers its tick as the scheduler handler", () => {
    const producer = makeFakeProducer();
    const consumer = makeFakeConsumer();
    const scheduler = makeFakeScheduler();
    const timers = makeFakeTimers();

    const cp = createControlPlane({
      producer,
      consumer,
      scheduler,
      logger: SILENT_LOGGER,
      setIntervalImpl: timers.setIntervalImpl,
      clearIntervalImpl: timers.clearIntervalImpl,
    });
    cp.start();

    expect(producer.started).toBe(true);
    const entry = scheduler.entries.get(FLEET_PRODUCER_SCHEDULE_ID);
    expect(entry).toBeDefined();
    expect(entry?.cron).toBe(DEFAULT_PRODUCER_CRON);
  });

  it("the registered scheduler handler drives the producer tick", async () => {
    const producer = makeFakeProducer();
    const scheduler = makeFakeScheduler();
    const cp = createControlPlane({
      producer,
      consumer: makeFakeConsumer(),
      scheduler,
      logger: SILENT_LOGGER,
      setIntervalImpl: makeFakeTimers().setIntervalImpl,
    });
    cp.start();

    const entry = scheduler.entries.get(FLEET_PRODUCER_SCHEDULE_ID);
    await entry?.handler();
    expect(producer.ticks).toBe(1);
  });

  it("runs the consumer on the interval tick", async () => {
    const consumer = makeFakeConsumer();
    const timers = makeFakeTimers();
    const cp = createControlPlane({
      producer: makeFakeProducer(),
      consumer,
      scheduler: makeFakeScheduler(),
      logger: SILENT_LOGGER,
      setIntervalImpl: timers.setIntervalImpl,
      clearIntervalImpl: timers.clearIntervalImpl,
    });
    cp.start();

    expect(consumer.calls).toBe(0);
    await timers.fire();
    expect(consumer.calls).toBe(1);
  });

  it("is idempotent — a second start() does not double-register", () => {
    const scheduler = makeFakeScheduler();
    const registerSpy = vi.spyOn(scheduler, "register");
    const cp = createControlPlane({
      producer: makeFakeProducer(),
      consumer: makeFakeConsumer(),
      scheduler,
      logger: SILENT_LOGGER,
      setIntervalImpl: makeFakeTimers().setIntervalImpl,
    });
    cp.start();
    cp.start();
    expect(registerSpy).toHaveBeenCalledTimes(1);
  });
});

describe("createControlPlane — multiple producer schedules", () => {
  it("registers one scheduler entry per schedule with its own cron + producer", async () => {
    const producerA = makeFakeProducer();
    const producerB = makeFakeProducer();
    const scheduler = makeFakeScheduler();
    const cp = createControlPlane({
      producer: producerA,
      consumer: makeFakeConsumer(),
      scheduler,
      logger: SILENT_LOGGER,
      schedules: [
        {
          scheduleId: "fleet-d6-producer",
          cron: "40 * * * *",
          producer: producerA,
        },
        {
          scheduleId: "fleet-smoke-producer",
          cron: "*/15 * * * *",
          producer: producerB,
        },
      ],
      setIntervalImpl: makeFakeTimers().setIntervalImpl,
    });
    cp.start();

    expect(scheduler.entries.size).toBe(2);
    const a = scheduler.entries.get("fleet-d6-producer");
    const b = scheduler.entries.get("fleet-smoke-producer");
    expect(a?.cron).toBe("40 * * * *");
    expect(b?.cron).toBe("*/15 * * * *");

    // Each handler drives ITS producer's tick.
    await a?.handler();
    expect(producerA.ticks).toBe(1);
    expect(producerB.ticks).toBe(0);
    await b?.handler();
    expect(producerB.ticks).toBe(1);

    // Both producers were started.
    expect(producerA.started).toBe(true);
    expect(producerB.started).toBe(true);
  });

  it("stop() unregisters every schedule and stops every producer", async () => {
    const producerA = makeFakeProducer();
    const producerB = makeFakeProducer();
    const scheduler = makeFakeScheduler();
    const cp = createControlPlane({
      producer: producerA,
      consumer: makeFakeConsumer(),
      scheduler,
      logger: SILENT_LOGGER,
      schedules: [
        {
          scheduleId: "fleet-d6-producer",
          cron: "40 * * * *",
          producer: producerA,
        },
        {
          scheduleId: "fleet-smoke-producer",
          cron: "*/15 * * * *",
          producer: producerB,
        },
      ],
      setIntervalImpl: makeFakeTimers().setIntervalImpl,
    });
    cp.start();
    await cp.stop();

    expect(scheduler.entries.has("fleet-d6-producer")).toBe(false);
    expect(scheduler.entries.has("fleet-smoke-producer")).toBe(false);
    expect(producerA.stopped).toBe(true);
    expect(producerB.stopped).toBe(true);
  });
});

// ── Multi-schedule seam hardening (best-effort / fail-loud bar) ─────────────
describe("createControlPlane — multi-schedule hardening", () => {
  // A1: one producer's stop() (or unregister) rejecting must NOT abort teardown
  // of later schedules — best-effort teardown completes all entries.
  it("stop() still tears down later schedules when an earlier unregister rejects", async () => {
    const producerA = makeFakeProducer();
    const producerB = makeFakeProducer();
    const scheduler = makeFakeScheduler();
    // Make the FIRST schedule's unregister reject.
    const realUnregister = scheduler.unregister.bind(scheduler);
    scheduler.unregister = (async (id: string) => {
      if (id === "fleet-d6-producer") throw new Error("unregister boom");
      return realUnregister(id);
    }) as typeof scheduler.unregister;

    const cp = createControlPlane({
      producer: producerA,
      consumer: makeFakeConsumer(),
      scheduler,
      logger: SILENT_LOGGER,
      schedules: [
        {
          scheduleId: "fleet-d6-producer",
          cron: "40 * * * *",
          producer: producerA,
        },
        {
          scheduleId: "fleet-smoke-producer",
          cron: "*/15 * * * *",
          producer: producerB,
        },
      ],
      setIntervalImpl: makeFakeTimers().setIntervalImpl,
    });
    cp.start();
    await cp.stop();

    // The second schedule is still unregistered AND its producer still stopped,
    // and the first producer's stop() still ran despite its unregister rejecting.
    expect(scheduler.entries.has("fleet-smoke-producer")).toBe(false);
    expect(producerB.stopped).toBe(true);
    expect(producerA.stopped).toBe(true);
  });

  it("stop() still stops later producers when an earlier producer.stop() rejects", async () => {
    const producerA = makeFakeProducer();
    const producerB = makeFakeProducer();
    // Make the FIRST producer's stop() reject.
    producerA.stop = async () => {
      throw new Error("producer stop boom");
    };
    const scheduler = makeFakeScheduler();
    const cp = createControlPlane({
      producer: producerA,
      consumer: makeFakeConsumer(),
      scheduler,
      logger: SILENT_LOGGER,
      schedules: [
        {
          scheduleId: "fleet-d6-producer",
          cron: "40 * * * *",
          producer: producerA,
        },
        {
          scheduleId: "fleet-smoke-producer",
          cron: "*/15 * * * *",
          producer: producerB,
        },
      ],
      setIntervalImpl: makeFakeTimers().setIntervalImpl,
    });
    cp.start();
    await cp.stop();

    expect(scheduler.entries.has("fleet-smoke-producer")).toBe(false);
    expect(producerB.stopped).toBe(true);
  });

  // A2: an invalid cron must fail BEFORE any producer is started, and must not
  // leave `started` latched true (a retry must be able to start cleanly).
  it("start() throws on an invalid cron BEFORE starting any producer", () => {
    const producerA = makeFakeProducer();
    const producerB = makeFakeProducer();
    const scheduler = makeFakeScheduler();
    const cp = createControlPlane({
      producer: producerA,
      consumer: makeFakeConsumer(),
      scheduler,
      logger: SILENT_LOGGER,
      schedules: [
        { scheduleId: "fleet-ok", cron: "40 * * * *", producer: producerA },
        { scheduleId: "fleet-bad", cron: "not a cron", producer: producerB },
      ],
      setIntervalImpl: makeFakeTimers().setIntervalImpl,
    });

    expect(() => cp.start()).toThrow(/fleet-bad/);
    // No producer was started — validation happens up-front.
    expect(producerA.started).toBe(false);
    expect(producerB.started).toBe(false);
    // Nothing registered.
    expect(scheduler.entries.size).toBe(0);

    // `started` is not latched true on the FAILED instance: a retry on the
    // SAME control-plane re-validates and throws again (a latched-true latch
    // would make the second start() a silent no-op).
    expect(() => cp.start()).toThrow(/fleet-bad/);
    expect(producerA.started).toBe(false);
    expect(producerB.started).toBe(false);
    expect(scheduler.entries.size).toBe(0);

    // `started` is not latched true: a subsequent start() with valid crons works.
    const cpOk = createControlPlane({
      producer: producerA,
      consumer: makeFakeConsumer(),
      scheduler: makeFakeScheduler(),
      logger: SILENT_LOGGER,
      schedules: [
        { scheduleId: "fleet-ok", cron: "40 * * * *", producer: producerA },
      ],
      setIntervalImpl: makeFakeTimers().setIntervalImpl,
    });
    expect(() => cpOk.start()).not.toThrow();
    expect(producerA.started).toBe(true);
  });

  // A3: duplicate scheduleId must throw loudly (replace-semantics would silently
  // collapse two producers onto one scheduler entry).
  it("throws on a duplicate scheduleId", () => {
    const producerA = makeFakeProducer();
    const producerB = makeFakeProducer();
    expect(() =>
      createControlPlane({
        producer: producerA,
        consumer: makeFakeConsumer(),
        scheduler: makeFakeScheduler(),
        logger: SILENT_LOGGER,
        schedules: [
          { scheduleId: "dup", cron: "40 * * * *", producer: producerA },
          { scheduleId: "dup", cron: "*/15 * * * *", producer: producerB },
        ],
        setIntervalImpl: makeFakeTimers().setIntervalImpl,
      }),
    ).toThrow(/dup/);
  });

  // A4: distinguish undefined (→ d6 default) from an explicit [] (caller error).
  it("throws when schedules is an explicit empty array", () => {
    expect(() =>
      createControlPlane({
        producer: makeFakeProducer(),
        consumer: makeFakeConsumer(),
        scheduler: makeFakeScheduler(),
        logger: SILENT_LOGGER,
        schedules: [],
        setIntervalImpl: makeFakeTimers().setIntervalImpl,
      }),
    ).toThrow(/empty/i);
  });

  it("omitting schedules still yields the single d6 schedule (unchanged)", () => {
    const producer = makeFakeProducer();
    const scheduler = makeFakeScheduler();
    const cp = createControlPlane({
      producer,
      consumer: makeFakeConsumer(),
      scheduler,
      logger: SILENT_LOGGER,
      setIntervalImpl: makeFakeTimers().setIntervalImpl,
    });
    cp.start();
    expect(scheduler.entries.size).toBe(1);
    expect(scheduler.entries.has(FLEET_PRODUCER_SCHEDULE_ID)).toBe(true);
  });
});

// ── §5.1 constant homing + §4.2 family threading through the wrapper ────────
describe("control-plane — e2e producer schedule-id constants", () => {
  it("exports FLEET_PRODUCER_SMOKE/DEMOS/DEEP_SCHEDULE_ID with the producer schedule id values", () => {
    // These values MUST equal the scheduler entry ids the orchestrator wires
    // (orchestrator.ts re-imports them from here after the T8 constant move).
    expect(FLEET_PRODUCER_SMOKE_SCHEDULE_ID).toBe("fleet-producer-e2e-smoke");
    expect(FLEET_PRODUCER_DEMOS_SCHEDULE_ID).toBe("fleet-producer-e2e-demos");
    expect(FLEET_PRODUCER_DEEP_SCHEDULE_ID).toBe("fleet-producer-e2e-deep");
  });
});

describe("buildJobProducer — family forwarding", () => {
  /** Minimal producer-facing queue fake recording enqueue inputs. */
  function makeRecordingQueue(): FleetQueueClient & {
    enqueued: EnqueueJobInput[];
  } {
    const enqueued: EnqueueJobInput[] = [];
    let jobSeq = 0;
    const unsupported = (n: string) => () => {
      throw new Error(`fake-queue: ${n} not used by these tests`);
    };
    return {
      enqueued,
      async enqueue(input: EnqueueJobInput): Promise<JobView> {
        enqueued.push(input);
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
      async sweepExpired() {
        return { reclaimed: 0, commErrors: [] };
      },
      async pruneAged() {
        return { terminal: 0, zombie: 0 };
      },
      claimNext: unsupported("claimNext"),
      renewLease: unsupported("renewLease"),
      report: unsupported("report"),
    } as unknown as FleetQueueClient & { enqueued: EnqueueJobInput[] };
  }

  it("forwards family to createJobProducer (observed on a produced enqueue input)", async () => {
    // The wrapper re-declares every forwarded dep (explicit spread), so an
    // omitted `family` field would SILENTLY drop the option (§4.2) — this test
    // pins the forwarding by observing the stamped family end-to-end.
    const queue = makeRecordingQueue();
    const producer = buildJobProducer({
      queue,
      enumerate: () => [
        {
          probeKey: "d5-single-pill-e2e:langgraph-python",
          serviceSlug: "langgraph-python",
          driverKind: "e2e_d5",
        },
      ],
      logger: SILENT_LOGGER,
      family: "d5",
    });
    producer.start();
    await producer.tick();
    expect(queue.enqueued).toHaveLength(1);
    expect(queue.enqueued[0]!.family).toBe("d5");
  });
});

describe("createControlPlane.stop", () => {
  it("unregisters the producer tick, stops the producer, and clears the consumer timer", async () => {
    const producer = makeFakeProducer();
    const scheduler = makeFakeScheduler();
    const timers = makeFakeTimers();
    const cp = createControlPlane({
      producer,
      consumer: makeFakeConsumer(),
      scheduler,
      logger: SILENT_LOGGER,
      setIntervalImpl: timers.setIntervalImpl,
      clearIntervalImpl: timers.clearIntervalImpl,
    });
    cp.start();
    await cp.stop();

    expect(scheduler.entries.has(FLEET_PRODUCER_SCHEDULE_ID)).toBe(false);
    expect(producer.stopped).toBe(true);
    expect(timers.cleared).toBe(true);
  });

  it("after stop(), a fired interval no longer ticks the consumer", async () => {
    const consumer = makeFakeConsumer();
    const timers = makeFakeTimers();
    const cp = createControlPlane({
      producer: makeFakeProducer(),
      consumer,
      scheduler: makeFakeScheduler(),
      logger: SILENT_LOGGER,
      setIntervalImpl: timers.setIntervalImpl,
      clearIntervalImpl: timers.clearIntervalImpl,
    });
    cp.start();
    await cp.stop();
    await timers.fire();
    expect(consumer.calls).toBe(0);
  });
});

// ── REQ-B: dead-worker comm-error surfacing through the aggregator ──────────
describe("createControlPlane — REQ-B comm-error surfacing", () => {
  const SWEEP_ERR: PoolCommError = {
    kind: "worker-crashed-mid-job",
    message: "lease for job j1 expired; re-queued",
    workerId: "worker-dead",
    jobId: "j1",
    observedAt: "2026-06-04T00:00:09.000Z",
  };

  it("checkFleetHealthOnce feeds each reclaimed overlay to the aggregator with its dashboard key", async () => {
    const aggregator = makeFakeAggregator();
    const fleetHealth = makeFakeFleetHealth(
      emptyHealthResult({
        unhealthy: 1,
        reclaimed: 1,
        commErrors: [SWEEP_ERR],
        reclaimedOverlays: [
          { commError: SWEEP_ERR, aggregateKey: "d6:langgraph-python" },
        ],
      }),
    );
    const cp = createControlPlane({
      producer: makeFakeProducer(),
      consumer: makeFakeConsumer(),
      scheduler: makeFakeScheduler(),
      logger: SILENT_LOGGER,
      aggregator,
      fleetHealth,
      setIntervalImpl: makeFakeTimers().setIntervalImpl,
    });

    await cp.checkFleetHealthOnce();

    expect(fleetHealth.calls).toBe(1);
    expect(aggregator.commErrorCalls).toHaveLength(1);
    expect(aggregator.commErrorCalls[0]).toEqual({
      commError: SWEEP_ERR,
      aggregateKey: "d6:langgraph-python",
    });
  });

  it("the fleet-health interval drives checkFleetHealthOnce when a monitor is injected", async () => {
    const aggregator = makeFakeAggregator();
    const fleetHealth = makeFakeFleetHealth(emptyHealthResult());
    const timers = makeFakeTimers();
    const cp = createControlPlane({
      producer: makeFakeProducer(),
      consumer: makeFakeConsumer(),
      scheduler: makeFakeScheduler(),
      logger: SILENT_LOGGER,
      aggregator,
      fleetHealth,
      // The SAME fake timer pair carries both the consumer and fleet-health
      // intervals (per-handle, like the real setInterval); fire() drives
      // every active callback. We assert the monitor was invoked.
      setIntervalImpl: timers.setIntervalImpl,
      clearIntervalImpl: timers.clearIntervalImpl,
    });
    cp.start();
    await timers.fire();
    expect(fleetHealth.calls).toBe(1);
  });

  it("with fleetHealth injected, the consumer AND fleet-health intervals BOTH fire — and stop() clears BOTH", async () => {
    // The old FakeTimers held a SINGLE callback slot, so the second
    // registration (fleet-health) silently overwrote the consumer's — a
    // control-plane that never started the consumer loop when fleet-health
    // was injected would have passed every test in this file. Per-handle
    // timers pin both loops, and per-handle clears pin that stop() tears
    // down BOTH (a leaked interval would survive shutdown).
    const consumer = makeFakeConsumer();
    const fleetHealth = makeFakeFleetHealth(emptyHealthResult());
    const timers = makeFakeTimers();
    const cp = createControlPlane({
      producer: makeFakeProducer(),
      consumer,
      scheduler: makeFakeScheduler(),
      logger: SILENT_LOGGER,
      aggregator: makeFakeAggregator(),
      fleetHealth,
      setIntervalImpl: timers.setIntervalImpl,
      clearIntervalImpl: timers.clearIntervalImpl,
    });
    cp.start();
    expect(timers.registered).toBe(2);

    await timers.fire();
    expect(consumer.calls).toBe(1);
    expect(fleetHealth.calls).toBe(1);

    await cp.stop();
    // ALL registered handles cleared — not just the last one.
    expect(timers.cleared).toBe(true);
    await timers.fire();
    expect(consumer.calls).toBe(1);
    expect(fleetHealth.calls).toBe(1);
  });

  it("surfaceSweepCommErrors resolves each bare error's dashboard key then writes the overlay", async () => {
    const aggregator = makeFakeAggregator();
    const cp = createControlPlane({
      producer: makeFakeProducer(),
      consumer: makeFakeConsumer(),
      scheduler: makeFakeScheduler(),
      logger: SILENT_LOGGER,
      aggregator,
      resolveSweepAggregateKey: (err) =>
        err.jobId === "j1" ? "d6:langgraph-python" : null,
      setIntervalImpl: makeFakeTimers().setIntervalImpl,
    });

    await cp.surfaceSweepCommErrors([SWEEP_ERR]);

    expect(aggregator.commErrorCalls).toHaveLength(1);
    expect(aggregator.commErrorCalls[0]).toEqual({
      commError: SWEEP_ERR,
      aggregateKey: "d6:langgraph-python",
    });
  });

  it("surfaceSweepCommErrors skips an error whose dashboard key cannot be resolved", async () => {
    const aggregator = makeFakeAggregator();
    const cp = createControlPlane({
      producer: makeFakeProducer(),
      consumer: makeFakeConsumer(),
      scheduler: makeFakeScheduler(),
      logger: SILENT_LOGGER,
      aggregator,
      resolveSweepAggregateKey: () => null,
      setIntervalImpl: makeFakeTimers().setIntervalImpl,
    });

    await cp.surfaceSweepCommErrors([SWEEP_ERR]);
    expect(aggregator.commErrorCalls).toHaveLength(0);
  });

  it("is inert (no fleet-health timer, no aggregator calls) when those deps are omitted", async () => {
    const aggregator = makeFakeAggregator();
    const timers = makeFakeTimers();
    const cp = createControlPlane({
      producer: makeFakeProducer(),
      consumer: makeFakeConsumer(),
      scheduler: makeFakeScheduler(),
      logger: SILENT_LOGGER,
      // no aggregator, no fleetHealth, no resolver
      setIntervalImpl: timers.setIntervalImpl,
      clearIntervalImpl: timers.clearIntervalImpl,
    });
    cp.start();
    // surfaceSweepCommErrors is a no-op without aggregator+resolver.
    await cp.surfaceSweepCommErrors([SWEEP_ERR]);
    await cp.checkFleetHealthOnce();
    expect(aggregator.commErrorCalls).toHaveLength(0);
  });

  it("surfaceSweepCommErrors passes the CURRENT row colour as lastKnownState (red stays red, NOT green)", async () => {
    const aggregator = makeFakeAggregator();
    const cp = createControlPlane({
      producer: makeFakeProducer(),
      consumer: makeFakeConsumer(),
      scheduler: makeFakeScheduler(),
      logger: SILENT_LOGGER,
      aggregator,
      resolveSweepAggregateKey: () => "d6:langgraph-python",
      // The service was last observed RED — a crash overlay must preserve it.
      resolvePriorState: () => "red",
      setIntervalImpl: makeFakeTimers().setIntervalImpl,
    });

    await cp.surfaceSweepCommErrors([SWEEP_ERR]);

    expect(aggregator.commErrorCalls).toHaveLength(1);
    expect(aggregator.commErrorCalls[0].lastKnownState).toBe("red");
  });

  it("checkFleetHealthOnce passes the CURRENT row colour as lastKnownState (red stays red, NOT green)", async () => {
    const aggregator = makeFakeAggregator();
    const fleetHealth = makeFakeFleetHealth(
      emptyHealthResult({
        reclaimedOverlays: [
          { commError: SWEEP_ERR, aggregateKey: "d6:langgraph-python" },
        ],
      }),
    );
    const cp = createControlPlane({
      producer: makeFakeProducer(),
      consumer: makeFakeConsumer(),
      scheduler: makeFakeScheduler(),
      logger: SILENT_LOGGER,
      aggregator,
      fleetHealth,
      resolvePriorState: () => "red",
      setIntervalImpl: makeFakeTimers().setIntervalImpl,
    });

    await cp.checkFleetHealthOnce();

    expect(aggregator.commErrorCalls).toHaveLength(1);
    expect(aggregator.commErrorCalls[0].lastKnownState).toBe("red");
  });

  it("checkFleetHealthOnce skips an overlay with an empty aggregateKey (never writes a row keyed '')", async () => {
    const aggregator = makeFakeAggregator();
    const fleetHealth = makeFakeFleetHealth(
      emptyHealthResult({
        reclaimedOverlays: [{ commError: SWEEP_ERR, aggregateKey: "" }],
      }),
    );
    const cp = createControlPlane({
      producer: makeFakeProducer(),
      consumer: makeFakeConsumer(),
      scheduler: makeFakeScheduler(),
      logger: SILENT_LOGGER,
      aggregator,
      fleetHealth,
      setIntervalImpl: makeFakeTimers().setIntervalImpl,
    });

    await cp.checkFleetHealthOnce();

    expect(aggregator.commErrorCalls).toHaveLength(0);
  });

  it("a throwing resolvePriorState degrades to no lastKnownState — still writes the overlay (never aborts the leg)", async () => {
    const aggregator = makeFakeAggregator();
    const cp = createControlPlane({
      producer: makeFakeProducer(),
      consumer: makeFakeConsumer(),
      scheduler: makeFakeScheduler(),
      logger: SILENT_LOGGER,
      aggregator,
      resolveSweepAggregateKey: () => "d6:langgraph-python",
      resolvePriorState: () => {
        throw new Error("pb blip");
      },
      setIntervalImpl: makeFakeTimers().setIntervalImpl,
    });

    await cp.surfaceSweepCommErrors([SWEEP_ERR]);

    expect(aggregator.commErrorCalls).toHaveLength(1);
    expect(aggregator.commErrorCalls[0].lastKnownState).toBeUndefined();
  });
});

describe("createControlPlane — §9 family-silence tick seam", () => {
  function makeFakeFamilySilence(impl?: (nowMs: number) => Promise<void>) {
    const calls: number[] = [];
    return {
      calls,
      async tick(nowMs: number): Promise<void> {
        calls.push(nowMs);
        if (impl) return impl(nowMs);
      },
    };
  }

  function makeRecordingLogger(): Logger & {
    warns: Array<{ msg: string; meta?: Record<string, unknown> }>;
  } {
    const warns: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
    return {
      warns,
      info: () => {},
      warn: (msg, meta) => {
        warns.push({ msg, ...(meta ? { meta } : {}) });
      },
      error: () => {},
      debug: () => {},
    };
  }

  /** Flush the fire-and-forget tick chain (deeper than FakeTimers.fire covers). */
  async function settle(): Promise<void> {
    await new Promise((resolve) => setImmediate(resolve));
  }

  it("the fleet-health interval invokes familySilence.tick when supplied", async () => {
    const familySilence = makeFakeFamilySilence();
    const fleetHealth = makeFakeFleetHealth(emptyHealthResult());
    const timers = makeFakeTimers();
    const cp = createControlPlane({
      producer: makeFakeProducer(),
      consumer: makeFakeConsumer(),
      scheduler: makeFakeScheduler(),
      logger: SILENT_LOGGER,
      fleetHealth,
      familySilence,
      setIntervalImpl: timers.setIntervalImpl,
      clearIntervalImpl: timers.clearIntervalImpl,
    });
    cp.start();
    await timers.fire();
    await settle();
    expect(fleetHealth.calls).toBe(1);
    expect(familySilence.calls).toHaveLength(1);
    expect(typeof familySilence.calls[0]).toBe("number");
  });

  it("a familySilence tick rejection is logged and never wedges the loop", async () => {
    const familySilence = makeFakeFamilySilence(async () => {
      throw new Error("monitor blew up");
    });
    const fleetHealth = makeFakeFleetHealth(emptyHealthResult());
    const logger = makeRecordingLogger();
    const timers = makeFakeTimers();
    const cp = createControlPlane({
      producer: makeFakeProducer(),
      consumer: makeFakeConsumer(),
      scheduler: makeFakeScheduler(),
      logger,
      fleetHealth,
      familySilence,
      setIntervalImpl: timers.setIntervalImpl,
      clearIntervalImpl: timers.clearIntervalImpl,
    });
    cp.start();
    await timers.fire();
    await settle();
    await timers.fire();
    await settle();
    // The rejection never wedges health reclaim: both cycles ran.
    expect(fleetHealth.calls).toBe(2);
    expect(familySilence.calls).toHaveLength(2);
    expect(
      logger.warns.some(
        (w) => w.msg === "fleet.control-plane.family-silence-tick-failed",
      ),
    ).toBe(true);
  });

  it("familySilence ticks on the fleet-health interval even with no fleet-health monitor injected", async () => {
    const familySilence = makeFakeFamilySilence();
    const timers = makeFakeTimers();
    const cp = createControlPlane({
      producer: makeFakeProducer(),
      consumer: makeFakeConsumer(),
      scheduler: makeFakeScheduler(),
      logger: SILENT_LOGGER,
      // no fleetHealth — the monitor must still ride the interval
      familySilence,
      setIntervalImpl: timers.setIntervalImpl,
      clearIntervalImpl: timers.clearIntervalImpl,
    });
    cp.start();
    await timers.fire();
    await settle();
    expect(familySilence.calls).toHaveLength(1);
  });
});
