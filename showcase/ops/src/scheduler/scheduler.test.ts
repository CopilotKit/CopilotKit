import { describe, it, expect } from "vitest";
import { createScheduler } from "./scheduler.js";
import { logger } from "../logger.js";

describe("scheduler", () => {
  it("register + unregister idempotent", () => {
    const s = createScheduler({ logger });
    s.register({ id: "x", cron: "* * * * *", handler: () => {} });
    expect(s.hasEntry("x")).toBe(true);
    expect(s.unregister("x")).toBe(true);
    expect(s.hasEntry("x")).toBe(false);
    expect(s.unregister("x")).toBe(false);
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
});
