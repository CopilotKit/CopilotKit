import { describe, it, expect } from "vitest";
import {
  createScheduler,
  SchedulerStoppedError,
  InflightConflictError,
} from "./scheduler.js";
import { logger } from "../logger.js";

describe("scheduler", () => {
  it("register + unregister idempotent", async () => {
    const s = createScheduler({ logger });
    s.register({ id: "x", cron: "* * * * *", handler: () => {} });
    expect(s.hasEntry("x")).toBe(true);
    expect(await s.unregister("x")).toBe(true);
    expect(s.hasEntry("x")).toBe(false);
    expect(await s.unregister("x")).toBe(false);
  });

  it("re-registering same id replaces handler", () => {
    const s = createScheduler({ logger });
    let call = "";
    s.register({
      id: "x",
      cron: "* * * * *",
      handler: () => {
        call = "first";
      },
    });
    s.register({
      id: "x",
      cron: "* * * * *",
      handler: () => {
        call = "second";
      },
    });
    const entry = s.list().find((e) => e.id === "x")!;
    entry.handler();
    expect(call).toBe("second");
  });

  it("list returns current entries", () => {
    const s = createScheduler({ logger });
    s.register({ id: "a", cron: "* * * * *", handler: () => {} });
    s.register({ id: "b", cron: "0 9 * * 1", handler: () => {} });
    expect(
      s
        .list()
        .map((e) => e.id)
        .sort(),
    ).toEqual(["a", "b"]);
  });

  it("rejects invalid cron at register with rule id context", () => {
    const s = createScheduler({ logger });
    expect(() =>
      s.register({
        id: "badrule",
        cron: "not-a-cron",
        handler: () => {},
      }),
    ).toThrow(/badrule/);
  });

  it("getJobCount reflects registered entries", async () => {
    const s = createScheduler({ logger });
    expect(s.getJobCount()).toBe(0);
    s.register({ id: "a", cron: "* * * * *", handler: () => {} });
    expect(s.getJobCount()).toBe(1);
    s.register({ id: "b", cron: "0 9 * * 1", handler: () => {} });
    expect(s.getJobCount()).toBe(2);
    await s.unregister("a");
    expect(s.getJobCount()).toBe(1);
  });

  it("exposes isStarted / isStopped", async () => {
    const s = createScheduler({ logger });
    expect(s.isStarted()).toBe(false);
    expect(s.isStopped()).toBe(false);
    s.start();
    expect(s.isStarted()).toBe(true);
    expect(s.isStopped()).toBe(false);
    await s.stop();
    expect(s.isStarted()).toBe(false);
    expect(s.isStopped()).toBe(true);
  });

  it("throws SchedulerStoppedError on register after stop()", async () => {
    const s = createScheduler({ logger });
    s.start();
    await s.stop();
    expect(() =>
      s.register({ id: "late", cron: "* * * * *", handler: () => {} }),
    ).toThrow(SchedulerStoppedError);
  });

  it("throws SchedulerStoppedError on start after stop()", async () => {
    const s = createScheduler({ logger });
    s.start();
    await s.stop();
    expect(() => s.start()).toThrow(SchedulerStoppedError);
  });

  it("stop() drains in-flight handlers before clearing", async () => {
    const s = createScheduler({ logger });
    let resolveHandler!: () => void;
    let handlerFinished = false;
    // Use a broad cron (every second) — croner fires after construction on
    // the nearest match; we'll force-simulate a fire by calling the handler
    // through the internal path via schedule.list()[0].handler() isn't
    // enough because we must exercise the wrapped variant created by startEntry.
    // Instead: register, start, then manually create an inflight promise by
    // monkey-patching after start. Simplest path: verify stop() returns a
    // Promise and awaits inflight by directly wiring a slow handler via
    // running Cron once.
    s.register({
      id: "slow",
      cron: "* * * * * *", // every second
      handler: () =>
        new Promise<void>((resolve) => {
          resolveHandler = () => {
            handlerFinished = true;
            resolve();
          };
        }),
    });
    s.start();
    // Wait up to 2s for the first fire to begin.
    const start = Date.now();
    while (Date.now() - start < 2500 && resolveHandler === undefined) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(typeof resolveHandler).toBe("function");
    // Kick off stop() — it must wait for our handler to resolve.
    const stopPromise = s.stop();
    // Resolve a tick later so we can detect drain behavior deterministically.
    setTimeout(() => resolveHandler(), 50);
    await stopPromise;
    expect(handlerFinished).toBe(true);
  }, 10_000);

  it("unregister() drains in-flight handlers before returning", async () => {
    const s = createScheduler({ logger });
    let resolveHandler!: () => void;
    let handlerFinished = false;
    s.register({
      id: "slow",
      cron: "* * * * * *",
      handler: () =>
        new Promise<void>((resolve) => {
          resolveHandler = () => {
            handlerFinished = true;
            resolve();
          };
        }),
    });
    s.start();
    // Wait for first fire to land and begin executing.
    const t0 = Date.now();
    while (Date.now() - t0 < 2500 && resolveHandler === undefined) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(typeof resolveHandler).toBe("function");
    const unregistered = s.unregister("slow");
    // Let the unregister start awaiting before we resolve the handler.
    setTimeout(() => resolveHandler(), 50);
    const result = await unregistered;
    expect(result).toBe(true);
    expect(handlerFinished).toBe(true);
    // Entry fully removed after drain — subsequent unregister is false.
    expect(await s.unregister("slow")).toBe(false);
  }, 10_000);

  it("fire-and-forget unregister followed by register sequences the new handler after drain", async () => {
    // Reproduces the orchestrator.diffCronSchedules pattern: unregister is
    // called without `await`, then a replacement is registered immediately.
    // The new handler's first tick must not race with the old one.
    const s = createScheduler({ logger });
    const order: string[] = [];
    let resolveOld!: () => void;
    s.register({
      id: "swap",
      cron: "* * * * * *",
      handler: () =>
        new Promise<void>((resolve) => {
          resolveOld = () => {
            order.push("old-done");
            resolve();
          };
        }),
    });
    s.start();
    // Wait for the old handler to enter the wrapper.
    const t0 = Date.now();
    while (Date.now() - t0 < 2500 && resolveOld === undefined) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(typeof resolveOld).toBe("function");
    // Fire-and-forget unregister + immediate re-register with a NEW
    // handler. The scheduler's per-id drain handoff should make the new
    // handler's first tick wait for resolveOld() before running.
    void s.unregister("swap");
    s.register({
      id: "swap",
      cron: "* * * * * *",
      handler: () => {
        order.push("new-ran");
      },
    });
    // Release the old handler shortly.
    setTimeout(() => resolveOld(), 50);
    // Wait up to 3s for the new handler to fire.
    const t1 = Date.now();
    while (Date.now() - t1 < 3500 && !order.includes("new-ran")) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(order).toContain("old-done");
    expect(order).toContain("new-ran");
    expect(order.indexOf("old-done")).toBeLessThan(order.indexOf("new-ran"));
    await s.stop();
  }, 10_000);

  it("populates lastRunFinishedAt + lastRunDurationMs after a scheduled run completes", async () => {
    const s = createScheduler({ logger });
    let finishHandler!: () => void;
    s.register({
      id: "introspect-finished",
      cron: "* * * * * *",
      handler: () =>
        new Promise<void>((resolve) => {
          finishHandler = resolve;
        }),
    });
    s.start();
    // Wait for the first tick to start.
    const t0 = Date.now();
    while (Date.now() - t0 < 2500 && finishHandler === undefined) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(typeof finishHandler).toBe("function");
    // Before completion, finishedAt + durationMs are still null.
    const beforeStatus = s.getEntry("introspect-finished")!;
    expect(beforeStatus.lastRunFinishedAt).toBeNull();
    expect(beforeStatus.lastRunDurationMs).toBeNull();
    // Complete the run.
    finishHandler();
    // Give the wrapper one microtask + a small tick to record finish state.
    await new Promise((r) => setTimeout(r, 50));
    const afterStatus = s.getEntry("introspect-finished")!;
    expect(afterStatus.lastRunFinishedAt).not.toBeNull();
    expect(typeof afterStatus.lastRunFinishedAt).toBe("number");
    expect(afterStatus.lastRunDurationMs).not.toBeNull();
    expect(afterStatus.lastRunDurationMs!).toBeGreaterThanOrEqual(0);
    await s.stop();
  }, 10_000);

  it("getEntry returns the live slot state and undefined for unknown ids", async () => {
    const s = createScheduler({ logger });
    expect(s.getEntry("nope")).toBeUndefined();
    s.register({ id: "ge", cron: "* * * * *", handler: () => {} });
    const status = s.getEntry("ge");
    expect(status).toBeDefined();
    expect(status!.id).toBe("ge");
    expect(status!.lastRunStartedAt).toBeNull();
    expect(status!.lastRunFinishedAt).toBeNull();
    expect(status!.lastRunDurationMs).toBeNull();
    expect(status!.lastRunSummary).toBeNull();
    expect(status!.triggeredRun).toBe(false);
    expect(status!.tracker).toBeNull();
    expect(status!.inflight).toBe(0);
    await s.unregister("ge");
    expect(s.getEntry("ge")).toBeUndefined();
  });

  it("trigger() invokes the handler outside the cron schedule and returns a runId", async () => {
    const s = createScheduler({ logger });
    let invocations = 0;
    let resolveHandler: (() => void) | null = null;
    s.register({
      // Far-future cron so the handler will not fire on its own during the test.
      id: "trig",
      cron: "0 0 1 1 *",
      handler: () =>
        new Promise<void>((resolve) => {
          invocations += 1;
          resolveHandler = resolve;
        }),
    });
    s.start();
    const result = await s.trigger("trig");
    expect(result.runId).toMatch(/.+/);
    expect(result.probe).toBe("trig");
    expect(["queued", "running"]).toContain(result.status);
    // Wait for the handler to enter.
    const t0 = Date.now();
    while (Date.now() - t0 < 1500 && resolveHandler === null) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(invocations).toBe(1);
    resolveHandler!();
    await new Promise((r) => setTimeout(r, 50));
    await s.stop();
  }, 10_000);

  it("trigger() throws InflightConflictError when the entry is already inflight", async () => {
    const s = createScheduler({ logger });
    let resolveHandler!: () => void;
    s.register({
      id: "busy",
      cron: "0 0 1 1 *",
      handler: () =>
        new Promise<void>((resolve) => {
          resolveHandler = resolve;
        }),
    });
    s.start();
    const first = await s.trigger("busy");
    expect(first.runId).toMatch(/.+/);
    // Wait for handler to start.
    const t0 = Date.now();
    while (Date.now() - t0 < 1500 && resolveHandler === undefined) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(typeof resolveHandler).toBe("function");
    await expect(s.trigger("busy")).rejects.toBeInstanceOf(
      InflightConflictError,
    );
    resolveHandler();
    await new Promise((r) => setTimeout(r, 50));
    await s.stop();
  }, 10_000);

  it("nextRunAt returns a Date for a scheduled entry and null for unknown ids", async () => {
    const s = createScheduler({ logger });
    s.register({ id: "nr", cron: "0 9 * * 1", handler: () => {} });
    s.start();
    const next = s.nextRunAt("nr");
    expect(next).toBeInstanceOf(Date);
    expect(next!.getTime()).toBeGreaterThan(Date.now());
    expect(s.nextRunAt("does-not-exist")).toBeNull();
    await s.stop();
  });

  it("triggeredRun is true during a manual trigger and false during a scheduled run", async () => {
    const s = createScheduler({ logger });
    let resolveScheduled: (() => void) | null = null;
    let scheduledTriggeredFlag: boolean | null = null;
    s.register({
      id: "flag-sched",
      cron: "* * * * * *",
      handler: () =>
        new Promise<void>((resolve) => {
          scheduledTriggeredFlag = s.getEntry("flag-sched")?.triggeredRun ?? null;
          resolveScheduled = resolve;
        }),
    });
    s.start();
    // Wait for scheduled tick to start.
    const t0 = Date.now();
    while (Date.now() - t0 < 2500 && resolveScheduled === null) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(scheduledTriggeredFlag).toBe(false);
    resolveScheduled!();
    await new Promise((r) => setTimeout(r, 50));
    await s.stop();

    // New scheduler for the manual-trigger flag check (avoid cron interleaving).
    const s2 = createScheduler({ logger });
    let resolveManual: (() => void) | null = null;
    let manualTriggeredFlag: boolean | null = null;
    s2.register({
      id: "flag-manual",
      cron: "0 0 1 1 *",
      handler: () =>
        new Promise<void>((resolve) => {
          manualTriggeredFlag = s2.getEntry("flag-manual")?.triggeredRun ?? null;
          resolveManual = resolve;
        }),
    });
    s2.start();
    await s2.trigger("flag-manual");
    const t1 = Date.now();
    while (Date.now() - t1 < 1500 && resolveManual === null) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(manualTriggeredFlag).toBe(true);
    resolveManual!();
    await new Promise((r) => setTimeout(r, 50));
    // After the manual run finishes, triggeredRun must be restored to false.
    expect(s2.getEntry("flag-manual")!.triggeredRun).toBe(false);
    await s2.stop();
  }, 15_000);

  it("populates lastRunSummary from a handler that returns a summary", async () => {
    const s = createScheduler({ logger });
    s.register({
      id: "summary",
      cron: "* * * * * *",
      handler: async () => ({ total: 10, passed: 7, failed: 3 }),
    });
    s.start();
    const t0 = Date.now();
    while (
      Date.now() - t0 < 3000 &&
      s.getEntry("summary")?.lastRunSummary === null
    ) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const status = s.getEntry("summary")!;
    expect(status.lastRunSummary).toEqual({ total: 10, passed: 7, failed: 3 });
    await s.stop();
  }, 10_000);

  // ---------------------------------------------------------------------
  // CR-A1.1: trigger(id, opts) threads opts to the handler
  // ---------------------------------------------------------------------
  it("passes TriggerOptions through to the handler when supplied", async () => {
    const s = createScheduler({ logger });
    const seenOpts: Array<unknown> = [];
    s.register({
      id: "thread",
      cron: "0 0 1 1 *",
      handler: async (opts) => {
        seenOpts.push(opts);
      },
    });
    s.start();
    await s.trigger("thread", { filter: { slugs: ["a", "b"] } });
    // Wait for the run to drain.
    await new Promise((r) => setTimeout(r, 100));
    expect(seenOpts).toHaveLength(1);
    expect(seenOpts[0]).toEqual({ filter: { slugs: ["a", "b"] } });
    await s.stop();
  });

  it("scheduled cron ticks invoke the handler with no opts (default = full discovery)", async () => {
    const s = createScheduler({ logger });
    const seenOpts: Array<unknown> = [];
    s.register({
      id: "tick-no-opts",
      cron: "* * * * * *",
      handler: async (opts) => {
        seenOpts.push(opts);
      },
    });
    s.start();
    // Wait for at least one cron-driven tick.
    const t0 = Date.now();
    while (Date.now() - t0 < 2500 && seenOpts.length === 0) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(seenOpts.length).toBeGreaterThanOrEqual(1);
    // Cron-fired ticks pass undefined — NOT an empty filter.
    expect(seenOpts[0]).toBeUndefined();
    await s.stop();
  }, 10_000);

  // ---------------------------------------------------------------------
  // CR-A1.3: lastRunSummary clears when handler throws
  // ---------------------------------------------------------------------
  it("clears lastRunSummary when the handler throws (no stale counts)", async () => {
    const s = createScheduler({ logger });
    let throwOnNextRun = false;
    s.register({
      id: "stale-summary",
      cron: "0 0 1 1 *",
      handler: async () => {
        if (throwOnNextRun) {
          throw new Error("handler exploded mid-run");
        }
        return { total: 10, passed: 7, failed: 3 };
      },
    });
    s.start();
    // First trigger: handler returns a summary cleanly.
    await s.trigger("stale-summary");
    await new Promise((r) => setTimeout(r, 50));
    const afterSuccess = s.getEntry("stale-summary")!;
    expect(afterSuccess.lastRunSummary).toEqual({
      total: 10,
      passed: 7,
      failed: 3,
    });
    expect(afterSuccess.lastRunFinishedAt).not.toBeNull();
    const successFinishedAt = afterSuccess.lastRunFinishedAt;
    // Second trigger: handler throws. Timestamps must update; lastRunSummary
    // must be cleared (NOT preserved at the prior {7,3} value).
    throwOnNextRun = true;
    await s.trigger("stale-summary");
    await new Promise((r) => setTimeout(r, 50));
    const afterThrow = s.getEntry("stale-summary")!;
    expect(afterThrow.lastRunSummary).toBeNull();
    expect(afterThrow.lastRunFinishedAt).not.toBeNull();
    // Fresh timestamp distinct from the prior successful run.
    expect(afterThrow.lastRunFinishedAt).not.toBe(successFinishedAt);
    await s.stop();
  }, 10_000);

  it("skips an overlapping tick rather than running handlers concurrently", async () => {
    // Croner fires every second, but if the handler takes longer than the
    // interval the second tick should be skipped (not queued) so ticks can't
    // pile up under sustained slowness.
    const s = createScheduler({ logger });
    let inflight = 0;
    let peak = 0;
    let entered = 0;
    s.register({
      id: "slow-handler",
      cron: "* * * * * *",
      handler: async () => {
        entered += 1;
        inflight += 1;
        peak = Math.max(peak, inflight);
        // Hold longer than the cron interval to force at least one skip.
        await new Promise((r) => setTimeout(r, 1200));
        inflight -= 1;
      },
    });
    s.start();
    // Let multiple ticks fire.
    await new Promise((r) => setTimeout(r, 2600));
    await s.stop();
    expect(peak).toBe(1); // no overlap
    expect(entered).toBeGreaterThanOrEqual(1);
  }, 10_000);

  // CR-C-sched.1: runId counter must be per-instance, not module-scoped.
  // Two independent Scheduler instances must each start their counter at 1
  // so test fixtures (and any future multi-instance use case) get isolated
  // run-id sequences instead of leaking IDs across schedulers.
  it("runId counter is isolated per Scheduler instance", async () => {
    const sA = createScheduler({ logger });
    const sB = createScheduler({ logger });
    sA.register({
      id: "iso",
      cron: "0 0 1 1 *",
      handler: () => {},
    });
    sB.register({
      id: "iso",
      cron: "0 0 1 1 *",
      handler: () => {},
    });
    sA.start();
    sB.start();
    const a = await sA.trigger("iso");
    const b = await sB.trigger("iso");
    // runId format: run_<timestamp36>_<counter36>. Extract the counter
    // suffix (last underscore-delimited segment) and assert both first
    // triggers see counter "1" — i.e. neither instance inherits the
    // other's counter state.
    const counterA = a.runId.split("_").pop();
    const counterB = b.runId.split("_").pop();
    expect(counterA).toBe("1");
    expect(counterB).toBe("1");
    // Settle the in-flight runs so stop() doesn't race the handler.
    await new Promise((r) => setTimeout(r, 50));
    await sA.stop();
    await sB.stop();
  }, 10_000);
});
