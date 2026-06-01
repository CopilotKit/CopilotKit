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
  /**
   * Re-fire the `disconnected` event WITHOUT touching `isConnected`. Models a
   * delayed/duplicate disconnect delivery for an already-dead browser — e.g.
   * Playwright drains a late `disconnected` for an OLD browser instance after
   * the slot has already been parked and is being relaunched. `__crash` can
   * only fire once (it no-ops when already disconnected), so this is the hook
   * for the "late disconnect races concurrent relaunch" race.
   */
  __fireDisconnectLate(): void;
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
    __fireDisconnectLate() {
      fire("disconnected");
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

interface LeveledLog extends CapturedLog {
  level: "info" | "warn" | "error";
}

/**
 * Fake logger that captures the SEVERITY each event was emitted at. Unlike
 * `makeFakeLogger` (info-only), this exposes `warn`/`error` so routing-by-
 * severity is observable: a capacity-loss event logged via `logger.error(...)`
 * must show up with `level: "error"`, never `level: "info"`.
 */
function makeLeveledLogger(): {
  logger: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
  };
  events: LeveledLog[];
} {
  const events: LeveledLog[] = [];
  return {
    logger: {
      info(msg, meta) {
        events.push({ level: "info", event: msg, meta });
      },
      warn(msg, meta) {
        events.push({ level: "warn", event: msg, meta });
      },
      error(msg, meta) {
        events.push({ level: "error", event: msg, meta });
      },
    },
    events,
  };
}

