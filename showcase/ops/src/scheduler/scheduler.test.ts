import { describe, it, expect } from "vitest";
import {
  createScheduler,
  SchedulerStoppedError,
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
});
