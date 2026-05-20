import { describe, it, expect } from "vitest";
import type { Browser } from "playwright";
import { BrowserPool, type LaunchBrowser } from "./browser-pool.js";

/**
 * Minimal `Browser` stand-in that exposes the surface BrowserPool actually
 * uses (`isConnected`, `on`, `close`, `newContext`) plus test-only hooks
 * for simulating chromium lifecycle events:
 *
 *   - `__crash()`           — fires the `disconnected` event AND flips
 *                             `isConnected` false. Mirrors a real chromium
 *                             that died and notified Playwright cleanly.
 *   - `__silentlyDisconnect()` — flips `isConnected` false but does NOT
 *                             fire `disconnected`. Mirrors a process that
 *                             died without Playwright noticing in time
 *                             (e.g. WebSocket hung), so the pool's only
 *                             defense is the on-acquire health check.
 */
interface FakeBrowser {
  readonly __id: number;
  isConnected(): boolean;
  on(event: string, handler: (...args: unknown[]) => void): void;
  close(): Promise<void>;
  newContext(): Promise<{ close(): Promise<void> }>;
  __crash(): void;
  __silentlyDisconnect(): void;
  readonly __closeCount: number;
}

let nextBrowserId = 0;

function makeFakeBrowser(): FakeBrowser {
  const id = nextBrowserId++;
  let connected = true;
  let closeCount = 0;
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  const fire = (event: string): void => {
    for (const h of handlers.get(event) ?? []) h();
  };
  return {
    __id: id,
    get __closeCount() {
      return closeCount;
    },
    isConnected: () => connected,
    on(event, handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    async close() {
      closeCount++;
      const wasConnected = connected;
      connected = false;
      if (wasConnected) fire("disconnected");
    },
    async newContext() {
      return { close: async () => {} };
    },
    __crash() {
      if (connected) {
        connected = false;
        fire("disconnected");
      }
    },
    __silentlyDisconnect() {
      connected = false;
    },
  };
}

interface FakeLauncher {
  launchBrowser: LaunchBrowser;
  launched: FakeBrowser[];
}

function makeFakeLauncher(opts?: { failAt?: number }): FakeLauncher {
  const launched: FakeBrowser[] = [];
  let callCount = 0;
  const launchBrowser = async (): Promise<Browser> => {
    callCount++;
    if (opts?.failAt !== undefined && callCount === opts.failAt) {
      throw new Error("simulated launch failure");
    }
    const b = makeFakeBrowser();
    launched.push(b);
    return b as unknown as Browser;
  };
  return { launchBrowser, launched };
}

interface CapturedLog {
  event: string;
  meta?: Record<string, unknown>;
}

function makeFakeLogger(): {
  logger: { info: (msg: string, meta?: Record<string, unknown>) => void };
  events: CapturedLog[];
} {
  const events: CapturedLog[] = [];
  return {
    logger: {
      info(msg, meta) {
        events.push({ event: msg, meta });
      },
    },
    events,
  };
}

/**
 * `recycleSlot` kicks off an async relaunch via a fire-and-forget IIFE.
 * Tests that observe post-recycle state need to await the in-flight
 * promise to settle. `shutdown()` already awaits `inFlightRecycles`, so
 * this helper is just `await pool.shutdown()` from the test side; here
 * we use a small drain helper for tests that want to observe state
 * without tearing the pool down.
 */
async function drainMicrotasks(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

describe("BrowserPool dead-instance detection", () => {
  it("registers a disconnected listener on each browser at init and recycles when one fires", async () => {
    const { launchBrowser, launched } = makeFakeLauncher();
    const { logger, events } = makeFakeLogger();
    const pool = new BrowserPool(2, 100, logger, launchBrowser);
    await pool.init();
    expect(launched).toHaveLength(2);

    // Crash slot 0's browser. The disconnected listener should fire and
    // kick recycle, which launches a fresh browser (the 3rd one).
    launched[0]!.__crash();
    await drainMicrotasks();

    const disconnected = events.find(
      (e) => e.event === "browser-pool.disconnected",
    );
    expect(disconnected).toBeDefined();
    expect(disconnected?.meta).toEqual({ slotIndex: 0 });

    await pool.shutdown();
    // After shutdown awaits the in-flight recycle, the fresh launch must
    // have completed.
    expect(launched.length).toBeGreaterThanOrEqual(3);
  });

  it("acquire() skips a silently-disconnected slot and returns the next live one", async () => {
    const { launchBrowser, launched } = makeFakeLauncher();
    const { logger, events } = makeFakeLogger();
    const pool = new BrowserPool(2, 100, logger, launchBrowser);
    await pool.init();

    const slot0Browser = launched[0]!;
    const slot1Browser = launched[1]!;

    // Silent disconnect: `isConnected` flips false without firing the
    // event. acquire() must still skip it.
    slot0Browser.__silentlyDisconnect();

    const acquired = await pool.acquire();
    expect(acquired).toBe(slot1Browser as unknown as Browser);

    expect(
      events.some((e) => e.event === "browser-pool.skipped-dead-slot"),
    ).toBe(true);

    await pool.shutdown();
  });

  it("acquire() recycles every zombie slot and falls through to the waiter path when no live slots remain", async () => {
    const { launchBrowser, launched } = makeFakeLauncher();
    const pool = new BrowserPool(2, 100, undefined, launchBrowser);
    await pool.init();

    launched[0]!.__silentlyDisconnect();
    launched[1]!.__silentlyDisconnect();

    // Both available slots are zombies. acquire() should kick recycle on
    // each and return a Promise that resolves once a recycled browser
    // becomes available.
    const acquirePromise = pool.acquire();

    await drainMicrotasks(20);

    const acquired = await acquirePromise;
    // The fresh launch is browser #2 or #3 — either is fine.
    const fresh = launched.slice(2);
    expect(fresh).toContain(acquired as unknown as FakeBrowser);

    await pool.shutdown();
  });

  it("disconnected event during in-use slot triggers a recycle that delivers a fresh browser to the next acquire", async () => {
    const { launchBrowser, launched } = makeFakeLauncher();
    const pool = new BrowserPool(1, 100, undefined, launchBrowser);
    await pool.init();

    const browser = await pool.acquire();
    expect(browser).toBe(launched[0] as unknown as Browser);

    // Simulate chromium dying while the probe still holds the browser.
    launched[0]!.__crash();
    await drainMicrotasks(20);

    const next = await pool.acquire();
    expect(next).not.toBe(browser);
    expect(next).toBe(launched[launched.length - 1] as unknown as Browser);

    await pool.shutdown();
  });

  it("does not double-recycle when both the disconnect event and the on-acquire zombie check fire for the same slot", async () => {
    const { launchBrowser, launched } = makeFakeLauncher();
    const pool = new BrowserPool(1, 100, undefined, launchBrowser);
    await pool.init();

    // Crash fires disconnect AND flips isConnected false.
    launched[0]!.__crash();
    // Acquire while the recycle is still in flight — sees nothing in
    // available, falls through to waiter path. The disconnect-driven
    // recycle delivers the fresh browser to the waiter.
    const acquired = await pool.acquire();

    // Exactly one fresh browser was launched (the recycle replacement).
    expect(launched.length).toBe(2);
    expect(acquired).toBe(launched[1] as unknown as Browser);

    await pool.shutdown();
  });

  it("release() of a slot whose browser disconnected after acquire still recycles instead of returning a dead browser to available", async () => {
    const { launchBrowser, launched } = makeFakeLauncher();
    const { logger, events } = makeFakeLogger();
    const pool = new BrowserPool(1, 100, logger, launchBrowser);
    await pool.init();

    const browser = await pool.acquire();
    // Silent disconnect: no event fires. The pool only learns the slot
    // is dead at the next isConnected check — which the patched
    // release() now performs before re-queuing.
    (browser as unknown as FakeBrowser).__silentlyDisconnect();
    pool.release(browser);

    await drainMicrotasks(20);

    expect(
      events.some((e) => e.event === "browser-pool.release-dead-slot"),
    ).toBe(true);
    // A fresh browser was launched; the dead one was not re-queued.
    expect(launched.length).toBe(2);

    const next = await pool.acquire();
    expect(next).toBe(launched[1] as unknown as Browser);
    expect((next as unknown as FakeBrowser).isConnected()).toBe(true);

    await pool.shutdown();
  });

  it("shutdown() does not loop the disconnect handler when closing slot browsers", async () => {
    const { launchBrowser, launched } = makeFakeLauncher();
    const { logger, events } = makeFakeLogger();
    const pool = new BrowserPool(2, 100, logger, launchBrowser);
    await pool.init();

    await pool.shutdown();

    // shutdown closes both browsers, which fires disconnected on the fakes.
    // The handler must early-return on isShutdown so no relaunches happen.
    expect(launched.length).toBe(2);
    expect(
      events.filter((e) => e.event === "browser-pool.recycle"),
    ).toHaveLength(0);
    expect(launched[0]!.__closeCount).toBeGreaterThan(0);
    expect(launched[1]!.__closeCount).toBeGreaterThan(0);
  });
});