/**
 * Flush pending microtasks `times` times so post-recycle state settles
 * enough to observe without tearing the pool down. It does NOT advance real
 * `setTimeout` backoff timers — tests that depend on backoff elapsing use
 * `waitFor` instead.
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
    const pool = new BrowserPool(2, 100, logger, launchBrowser, 0);
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
    const pool = new BrowserPool(2, 100, logger, launchBrowser, 0);
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
    const pool = new BrowserPool(2, 100, undefined, launchBrowser, 0);
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
    const pool = new BrowserPool(1, 100, undefined, launchBrowser, 0);
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
    const pool = new BrowserPool(1, 100, undefined, launchBrowser, 0);
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
    const pool = new BrowserPool(1, 100, logger, launchBrowser, 0);
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

  it("does not double-publish a slot to available when the same live browser is released twice", async () => {
    // Bug #1 guard. release(browser) looks the slot up via browserToSlot; a
    // still-live slot (not recycled) survives a SECOND release(sameBrowser),
    // and the no-waiter branch used to `this.available.push(slot)`
    // UNCONDITIONALLY — so the slot appeared twice in `available` and the next
    // two acquires handed the SAME browser to two probes. handOff already
    // guards this with `!this.available.includes(slot)`; release must too.
    // Single-slot pool so the only slot's publication count is directly
    // observable: a double-push duplicates the SOLE slot in `available`.
    const { launchBrowser, launched } = makeFakeLauncher();
    const pool = new BrowserPool(1, 100, undefined, launchBrowser, 0);
    await pool.init();

    const browser = await pool.acquire();
    expect(browser).toBe(launched[0] as unknown as Browser);

    // Double-release the SAME live browser. The second release must be a
    // no-op for `available` (the slot is already queued) — not a second push.
    pool.release(browser);
    pool.release(browser);

    // The single slot must appear in `available` exactly once after the
    // double-release — never twice.
    expect(pool.stats().available).toBe(1);

    // First acquire draws the (single) slot, emptying `available`. With the
    // double-push the duplicate would remain, so a SECOND immediate acquire
    // would wrongly hand out the SAME browser to a concurrent probe; with the
    // guard `available` is empty and the second acquire parks as a waiter.
    const first = await pool.acquire();
    expect(first).toBe(launched[0] as unknown as Browser);

    await expect(pool.acquire(50)).rejects.toThrow(
      "BrowserPool acquire timeout",
    );

    await pool.shutdown();
  });

  it("does not hand the SAME live browser to two waiters when it is released twice while waiters are queued", async () => {
    // Bug guard (idempotent release on the WAITER path). release(browser)
    // routes a live return through handOff(slot, slot.browser). handOff's
    // waiter branch is `const w = this.waiters.shift(); if (w) w.resolve(b)`
    // with NO idempotency guard. A SECOND release(sameLiveBrowser) still finds
    // the slot in browserToSlot (a live slot is never deleted), passes the
    // contextCount/isConnected checks, calls handOff again, shifts a SECOND
    // waiter and resolves it with the SAME browser — two probes driving one
    // chromium. The existing `!available.includes(slot)` guard only covers the
    // NO-waiter branch; the waiter branch was unguarded. Checked-out tracking
    // makes the second release a no-op on BOTH paths.
    //
    // Single-slot pool so the only live browser's publication is directly
    // observable. Acquire it (checking it out), queue TWO waiters, then
    // double-release the SAME browser. Only ONE waiter may be served with it;
    // the second release is a no-op so the second waiter stays pending until
    // its own timeout.
    const { launchBrowser, launched } = makeFakeLauncher();
    const pool = new BrowserPool(1, 100, undefined, launchBrowser, 0);
    await pool.init();

    const browser = await pool.acquire();
    expect(browser).toBe(launched[0] as unknown as Browser);

    // Queue two waiters (no available slots — the only browser is held).
    const waiterA = pool.acquire(5_000);
    const waiterB = pool.acquire(150);
    await drainMicrotasks();

    // Double-release the SAME live browser. The first release serves waiterA;
    // the second MUST be a no-op (the slot is no longer checked out), so it
    // must NOT shift and resolve waiterB with the same browser.
    pool.release(browser);
    pool.release(browser);

    const settled = await Promise.allSettled([waiterA, waiterB]);
    // waiterA was served with the live browser.
    expect(settled[0]!.status).toBe("fulfilled");
    expect((settled[0] as PromiseFulfilledResult<Browser>).value).toBe(
      launched[0] as unknown as Browser,
    );
    // waiterB must NOT have been resolved with the same browser — it stays
    // pending and times out. With the bug it would resolve with launched[0].
    expect(settled[1]!.status).toBe("rejected");
    expect((settled[1] as PromiseRejectedResult).reason).toMatchObject({
      message: "BrowserPool acquire timeout",
    });

    // Exactly one browser was ever launched — no fresh one, and the single one
    // was handed to exactly one waiter.
    expect(launched).toHaveLength(1);

    await pool.shutdown();
  });

  it("reports stats().inUse from actually-checked-out slots, decrementing on release", async () => {
    // inUse must reflect slots currently handed to a caller, derived from the
    // checked-out set, not the `liveSlots.length - available` subtraction.
    const { launchBrowser } = makeFakeLauncher();
    const pool = new BrowserPool(2, 100, undefined, launchBrowser, 0);
    await pool.init();

    expect(pool.stats().inUse).toBe(0);
    expect(pool.stats().available).toBe(2);

    const a = await pool.acquire();
    expect(pool.stats().inUse).toBe(1);
    expect(pool.stats().available).toBe(1);

    const b = await pool.acquire();
    expect(pool.stats().inUse).toBe(2);
    expect(pool.stats().available).toBe(0);

    pool.release(a);
    expect(pool.stats().inUse).toBe(1);
    expect(pool.stats().available).toBe(1);

    // Idempotent: a second release of the same browser must not drive inUse
    // negative or otherwise corrupt the count.
    pool.release(a);
    expect(pool.stats().inUse).toBe(1);
    expect(pool.stats().available).toBe(1);

    pool.release(b);
    expect(pool.stats().inUse).toBe(0);
    expect(pool.stats().available).toBe(2);

    await pool.shutdown();
  });

  it("recovers after a transient relaunch failure instead of permanently shrinking the pool to 0", async () => {
    // Single-slot pool. The browser crashes; the recycle's relaunch fails
    // ONCE (the 2nd launch call), then a subsequent launch succeeds. The
    // pool must NOT permanently evict the slot — it must keep capacity and
    // self-heal so a later acquire() still returns a live browser.
    const { launchBrowser, launched } = makeFakeLauncher({ failAtCalls: [2] });
    const { logger } = makeFakeLogger();
    const pool = new BrowserPool(1, 100, logger, launchBrowser, 0);
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

  it("does not hand a queued waiter a browser that is already disconnected at handoff time", async () => {
    // Bug #2 guard. The acquire() available-scan recycles a zombie before
    // handing it out, but the WAITER-served path (handOff) used to
    // `waiter.resolve(browser)` with NO liveness check. So a browser that
    // silently disconnected in the window between launch and handoff could be
    // delivered to a waiting probe. handOff (and release's waiter branch) must
    // check `browser.isConnected()` before resolving; if dead, recycle the
    // slot and leave the waiter queued so a LIVE browser serves it.
    //
    // Single-slot pool. Crash the only browser to drive a recycle. The
    // recycle's first relaunch (call 2) returns a browser that is BORN DEAD
    // (silently disconnected the instant it is launched), so at handOff time
    // it reports isConnected() === false. A waiter is queued before the
    // handoff. The waiter must NOT be resolved with the dead browser; instead
    // the slot recycles again and call 3 (a live browser) serves the waiter.
    const launched: FakeBrowser[] = [];
    let callCount = 0;
    let releaseRelaunch: (() => void) | undefined;
    const relaunchGate = new Promise<void>((resolve) => {
      releaseRelaunch = resolve;
    });
    const launchBrowser: LaunchBrowser = async () => {
      callCount++;
      const b = makeFakeBrowser();
      launched.push(b);
      if (callCount === 2) {
        // The recycle replacement is born dead: it launches, then silently
        // disconnects before the pool hands it to the waiter. Gate it so we
        // can queue a waiter before the handoff runs.
        await relaunchGate;
        b.__silentlyDisconnect();
      }
      return b as unknown as Browser;
    };
    const { logger } = makeFakeLogger();
    const pool = new BrowserPool(1, 100, logger, launchBrowser, 0);
    await pool.init();
    expect(launched).toHaveLength(1);

    // Crash the only browser; the disconnect-driven recycle starts and its
    // relaunch (call 2) blocks on the gate.
    launched[0]!.__crash();
    await waitFor(() => callCount >= 2, 3_000);

    // Queue a waiter while the (born-dead) relaunch is gated. acquire sees no
    // available slot and parks this waiter.
    const acquirePromise = pool.acquire(5_000);
    await drainMicrotasks(10);

    // Release the gated relaunch. The fresh browser is born dead, so handOff
    // must NOT resolve the waiter with it — it parks the slot relaunchPending
    // (the slot is busy in the recycle path) and leaves the waiter QUEUED.
    releaseRelaunch!();
    await drainMicrotasks(20);

    // The recycle path is busy at handoff time, so recovery is lazy: a
    // subsequent acquire() drives relaunchPendingSlots, relaunches (call 3 —
    // live), and serves the still-queued ORIGINAL waiter via handOff (FIFO).
    // This second acquire's own waiter then times out (single slot already
    // re-held), but the original `acquirePromise` resolves with the LIVE
    // browser. (Driving recovery on the next probe tick is the pool's
    // intended lazy-recovery contract.)
    const second = pool.acquire(50);

    const acquired = await acquirePromise;
    expect((acquired as unknown as FakeBrowser).isConnected()).toBe(true);
    // The waiter was served a LIVE browser, never the born-dead call-2 one.
    expect((acquired as unknown as FakeBrowser).__id).not.toBe(
      launched[1]!.__id,
    );

    await expect(second).rejects.toThrow("BrowserPool acquire timeout");

    await pool.shutdown();
  });

  it("recovers a fully-parked pool (all slots relaunchPending, size 0) via the lazy relaunchPendingSlots path on the next acquire", async () => {
    // 2-slot pool. Both browsers crash and EVERY immediate relaunch attempt
    // fails for both slots. Each slot makes RELAUNCH_MAX_ATTEMPTS (=3) launch
    // calls during recycle, so for 2 slots that is launch calls 3..8 (init
    // used calls 1 and 2). Failing 3..8 exhausts every immediate retry and
    // parks BOTH slots as `relaunchPending` — they are NOT evicted from
    // `this.slots` (capacity is preserved), so `stats().size` reads 0 during
    // the outage while the slots stay parked. Recovery is therefore via the
    // lazy `relaunchPendingSlots()` path on the next acquire (launch call 9
    // succeeds), NOT the `reinit()` backstop (which only fires when
    // `this.slots` is truly empty). This test asserts that actual mechanism.
    const { launchBrowser, launched } = makeFakeLauncher({
      failAtCalls: [3, 4, 5, 6, 7, 8],
    });
    const { logger } = makeFakeLogger();
    const pool = new BrowserPool(2, 100, logger, launchBrowser, 0);
    await pool.init();
    expect(launched).toHaveLength(2);

    launched[0]!.__crash();
    launched[1]!.__crash();
    // The recycle uses real setTimeout backoff between attempts, so give it
    // a wall-clock window to exhaust all retries and park both slots.
    await waitFor(() => pool.stats().size === 0, 5_000);

    // Precondition: every slot is parked, so live capacity (`size`) reads 0
    // during the outage. The slots themselves are retained — recovery comes
    // through the relaunchPending path, not a from-scratch reinit.
    expect(pool.stats().size).toBe(0);

    // The next acquire() recovers the parked slots via relaunchPendingSlots
    // (launch call 9 succeeds) and hands back a live browser instead of
    // hanging until timeout. `size` returns to non-zero once recovered.
    const acquired = await pool.acquire(5_000);
    expect(acquired).toBeDefined();
    expect((acquired as unknown as FakeBrowser).isConnected()).toBe(true);
    expect(pool.stats().size).toBeGreaterThan(0);

    await pool.shutdown();
  });

  it("recovers a parked slot on the next acquire() after every immediate relaunch failed", async () => {
    // Single-slot pool. The browser crashes and EVERY immediate relaunch
    // attempt fails (launch calls 2..4 — RELAUNCH_MAX_ATTEMPTS=3), so the slot
    // is parked relaunchPending. There is no background timer to recover it;
    // recovery is lazy. A LATER launch (call 5) succeeds, and the NEXT
    // acquire() must drive `relaunchPendingSlots()` to relaunch the slot and
    // hand back a fresh, connected browser. This replaces the old
    // deferred-timer test that asserted a waiter was served WITHOUT a second
    // acquire() — that behavior intentionally no longer holds.
    const { launchBrowser, launched } = makeFakeLauncher({
      failAtCalls: [2, 3, 4],
    });
    const { logger } = makeFakeLogger();
    const pool = new BrowserPool(1, 100, logger, launchBrowser, 0);
    await pool.init();
    expect(launched).toHaveLength(1);

    // Hand out the only browser, then crash it while held. The disconnect
    // recycle relaunches but calls 2..4 all fail, parking the slot.
    const held = await pool.acquire();
    expect(held).toBe(launched[0] as unknown as Browser);
    (held as unknown as FakeBrowser).__crash();

    // Wait until the recycle has fully exhausted its immediate retries and
    // parked the slot — live capacity reads 0 and nothing is recovering it.
    await waitFor(() => pool.stats().size === 0, 3_000);

    // The next acquire() drives the lazy recovery: relaunchPendingSlots
    // re-attempts the launch (call 5 succeeds) and the parked/waiting caller
    // gets a fresh connected browser.
    const recovered = await pool.acquire(5_000);
    expect(recovered).toBeDefined();
    expect((recovered as unknown as FakeBrowser).isConnected()).toBe(true);
    expect((recovered as unknown as FakeBrowser).__id).toBe(
      launched[launched.length - 1]!.__id,
    );

    await pool.shutdown();
  });

  it("does not double-publish a relaunchPending slot when recovery is driven concurrently", async () => {
    // Drive a single slot into relaunchPending (all immediate retries fail),
    // then trigger TWO concurrent acquire()-driven relaunches racing for the
    // same slot. With a re-entry guard the slot is launched exactly once and
    // its fresh browser is handed to exactly one acquirer — never published to
    // `available` twice nor handed to two probes (guards bug #2).
    const { launchBrowser, launched } = makeFakeLauncher({
      failAtCalls: [2, 3, 4],
    });
    const { logger } = makeFakeLogger();
    // Stagger 0 keeps the test fast; the launch-serialization gate's
    // concurrency-1 guarantee (the property under test here, that the slot is
    // launched exactly once) holds independent of the stagger length.
    const pool = new BrowserPool(1, 100, logger, launchBrowser, 0);
    await pool.init();

    const held = await pool.acquire();
    (held as unknown as FakeBrowser).__crash();
    // Let the immediate recycle retries (calls 2..4) exhaust and PARK the slot
    // as relaunchPending before we drive concurrent recovery. We wait on
    // `size === 0` (slot parked, recycle fully done) rather than
    // `available === 0` — `available` is already 0 the instant the only
    // browser was handed out, so it would let the race start while the recycle
    // is still in flight and the slot is not yet pending. No `.catch` swallow
    // here — if the precondition never settles, the test must fail loudly
    // rather than proceed on stale state.
    await waitFor(() => pool.stats().size === 0, 3_000);

    // Two acquirers race for the single recovering slot, each driving
    // relaunchPendingSlots. With the launch-serialization gate, exactly one of
    // them claims the slot (relaunchingSlots) and drives the single gated
    // launch; the other skips (slot busy) and parks as a waiter. The freshly
    // launched browser is handed off to one of the two — the WINNER — and the
    // LOSER is left parked. The loser uses a SHORT timeout so this test stays
    // fast: a parked waiter is only rejected by `shutdown()`, and the gate's
    // extra `await` can let the loser register its waiter AFTER `shutdown()`
    // has already drained the waiter set, in which case only its own timeout
    // frees it. We assert the WINNER got exactly the one fresh launch; the
    // loser's fate (short-timeout reject) is not the property under test.
    const a = pool.acquire(150);
    const b = pool.acquire(150);

    const settled = await Promise.allSettled([a, b]);
    const fulfilled = settled.filter(
      (s): s is PromiseFulfilledResult<Browser> => s.status === "fulfilled",
    );
    // Exactly one acquirer was served (the single slot can serve only one
    // before being re-held); the other parked and timed out.
    expect(fulfilled).toHaveLength(1);
    const first = fulfilled[0]!.value;
    expect((first as unknown as FakeBrowser).isConnected()).toBe(true);

    // Exactly one fresh browser (the successful relaunch, call 5) was
    // created beyond init — no leaked second launch from a re-entrant relaunch.
    const freshBeyondInit = launched.slice(1);
    expect(freshBeyondInit.length).toBe(1);

    // Exact-once: the browser handed to the winning acquirer must BE that
    // single fresh launch. Asserting only `length === 1` can pass even if the
    // winner were served some other instance; pinning the id proves the slot
    // was launched once and that launch is exactly what got served.
    expect((first as unknown as FakeBrowser).__id).toBe(
      freshBeyondInit[0]!.__id,
    );

    // The single slot must never appear twice in `available`.
    expect(pool.stats().available).toBeLessThanOrEqual(1);
    expect(pool.stats().size).toBe(1);

    await pool.shutdown();
  });

  it("recovers a parked slot via a later acquire() even when an intervening acquire()'s relaunch also failed", async () => {
    // Lazy-recovery guard. A single-slot pool. The browser crashes via a
    // `disconnected` event while NO acquire is waiting. The recycle exhausts
    // all immediate retries (calls 2..4 fail) and parks the slot
    // relaunchPending. There is no background timer — recovery is purely
    // acquire()-driven.
    //
    // A first acquire()'s leading relaunchPendingSlots() attempt (call 5) ALSO
    // fails, so that acquire parks a waiter and eventually times out (no timer
    // re-arms recovery). A LATER acquire() then drives relaunchPendingSlots
    // again (call 6 succeeds) and gets the fresh connected browser. This proves
    // the on-demand recovery is robust to a failed intervening relaunch — the
    // harness probes continuously, so a subsequent probe tick recovers.
    const { launchBrowser, launched } = makeFakeLauncher({
      failAtCalls: [2, 3, 4, 5],
    });
    const { logger } = makeFakeLogger();
    const pool = new BrowserPool(1, 100, logger, launchBrowser, 0);
    await pool.init();
    expect(launched).toHaveLength(1);

    // Crash the idle browser. The recycle exhausts immediate retries and parks
    // the slot relaunchPending (no waiter queued, no timer to recover it).
    launched[0]!.__crash();
    // Wait until the recycle has fully exhausted its immediate retries and
    // parked the slot — i.e. live capacity reads 0.
    await waitFor(() => pool.stats().size === 0, 3_000);

    // First acquire(): its leading relaunchPendingSlots attempt is call 5,
    // which fails, so it parks a waiter that hits its (short) timeout — no
    // timer re-arms recovery, which is the intended lazy behavior.
    await expect(pool.acquire(50)).rejects.toThrow(
      "BrowserPool acquire timeout",
    );

    // A LATER acquire() drives relaunchPendingSlots again; call 6 succeeds and
    // the parked slot is recovered with a fresh connected browser.
    const recovered = await pool.acquire(5_000);
    expect(recovered).toBeDefined();
    expect((recovered as unknown as FakeBrowser).isConnected()).toBe(true);
    expect((recovered as unknown as FakeBrowser).__id).toBe(
      launched[launched.length - 1]!.__id,
    );

    await pool.shutdown();
  });

  it("launches exactly one fresh browser when a late disconnect for an OLD browser races relaunchPendingSlots relaunching the same slot", async () => {
    // Bug #2 guard. A slot parked relaunchPending still holds its OLD (dead)
    // browser as slot.browser and is still in this.slots. relaunchPendingSlots
    // begins relaunching it (slot enters relaunchingSlots, NOT recyclingSlots).
    // While that relaunch is in flight, a LATE `disconnected` fire for the OLD
    // browser passes the disconnect handler's guards (slot.browser === old,
    // slots.includes(slot)) and reaches recycleSlot. The OLD guard only
    // consulted recyclingSlots, so recycleSlot would proceed and launch a
    // SECOND fresh browser — leaking one process / double-swapping slot.browser.
    // isSlotBusy (which also checks relaunchingSlots) must make recycleSlot a
    // no-op so exactly ONE fresh browser is launched and not double-published.
    //
    // Deterministic race: gate the relaunchPendingSlots launch so the slot is
    // mid-relaunch (in relaunchingSlots) when we re-fire the old disconnect.
    const launched: FakeBrowser[] = [];
    let callCount = 0;
    let releaseRelaunch: (() => void) | undefined;
    const relaunchGate = new Promise<void>((resolve) => {
      releaseRelaunch = resolve;
    });
    // init = call 1; recycle's 3 immediate retries = calls 2..4 (all fail) to
    // park the slot; the relaunchPendingSlots relaunch = call 5, which we gate.
    const failCalls = new Set([2, 3, 4]);
    const launchBrowser: LaunchBrowser = async () => {
      callCount++;
      if (failCalls.has(callCount)) {
        throw new Error("simulated launch failure");
      }
      if (callCount === 5) {
        await relaunchGate;
      }
      const b = makeFakeBrowser();
      launched.push(b);
      return b as unknown as Browser;
    };
    const { logger } = makeFakeLogger();
    const pool = new BrowserPool(1, 100, logger, launchBrowser, 0);
    await pool.init();
    expect(launched).toHaveLength(1);
    const oldBrowser = launched[0]!;

    // Crash the only browser. The disconnect-driven recycle relaunches, but
    // calls 2..4 all fail, parking the slot relaunchPending. slot.browser is
    // still oldBrowser (no successful swap), and the slot remains in
    // this.slots — so a future disconnect for oldBrowser is still routed here.
    oldBrowser.__crash();
    await waitFor(() => pool.stats().size === 0, 3_000);

    // Drive relaunchPendingSlots via an acquire(): it picks the pending slot,
    // adds it to relaunchingSlots, and awaits the gated launch (call 5).
    const acquirePromise = pool.acquire(5_000);
    await drainMicrotasks(10);

    // Now fire a LATE disconnect for the OLD browser while the relaunch is
    // gated and the slot sits in relaunchingSlots (but NOT recyclingSlots).
    // `__crash` already fired once and no-ops now, so re-fire the event
    // directly to model the delayed delivery. Without the cross-set guard this
    // re-enters recycleSlot and launches a second browser; with isSlotBusy it
    // is a no-op (slot.browser is still oldBrowser, so handler guards pass).
    oldBrowser.__fireDisconnectLate();
    await drainMicrotasks(10);

    // Release the gated relaunch; the single fresh browser is delivered.
    releaseRelaunch!();
    const acquired = await acquirePromise;
    expect(acquired).toBeDefined();
    expect((acquired as unknown as FakeBrowser).isConnected()).toBe(true);

    // Let any erroneously-spawned second recycle settle so a leak would show.
    await drainMicrotasks(20);

    // Exactly ONE fresh browser beyond init — the late disconnect did not
    // launch a second. No leaked process, no double-publish.
    const freshBeyondInit = launched.slice(1);
    expect(freshBeyondInit.length).toBe(1);
    expect((acquired as unknown as FakeBrowser).__id).toBe(
      freshBeyondInit[0]!.__id,
    );
    expect(pool.stats().available).toBeLessThanOrEqual(1);
    expect(pool.stats().size).toBe(1);

    await pool.shutdown();
  });

  it("launches exactly one fresh browser per slot when two pending slots are recovered by two concurrent relaunchPendingSlots invocations", async () => {
    // Bug #1 guard (multi-slot reachable double-launch). relaunchPendingSlots
    // snapshots `pending` ONCE then loops. With >=2 pending slots and two
    // concurrent acquire()-driven invocations:
    //   - invocation 1 snapshots [A, B], processes A (adds A to
    //     relaunchingSlots, awaits A's gated launch);
    //   - invocation 2 starts during that await, snapshots [B] (A is now
    //     busy), claims B and relaunches it;
    //   - invocation 1's A launch resolves; its loop advances to B and — with
    //     NO in-loop re-check — re-adds B and launches a SECOND browser for B,
    //     overwriting slot.browser (leaking the first) and double-publishing.
    // The in-loop `if (this.isSlotBusy(slot) || !slot.relaunchPending)
    // continue;` makes invocation 1 skip B, so EXACTLY ONE fresh browser is
    // launched per slot.
    //
    // Deterministic race, ADAPTED for the launch-serialization gate. The gate
    // funnels EVERY launch through a concurrency-1 serializer, so two recovery
    // launches can never be in flight (running rawLaunchBrowser) at the same
    // instant. We therefore gate ONLY the FIRST recovery launch (call 9, slot
    // A driven by invocation 1). While that launch is gated/held, invocation 2
    // runs, snapshots pending as [slot B] (slot A is busy in relaunchingSlots),
    // and CLAIMS slot B (adds it to relaunchingSlots) before its own launch
    // (call 10) queues behind call 9 in the gate chain. Releasing call 9 lets
    // invocation 1's loop advance to slot B — where the in-loop guard
    // `if (this.isSlotBusy(slot) || !slot.relaunchPending) continue;` MUST skip
    // it (B is busy / no longer pending), so EXACTLY ONE fresh browser is
    // launched per slot. Stagger 0 keeps the chain advancing fast.
    const launched: FakeBrowser[] = [];
    let callCount = 0;
    let releaseCall9: (() => void) | undefined;
    const call9Gate = new Promise<void>((resolve) => {
      releaseCall9 = resolve;
    });
    // init = calls 1,2; the two slots' immediate recycle retries
    // (RELAUNCH_MAX_ATTEMPTS=3 each) = calls 3..8, all fail to park both slots.
    // Recovery relaunches are calls 9 (gated) and 10.
    const failCalls = new Set([3, 4, 5, 6, 7, 8]);
    const launchBrowser: LaunchBrowser = async () => {
      callCount++;
      if (failCalls.has(callCount)) {
        throw new Error("simulated launch failure");
      }
      if (callCount === 9) {
        await call9Gate;
      }
      const b = makeFakeBrowser();
      launched.push(b);
      return b as unknown as Browser;
    };
    const { logger } = makeFakeLogger();
    const pool = new BrowserPool(2, 100, logger, launchBrowser, 0);
    await pool.init();
    expect(launched).toHaveLength(2);

    // Park BOTH slots as relaunchPending: crash both, let all immediate
    // retries (calls 3..8) exhaust. Live capacity drops to 0 while both slots
    // stay in this.slots.
    launched[0]!.__crash();
    launched[1]!.__crash();
    await waitFor(() => pool.stats().size === 0, 5_000);
    expect(pool.stats().size).toBe(0);

    // Drive two concurrent relaunchPendingSlots invocations via two acquire()s.
    // Invocation 1 (a) snapshots [slotA, slotB], claims slotA, and its slotA
    // launch (call 9) blocks on the gate. Invocation 2 (b) then runs: it
    // snapshots [slotB] (slotA busy), claims slotB, and its slotB launch (call
    // 10) is queued in the serialization chain BEHIND the gated call 9.
    const a = pool.acquire(5_000);
    const b = pool.acquire(5_000);

    // Wait until call 9 is actually in flight (gated) — i.e. invocation 1 has
    // claimed slotA and reached its launch. By this point invocation 2 has had
    // the chance to claim slotB. Drain microtasks so invocation 2's synchronous
    // claim-then-queue has run before we release call 9.
    await waitFor(() => callCount >= 9, 3_000);
    await drainMicrotasks(30);

    // Release call 9. Invocation 1's slotA launch resolves; its loop advances
    // to slotB. WITHOUT the in-loop guard it would launch a SECOND browser for
    // slotB (a 3rd launch, call 11). WITH the guard it skips slotB (busy / no
    // longer pending). Call 10 (invocation 2's slotB launch) then runs.
    releaseCall9!();

    // Both acquirers must be served — one per slot — and exactly two fresh
    // browsers launched beyond init (no leaked third launch for the contended
    // slot).
    const both = await Promise.all([a, b]);
    both.forEach((br) =>
      expect((br as unknown as FakeBrowser).isConnected()).toBe(true),
    );

    await drainMicrotasks(30);

    const freshBeyondInit = launched.slice(2);
    expect(freshBeyondInit.length).toBe(2);
    // No erroneous third launch was ever attempted for the contended slot.
    expect(callCount).toBe(10);

    // Pin exact-once: both acquirers are served by the two fresh launches, and
    // each fresh browser maps to a distinct slot (no slot.browser overwrite).
    const servedIds = both.map((br) => (br as unknown as FakeBrowser).__id);
    const freshIds = freshBeyondInit.map((br) => br.__id);
    expect(new Set(servedIds)).toEqual(new Set(freshIds));

    // Two live slots recovered, never double-published into available.
    expect(pool.stats().size).toBe(2);
    expect(pool.stats().available).toBeLessThanOrEqual(2);

    await pool.shutdown();
    await Promise.allSettled([a, b]);
  });

  it("routes capacity-loss events to error and per-attempt failures to warn", async () => {
    // Single-slot pool. The browser crashes and EVERY immediate relaunch
    // attempt fails (calls 2..4 — RELAUNCH_MAX_ATTEMPTS=3), so each per-attempt
    // close/relaunch failure must log at warn while the terminal capacity-loss
    // event (`recycle-relaunch-failed`) must log at error.
    const { launchBrowser, launched } = makeFakeLauncher({
      failAtCalls: [2, 3, 4],
    });
    const { logger, events } = makeLeveledLogger();
    const pool = new BrowserPool(1, 100, logger, launchBrowser, 0);
    await pool.init();
    expect(launched).toHaveLength(1);

    launched[0]!.__crash();
    await waitFor(() => pool.stats().size === 0, 3_000);

    // Terminal capacity-loss after all retries → error.
    const recycleFailed = events.find(
      (e) => e.event === "browser-pool.recycle-relaunch-failed",
    );
    expect(recycleFailed).toBeDefined();
    expect(recycleFailed?.level).toBe("error");

    // The capacity-loss event must NOT also have been emitted at info.
    expect(
      events.some(
        (e) =>
          e.event === "browser-pool.recycle-relaunch-failed" &&
          e.level === "info",
      ),
    ).toBe(false);

    await pool.shutdown();
  });

  it("routes per-attempt relaunch-failed (lazy recovery) to warn", async () => {
    // Single-slot pool. Crash + all immediate retries fail (calls 2..4) parks
    // the slot. A first acquire's lazy relaunchPendingSlots attempt (call 5)
    // ALSO fails → `relaunch-failed` must log at warn (per-attempt, not a
    // terminal capacity loss).
    const { launchBrowser, launched } = makeFakeLauncher({
      failAtCalls: [2, 3, 4, 5],
    });
    const { logger, events } = makeLeveledLogger();
    const pool = new BrowserPool(1, 100, logger, launchBrowser, 0);
    await pool.init();

    launched[0]!.__crash();
    await waitFor(() => pool.stats().size === 0, 3_000);

    // First acquire drives a relaunchPendingSlots attempt (call 5) which fails.
    await expect(pool.acquire(50)).rejects.toThrow(
      "BrowserPool acquire timeout",
    );

    const relaunchFailed = events.find(
      (e) => e.event === "browser-pool.relaunch-failed",
    );
    expect(relaunchFailed).toBeDefined();
    expect(relaunchFailed?.level).toBe("warn");

    await pool.shutdown();
  });

  it("emits an error when reinit ends with an empty pool (every relaunch failed)", async () => {
    // 1-slot pool. After init (call 1), every subsequent launch fails. The
    // backstop reinit() can only run when this.slots is truly empty, so we
    // construct a never-launched pool: init throws nothing (call 1 succeeds),
    // but to reach the empty-pool reinit path we use a 1-slot pool whose ONLY
    // slot was never created because init's launch failed. Use failAt=1 so
    // init launches nothing, leaving this.slots empty; the next acquire drives
    // reinit, whose launch (call 2) also fails, ending the pool empty → error.
    const { launchBrowser } = makeFakeLauncher({ failAtCalls: [1, 2, 3] });
    const { logger, events } = makeLeveledLogger();
    const pool = new BrowserPool(1, 100, logger, launchBrowser, 0);
    // init's only launch (call 1) throws — init sets `launchBrowser` BEFORE the
    // launch loop, so after catching the throw `this.slots` is empty but the
    // pool can still reinit. (init does not swallow launch errors by design.)
    await expect(pool.init()).rejects.toThrow("simulated launch failure");
    expect(pool.stats().size).toBe(0);

    // acquire drives the empty-pool reinit backstop; its launch (call 2) fails,
    // so reinitInner's loop ends with this.slots.length === 0 → error emit.
    await expect(pool.acquire(50)).rejects.toThrow(
      "BrowserPool acquire timeout",
    );

    const reinitEmpty = events.find(
      (e) => e.event === "browser-pool.reinit-empty",
    );
    expect(reinitEmpty).toBeDefined();
    expect(reinitEmpty?.level).toBe("error");

    await pool.shutdown();
  });

  it("closes browsers already launched when a later init() fill launch throws", async () => {
    // Multi-slot pool. The fill loop launches calls 1 and 2 successfully, then
    // call 3 throws (PID-ceiling pthread_create EAGAIN / "Zygote could not
    // fork" under launch pressure — the exact failure this file exists to
    // survive). init() must REJECT, but the 2 browsers already launched must
    // be CLOSED rather than leaked, and the pool's internal state must reset to
    // empty so a half-initialized pool cannot result. The existing init-failure
    // tests use a 1-slot pool or first-launch-fails (nothing launched yet),
    // which is why this partial-fill leak was missed.
    const { launchBrowser, launched } = makeFakeLauncher({ failAtCalls: [3] });
    const { logger } = makeLeveledLogger();
    const pool = new BrowserPool(4, 100, logger, launchBrowser, 0);

    await expect(pool.init()).rejects.toThrow("simulated launch failure");

    // Calls 1 and 2 succeeded before call 3 threw, so two browsers were live.
    expect(launched).toHaveLength(2);
    // Both must have been closed during the failed-fill cleanup — not leaked.
    expect(launched[0]!.__closeCount).toBeGreaterThan(0);
    expect(launched[1]!.__closeCount).toBeGreaterThan(0);
    // The pool must be empty after rejection — no half-initialized state.
    expect(pool.stats().size).toBe(0);
    expect(pool.stats().available).toBe(0);
  });

  it("does not overshoot poolSize when two concurrent acquires hit an empty pool", async () => {
    // Empty pool (init launches nothing). Two concurrent acquire() calls both
    // see this.slots.length === 0. WITHOUT a reiniting guard, BOTH drive
    // reinit() and each launches up to poolSize browsers — overshoot. WITH the
    // guard, the second acquire skips reinit and falls through to the waiter
    // queue, so at most poolSize browsers are launched.
    const poolSize = 2;
    // init = call 1 fails (so this.slots stays empty); reinit launches succeed.
    const { launchBrowser, launched } = makeFakeLauncher({ failAtCalls: [1] });
    const { logger } = makeLeveledLogger();
    const pool = new BrowserPool(poolSize, 100, logger, launchBrowser, 0);
    // init's first launch (call 1) throws, leaving this.slots empty but with
    // `launchBrowser` already set so reinit can run. init does not swallow.
    await expect(pool.init()).rejects.toThrow("simulated launch failure");
    expect(pool.stats().size).toBe(0);

    const a = pool.acquire(5_000);
    const b = pool.acquire(5_000);

    const first = await Promise.race([a, b]);
    expect(first).toBeDefined();
    expect((first as unknown as FakeBrowser).isConnected()).toBe(true);

    await drainMicrotasks(30);

    // The guard ensures only ONE reinit ran: at most poolSize browsers exist.
    expect(launched.length).toBeLessThanOrEqual(poolSize);
    expect(pool.stats().size).toBeLessThanOrEqual(poolSize);

    await pool.shutdown();
    await Promise.allSettled([a, b]);
  });

  it("tracks the SAME wrapper object it removes, so awaiting the tracked promise waits for its cleanup", async () => {
    // Bug #3 guard. track(promise) added the RAW inner promise to
    // inFlightRecycles, while the wrapper it returned (and the inner methods
    // await) was `promise.catch(...).finally(() => delete(promise))`. shutdown
    // drains `Array.from(inFlightRecycles)` — i.e. the RAW promise, which
    // settles one or more microtasks BEFORE the wrapper's `.finally` cleanup
    // runs. So a consumer that awaits the EXACT object in the set (as shutdown
    // does) is NOT guaranteed the cleanup has run when that await resolves —
    // the drain under-waits. recycleSlot does this correctly (adds and removes
    // the same recyclePromise object). The fix makes track add/return the SAME
    // wrapper, so the object shutdown awaits is the very wrapper whose
    // `.finally` removes it — when it settles, the cleanup has run.
    //
    // Behavioral RED that does NOT depend on microtask luck: grab the exact
    // object stored in inFlightRecycles (what shutdown awaits), await THAT
    // object, then SYNCHRONOUSLY assert the set is empty. With the fix the set
    // element IS the wrapper, so its `.finally` ran by the time the await
    // resolves → set empty. With the bug the set element is the RAW promise,
    // which resolves BEFORE the wrapper's `.finally` → set still has 1 entry at
    // that synchronous checkpoint. The private set is read reflectively
    // (white-box) per the bug's nature: raw-vs-wrapper is otherwise
    // unobservable because the inner recovery methods swallow their own errors.
    const launched: FakeBrowser[] = [];
    let callCount = 0;
    let releaseReinit: (() => void) | undefined;
    const reinitGate = new Promise<void>((resolve) => {
      releaseReinit = resolve;
    });
    const launchBrowser: LaunchBrowser = async () => {
      callCount++;
      // init's launch (call 1) fails so this.slots stays empty → the next
      // acquire drives the reinit() backstop, whose launch (call 2) we gate.
      if (callCount === 1) {
        throw new Error("simulated launch failure");
      }
      if (callCount === 2) {
        await reinitGate;
      }
      const b = makeFakeBrowser();
      launched.push(b);
      return b as unknown as Browser;
    };
    const { logger } = makeFakeLogger();
    const pool = new BrowserPool(1, 100, logger, launchBrowser, 0);
    // init's only launch (call 1) throws → this.slots empty, but rawLaunchBrowser
    // is set so the empty-pool reinit backstop can run.
    await expect(pool.init()).rejects.toThrow("simulated launch failure");

    // Drive the reinit backstop via an acquire; its launch (call 2) blocks on
    // the gate, so a tracked recovery promise is in flight. A short timeout so
    // the waiter (acquire re-queues after reinit returns) rejects promptly
    // instead of hanging the test.
    const acquirePromise = pool.acquire(100);
    await waitFor(() => callCount >= 2, 3_000);

    const inFlight = (pool as unknown as { inFlightRecycles: Set<unknown> })
      .inFlightRecycles;
    expect(inFlight.size).toBe(1);

    // The exact object shutdown would await — the single tracked entry.
    const tracked = Array.from(inFlight)[0] as Promise<unknown>;

    // Release the gated launch so the tracked recovery settles.
    releaseReinit!();

    // Await the EXACT tracked object, then synchronously check the set. With
    // the fix this object is the wrapper whose `.finally` removed it → empty.
    // With the bug it is the raw promise, which settles before cleanup → not
    // yet empty.
    await tracked;
    expect(inFlight.size).toBe(0);

    await pool.shutdown();
    await Promise.allSettled([acquirePromise]);
  });

  it("shutdown() does not loop the disconnect handler when closing slot browsers", async () => {
    const { launchBrowser, launched } = makeFakeLauncher();
    const { logger, events } = makeFakeLogger();
    const pool = new BrowserPool(2, 100, logger, launchBrowser, 0);
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

/**
 * A launcher that records, for every chromium launch the pool drives, the
 * wall-clock start time and the number of launches in flight at the moment
 * this one entered. Used to prove the launch-serialization gate funnels
 * EVERY launch (init fill, recycle relaunch, lazy relaunchPending) through a
 * single concurrency-1 gate with a stagger between settled launches.
 *
 * `launchDurationMs` makes each fake launch take measurable wall time so an
 * un-gated burst would overlap (inFlight > 1) — the assertion that
 * `maxConcurrent === 1` is only meaningful when launches actually overlap
 * without the gate.
 */
