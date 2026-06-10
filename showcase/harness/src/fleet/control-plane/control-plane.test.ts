import { describe, it, expect, vi } from "vitest";
import {
  createControlPlane,
  FLEET_PRODUCER_SCHEDULE_ID,
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
import type { PoolCommError } from "../contracts.js";

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
        sweptExpired: false,
        reclaimed: 0,
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

/** A controllable fake setInterval/clearInterval pair. */
class FakeTimers {
  private cb: (() => void) | undefined;
  cleared = false;
  setIntervalImpl = ((fn: () => void) => {
    this.cb = fn;
    return 1 as unknown as ReturnType<typeof setInterval>;
  }) as unknown as typeof setInterval;
  clearIntervalImpl = (() => {
    this.cleared = true;
    this.cb = undefined;
  }) as unknown as typeof clearInterval;
  async fire(): Promise<void> {
    this.cb?.();
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
      // Use the SAME fake timer for both consumer + fleet-health; fire() drives
      // whichever callback was registered last (fleet-health), proving the loop
      // is attached. We assert the monitor was invoked.
      setIntervalImpl: timers.setIntervalImpl,
      clearIntervalImpl: timers.clearIntervalImpl,
    });
    cp.start();
    await timers.fire();
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
