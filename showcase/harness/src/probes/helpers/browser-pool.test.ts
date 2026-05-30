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
    const pool = new BrowserPool(2, 100, logger, launchBrowser);
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
    const pool = new BrowserPool(1, 100, logger, launchBrowser);
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
    const pool = new BrowserPool(1, 100, logger, launchBrowser);
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
    // relaunchPendingSlots. The fresh browser must go to exactly one of them;
    // the loser stays parked as a waiter (it has no timer to recover it and
    // will reject on shutdown).
    const a = pool.acquire(5_000);
    const b = pool.acquire(5_000);

    const first = await Promise.race([a, b]);
    expect(first).toBeDefined();
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
    // The loser waiter rejects on shutdown; swallow it.
    await Promise.allSettled([a, b]);
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
    const pool = new BrowserPool(1, 100, logger, launchBrowser);
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
    const pool = new BrowserPool(1, 100, logger, launchBrowser);
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
    // Deterministic race: gate every recovery launch (calls 9+) so we can
    // interleave the two invocations precisely.
    const launched: FakeBrowser[] = [];
    let callCount = 0;
    // One resolver per gated recovery launch; we release them in order.
    const gateResolvers: Array<() => void> = [];
    const gateFor = (): Promise<void> =>
      new Promise<void>((resolve) => {
        gateResolvers.push(resolve);
      });
    // init = calls 1,2; the two slots' immediate recycle retries
    // (RELAUNCH_MAX_ATTEMPTS=3 each) = calls 3..8, all fail to park both slots.
    // Recovery relaunches are calls 9 and 10, both gated.
    const failCalls = new Set([3, 4, 5, 6, 7, 8]);
    const launchBrowser: LaunchBrowser = async () => {
      callCount++;
      if (failCalls.has(callCount)) {
        throw new Error("simulated launch failure");
      }
      if (callCount >= 9) {
        await gateFor();
      }
      const b = makeFakeBrowser();
      launched.push(b);
      return b as unknown as Browser;
    };
    const { logger } = makeFakeLogger();
    const pool = new BrowserPool(2, 100, logger, launchBrowser);
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
    const a = pool.acquire(5_000);
    const b = pool.acquire(5_000);

    // Let both invocations run up to their first gated launch. Invocation 1
    // snapshots [slotA, slotB], claims slotA, awaits its launch (call 9).
    // Invocation 2 then snapshots [slotB] (slotA busy), claims slotB, awaits
    // its launch (call 10). Wait until BOTH gated launches are pending.
    await waitFor(() => gateResolvers.length >= 2, 3_000);

    // Release both gated launches. Invocation 1's slotA launch (call 9) and
    // invocation 2's slotB launch (call 10) resolve. Invocation 1's loop then
    // advances to slotB: WITHOUT the in-loop guard it would launch a SECOND
    // browser for slotB (a 3rd gated launch, call 11). WITH the guard it skips
    // slotB (now busy / no longer pending).
    gateResolvers[0]!();
    gateResolvers[1]!();
    await drainMicrotasks(30);

    // Give any erroneous third launch a chance to register its gate so a leak
    // would surface as a 3rd pending resolver.
    await drainMicrotasks(30);

    const first = await Promise.race([a, b]);
    expect(first).toBeDefined();
    expect((first as unknown as FakeBrowser).isConnected()).toBe(true);

    // Exactly two fresh browsers beyond init — one per slot, no leaked
    // double-launch for the contended slot. (A third gated launch from the
    // unguarded re-entry would still be parked on its gate and not yet in
    // `launched`, so additionally assert no 3rd gate was ever requested.)
    const freshBeyondInit = launched.slice(2);
    expect(freshBeyondInit.length).toBe(2);
    expect(gateResolvers.length).toBe(2);

    // Pin exact-once: both acquirers are served by the two fresh launches, and
    // each fresh browser maps to a distinct slot (no slot.browser overwrite).
    const both = await Promise.all([a, b]);
    const servedIds = both.map((br) => (br as unknown as FakeBrowser).__id);
    const freshIds = freshBeyondInit.map((br) => br.__id);
    expect(new Set(servedIds)).toEqual(new Set(freshIds));

    // Two live slots recovered, never double-published into available.
    expect(pool.stats().size).toBe(2);
    expect(pool.stats().available).toBeLessThanOrEqual(2);

    await pool.shutdown();
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