function makeRecordingLauncher(opts?: { launchDurationMs?: number }): {
  launchBrowser: LaunchBrowser;
  starts: number[];
  maxConcurrent: number;
  launched: FakeBrowser[];
} {
  const launchDurationMs = opts?.launchDurationMs ?? 20;
  const starts: number[] = [];
  const launched: FakeBrowser[] = [];
  let inFlight = 0;
  const rec = {
    launchBrowser: (async (): Promise<Browser> => {
      starts.push(Date.now());
      inFlight++;
      if (inFlight > rec.maxConcurrent) rec.maxConcurrent = inFlight;
      await new Promise((resolve) => setTimeout(resolve, launchDurationMs));
      inFlight--;
      const b = makeFakeBrowser();
      launched.push(b);
      return b as unknown as Browser;
    }) as LaunchBrowser,
    starts,
    maxConcurrent: 0,
    launched,
  };
  return rec;
}

describe("BrowserPool waiter-served release-leak (CR finding)", () => {
  it("recovers the slot when the served waiter releases the browser in its own awaited continuation", async () => {
    // CR finding (7-agent confirmation round): release() was made idempotent
    // via the `checkedOut` Set. In handOff's waiter branch the slot's
    // `checkedOut.add(slot)` is DEFERRED via queueMicrotask (microtask M),
    // while `waiter.resolve(browser)` runs synchronously right after. The
    // worry: the served waiter's await-continuation (call it C) calls
    // `release(browser)` BEFORE M runs, so release hits `!checkedOut.has(slot)`
    // → no-ops → the slot is ORPHANED (never returned to `available`,
    // contextCount never advances) = permanent capacity leak.
    //
    // Counter-claim: M is queued BEFORE resolve(), and resolve() schedules C,
    // so by microtask FIFO M runs before C — making the leak unreachable. This
    // test settles that timing claim empirically.
    //
    // Scenario: single-slot pool. A holder owns the only browser; a waiter is
    // parked. The holder releases, which serves the waiter via handOff. In the
    // WAITER'S OWN awaited continuation we immediately (synchronously, in that
    // continuation's frame) release the served browser back to the pool. If the
    // leak is real, that release no-ops and the slot is lost; if FIFO holds, the
    // slot is recovered and lands back in `available`.
    const { launchBrowser, launched } = makeFakeLauncher();
    const pool = new BrowserPool(1, 100, undefined, launchBrowser, 0);
    await pool.init();

    // Holder takes the only browser; slot is now checked out, none available.
    const holderBrowser = await pool.acquire();
    expect(holderBrowser).toBe(launched[0] as unknown as Browser);
    expect(pool.stats().available).toBe(0);
    expect(pool.stats().inUse).toBe(1);

    // Park a waiter. Its continuation models a real probe: await the acquire,
    // then synchronously release the browser it was served — exactly the frame
    // the finding targets (C running before microtask M).
    let waiterReleased = false;
    const waiterFlow = (async () => {
      const servedBrowser = await pool.acquire(5_000);
      // Synchronous release inside the waiter's own continuation frame.
      pool.release(servedBrowser);
      waiterReleased = true;
      return servedBrowser;
    })();

    // Let the waiter park before the holder releases.
    await drainMicrotasks();

    // Holder releases — handOff serves the parked waiter with the live browser,
    // deferring `checkedOut.add(slot)` to microtask M and resolving the waiter
    // synchronously. The waiter's continuation C then releases the browser.
    pool.release(holderBrowser);

    // Drain everything so M and C have both run.
    const servedBrowser = await waiterFlow;
    await drainMicrotasks(20);

    expect(waiterReleased).toBe(true);
    expect(servedBrowser).toBe(launched[0] as unknown as Browser);

    // THE ASSERTION THAT SETTLES IT: the slot must have been RECOVERED by the
    // waiter's release. If the leak is real, available stays 0 and inUse stays
    // pinned at 1 (orphaned slot) — capacity permanently lost.
    expect(pool.stats().available).toBe(1);
    expect(pool.stats().inUse).toBe(0);

    // And the recovered slot must be re-acquirable (back in rotation), proving
    // it is genuinely usable capacity, not a phantom available count.
    const reacquired = await pool.acquire(1_000);
    expect(reacquired).toBe(launched[0] as unknown as Browser);
    expect(pool.stats().inUse).toBe(1);

    // No fresh browser was ever launched — the single one cycled correctly.
    expect(launched).toHaveLength(1);

    await pool.shutdown();
  });
});

