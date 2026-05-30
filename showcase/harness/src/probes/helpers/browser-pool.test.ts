import { describe, it, expect } from "vitest";
import type { Browser } from "playwright";
import { BrowserPool } from "./browser-pool.js";
import type { LaunchBrowser } from "./browser-pool.js";

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

function makeFakeLauncher(opts?: {
  failAt?: number;
  failAtCalls?: number[];
}): FakeLauncher {
  const launched: FakeBrowser[] = [];
  let callCount = 0;
  const launchBrowser = async (): Promise<Browser> => {
    callCount++;
    if (
      (opts?.failAt !== undefined && callCount === opts.failAt) ||
      opts?.failAtCalls?.includes(callCount)
    ) {
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

/**
 * Poll `predicate` until it returns true or `timeoutMs` elapses. The pool's
 * recycle/relaunch paths use real `setTimeout` backoff, so state transitions
 * (slot eviction, relaunchPending parking, deferred recovery) settle over
 * wall-clock time rather than microtasks. Rejects on timeout so a test that
 * relies on a precondition fails loudly instead of asserting on stale state.
 */
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3_000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
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

  it("recovers after a transient relaunch failure instead of permanently shrinking the pool to 0", async () => {
    // Single-slot pool. The browser crashes; the recycle's relaunch fails
    // ONCE (the 2nd launch call), then a subsequent launch succeeds. The
    // pool must NOT permanently evict the slot — it must keep capacity and
    // self-heal so a later acquire() still returns a live browser.
    const { launchBrowser, launched } = makeFakeLauncher({ failAtCalls: [2] });
    const { logger } = makeFakeLogger();
    const pool = new BrowserPool(1, 100, logger, launchBrowser);
    await pool.init();
    expect(launched).toHaveLength(1);

    // Crash the only browser. The disconnect-driven recycle relaunches, but
    // launch #2 throws (the simulated transient failure).
    launched[0]!.__crash();
    await drainMicrotasks(30);

    // BUG: the old code spliced the slot out of `this.slots` on launch
    // failure, leaving size 0 forever. The pool must instead retain or
    // re-create the slot so capacity recovers.
    const acquired = await pool.acquire(5_000);
    expect(acquired).toBeDefined();
    expect((acquired as unknown as FakeBrowser).isConnected()).toBe(true);

    // Pool reports non-zero size again — it healed rather than draining.
    expect(pool.stats().size).toBeGreaterThan(0);

    await pool.shutdown();
  });

  it("re-initializes the pool when every slot has been lost (size reaches 0)", async () => {
    // 2-slot pool. Both browsers crash and EVERY relaunch attempt fails for
    // both slots, driving the pool to size 0 so the backstop reinit() path
    // is actually exercised. Each slot makes RELAUNCH_MAX_ATTEMPTS (=3)
    // launch calls during recycle, so for 2 slots that is launch calls 3..8
    // (init used calls 1 and 2). Failing 3..8 exhausts all retries and
    // evicts both slots to leave size 0. Call 9 (the reinit) succeeds.
    const { launchBrowser, launched } = makeFakeLauncher({
      failAtCalls: [3, 4, 5, 6, 7, 8],
    });
    const { logger } = makeFakeLogger();
    const pool = new BrowserPool(2, 100, logger, launchBrowser);
    await pool.init();
    expect(launched).toHaveLength(2);

    launched[0]!.__crash();
    launched[1]!.__crash();
    // The recycle uses real setTimeout backoff between attempts, so give it
    // a wall-clock window to exhaust all retries and park/evict both slots.
    await waitFor(() => pool.stats().size === 0, 5_000);

    // Precondition: prove the pool actually drained to zero so reinit() is
    // the path under test (the old [3,4] fixture self-healed on attempt 2
    // and never reached this state — the test was vacuous).
    expect(pool.stats().size).toBe(0);

    // With size 0, the next acquire() must trigger the backstop reinit
    // (launch call 9 succeeds) and hand back a live browser instead of
    // hanging until timeout.
    const acquired = await pool.acquire(5_000);
    expect(acquired).toBeDefined();
    expect((acquired as unknown as FakeBrowser).isConnected()).toBe(true);
    expect(pool.stats().size).toBeGreaterThan(0);

    await pool.shutdown();
  });

  it("delivers a fresh browser to a parked waiter once a deferred relaunch succeeds, without a second acquire()", async () => {
    // Single-slot pool. The browser crashes and EVERY immediate relaunch
    // attempt fails (launch calls 2..4 — RELAUNCH_MAX_ATTEMPTS=3), so the
    // slot is parked relaunchPending and the original acquire() is left as a
    // queued waiter. A LATER launch (call 5) succeeds. The waiter must be
    // served by the deferred/rescheduled relaunch WITHOUT the test issuing a
    // second acquire() to drive recovery (guards bug #1 and #3).
    const { launchBrowser, launched } = makeFakeLauncher({
      failAtCalls: [2, 3, 4],
    });
    const { logger } = makeFakeLogger();
    const pool = new BrowserPool(1, 100, logger, launchBrowser);
    await pool.init();
    expect(launched).toHaveLength(1);

    // Hand out the only browser, then crash it while held. The disconnect
    // recycle relaunches but calls 2..4 all fail, parking the slot.
    const held = await pool.acquire();
    expect(held).toBe(launched[0] as unknown as Browser);
    (held as unknown as FakeBrowser).__crash();

    // Park an acquire as a waiter. With the only slot dead/pending and no
    // available browser, this returns a pending promise.
    const waiterPromise = pool.acquire(5_000);

    // Do NOT call acquire() again. The deferred relaunch must reschedule
    // (call 5 succeeds) and hand the fresh browser directly to the waiter.
    const recovered = await waiterPromise;
    expect(recovered).toBeDefined();
    expect((recovered as unknown as FakeBrowser).isConnected()).toBe(true);
    expect((recovered as unknown as FakeBrowser).__id).toBe(
      launched[launched.length - 1]!.__id,
    );

    await pool.shutdown();
  });

  it("does not double-publish a relaunchPending slot when recovery is driven concurrently", async () => {
    // Drive a single slot into relaunchPending (all immediate retries fail),
    // then trigger TWO concurrent recovery drivers: a deferred relaunch (a
    // queued waiter schedules it) racing an acquire()-driven relaunch. With a
    // re-entry guard the slot is launched exactly once and its fresh browser
    // is handed to exactly one acquirer — never published to `available`
    // twice nor handed to two probes (guards bug #2).
    const { launchBrowser, launched } = makeFakeLauncher({
      failAtCalls: [2, 3, 4],
    });
    const { logger } = makeFakeLogger();
    const pool = new BrowserPool(1, 100, logger, launchBrowser);
    await pool.init();

    const held = await pool.acquire();
    (held as unknown as FakeBrowser).__crash();
    // Let the immediate recycle retries (calls 2..4) exhaust and park the
    // slot as relaunchPending before we drive concurrent recovery.
    await waitFor(() => pool.stats().available === 0, 3_000).catch(() => {});

    // Two acquirers race for the single recovering slot. The fresh browser
    // must go to exactly one of them; the loser stays parked as a waiter.
    const a = pool.acquire(5_000);
    const b = pool.acquire(5_000);

    const first = await Promise.race([a, b]);
    expect(first).toBeDefined();
    expect((first as unknown as FakeBrowser).isConnected()).toBe(true);

    // Exactly one fresh browser (the successful relaunch, call 5) was
    // created beyond init — no leaked second launch from a re-entrant relaunch.
    const freshBeyondInit = launched.slice(1);
    expect(freshBeyondInit.length).toBe(1);

    // The single slot must never appear twice in `available`.
    expect(pool.stats().available).toBeLessThanOrEqual(1);
    expect(pool.stats().size).toBe(1);

    await pool.shutdown();
    // The loser waiter rejects on shutdown; swallow it.
    await Promise.allSettled([a, b]);
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