describe("BrowserPool launch serialization gate", () => {
  it("serializes the initial-fill burst to concurrency 1 and staggers each launch", async () => {
    // A burst of N near-simultaneous chromium.launch() calls (the initial
    // pool fill) must NOT overlap — on the Railway staging container a burst
    // spikes PID demand past the ~1000 ceiling and trips pthread_create
    // EAGAIN / "Zygote could not fork". The gate funnels every launch through
    // a concurrency-1 serializer and waits a stagger after each settles.
    const staggerMs = 30;
    const rec = makeRecordingLauncher({ launchDurationMs: 20 });
    const pool = new BrowserPool(
      6,
      100,
      undefined,
      rec.launchBrowser,
      staggerMs,
    );
    await pool.init();

    // Every one of the 6 initial-fill launches happened.
    expect(rec.launched).toHaveLength(6);

    // Strict serialization: never two chromium launches in flight at once.
    expect(rec.maxConcurrent).toBe(1);

    // Consecutive launch starts are spaced at least `staggerMs` apart (the
    // gate waits AFTER each launch settles before the next may start). Allow a
    // small scheduler-jitter tolerance below the nominal stagger.
    const tolerance = 5;
    for (let i = 1; i < rec.starts.length; i++) {
      const gap = rec.starts[i]! - rec.starts[i - 1]!;
      expect(gap).toBeGreaterThanOrEqual(staggerMs - tolerance);
    }

    await pool.shutdown();
  });

  it("serializes a burst of simultaneous recycle/relaunch triggers to concurrency 1", async () => {
    // Recycle bursts (many slots crashing and relaunching near-simultaneously)
    // are the OTHER PID-spike source the gate must cover. Fill a pool, crash
    // every browser at once so all disconnect-driven recycles fire together,
    // and assert their relaunches never overlap.
    const staggerMs = 20;
    const rec = makeRecordingLauncher({ launchDurationMs: 20 });
    const pool = new BrowserPool(
      5,
      100,
      undefined,
      rec.launchBrowser,
      staggerMs,
    );
    await pool.init();
    expect(rec.launched).toHaveLength(5);

    // Crash all 5 at once — every recycle's relaunch is triggered in the same
    // tick, the classic burst the gate must serialize.
    for (const b of rec.launched.slice(0, 5)) b.__crash();

    // Wait until all 5 relaunches have completed (10 total launches).
    await waitFor(() => rec.launched.length >= 10, 5_000);

    // No two launches (fill OR relaunch) ever overlapped.
    expect(rec.maxConcurrent).toBe(1);

    await pool.shutdown();
  });

  it("honors BROWSER_LAUNCH_STAGGER_MS env var as the default stagger", async () => {
    // The stagger is env-tunable on staging without a code change. With no
    // explicit constructor override, the pool reads BROWSER_LAUNCH_STAGGER_MS.
    const prev = process.env.BROWSER_LAUNCH_STAGGER_MS;
    process.env.BROWSER_LAUNCH_STAGGER_MS = "25";
    try {
      const rec = makeRecordingLauncher({ launchDurationMs: 10 });
      // No 5th arg → stagger comes from the env var.
      const pool = new BrowserPool(4, 100, undefined, rec.launchBrowser);
      await pool.init();

      expect(rec.launched).toHaveLength(4);
      expect(rec.maxConcurrent).toBe(1);
      const tolerance = 5;
      for (let i = 1; i < rec.starts.length; i++) {
        const gap = rec.starts[i]! - rec.starts[i - 1]!;
        expect(gap).toBeGreaterThanOrEqual(25 - tolerance);
      }

      await pool.shutdown();
    } finally {
      if (prev === undefined) delete process.env.BROWSER_LAUNCH_STAGGER_MS;
      else process.env.BROWSER_LAUNCH_STAGGER_MS = prev;
    }
  });

  it("falls back to the default stagger when the explicit arg is negative (does not silently disable)", async () => {
    // A negative explicit constructor arg must fall back to the DEFAULT
    // stagger (150ms) — the same contract the env var already honors — NOT
    // clamp to 0 and silently disable the stagger. Disabling the stagger
    // reintroduces the PID-spike the gate exists to prevent. Only 2 launches
    // so the ~150ms wait stays cheap.
    const rec = makeRecordingLauncher({ launchDurationMs: 10 });
    // -50 is negative → must be rejected and fall back to the 150ms default.
    const pool = new BrowserPool(
      2,
      undefined,
      undefined,
      rec.launchBrowser,
      -50,
    );
    await pool.init();

    expect(rec.launched).toHaveLength(2);
    expect(rec.maxConcurrent).toBe(1);

    // The two launches must be spaced by roughly the DEFAULT stagger (150ms),
    // proving the stagger was NOT disabled. Allow scheduler-jitter tolerance.
    const gap = rec.starts[1]! - rec.starts[0]!;
    expect(gap).toBeGreaterThanOrEqual(140);

    await pool.shutdown();
  });

  it("falls back to the default stagger when the explicit arg is NaN", async () => {
    // A non-numeric (NaN) explicit constructor arg must also fall back to the
    // DEFAULT stagger rather than disabling it.
    const rec = makeRecordingLauncher({ launchDurationMs: 10 });
    const pool = new BrowserPool(
      2,
      undefined,
      undefined,
      rec.launchBrowser,
      NaN,
    );
    await pool.init();

    expect(rec.launched).toHaveLength(2);
    expect(rec.maxConcurrent).toBe(1);

    const gap = rec.starts[1]! - rec.starts[0]!;
    expect(gap).toBeGreaterThanOrEqual(140);

    await pool.shutdown();
  });

  it("still serializes (concurrency 1) when the stagger is set to 0", async () => {
    // A zero stagger keeps tests fast but MUST still serialize: the gate's
    // concurrency-1 guarantee is independent of the wait. Proves the gate is
    // not merely a sleep — it is a real one-at-a-time mutex.
    const rec = makeRecordingLauncher({ launchDurationMs: 15 });
    const pool = new BrowserPool(8, 100, undefined, rec.launchBrowser, 0);
    await pool.init();

    expect(rec.launched).toHaveLength(8);
    expect(rec.maxConcurrent).toBe(1);

    await pool.shutdown();
  });
});
