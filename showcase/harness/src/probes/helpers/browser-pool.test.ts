import { describe, it, expect } from "vitest";
import type { Browser, BrowserContext } from "playwright";
import { BrowserPool } from "./browser-pool.js";
import type { LaunchBrowser } from "./browser-pool.js";

/**
 * Minimal `BrowserContext` stand-in. Tracks close + the extraHTTPHeaders the
 * pool opened it with so tests can assert header centralization + forwarding.
 */
interface FakeContext {
  readonly __id: number;
  readonly __headers?: Record<string, string>;
  close(): Promise<void>;
  readonly __closeCount: number;
  /** When set, close() parks until __releaseClose() is called — lets a test
   *  hold a release()'s `await context.close()` open while a concurrent
   *  acquire interleaves (drives the release/recycle straddle race). */
  __deferClose(): void;
  __releaseClose(): void;
}

/**
 * Minimal `Browser` stand-in that exposes the surface BrowserPool uses
 * (`isConnected`, `on`, `close`, `newContext`) plus test hooks:
 *
 *   - `__crash()` — fires `disconnected` AND flips `isConnected` false.
 *   - `__silentlyDisconnect()` — flips `isConnected` false WITHOUT firing.
 */
interface FakeBrowser {
  readonly __id: number;
  isConnected(): boolean;
  on(event: string, handler: (...args: unknown[]) => void): void;
  close(): Promise<void>;
  newContext(opts?: {
    extraHTTPHeaders?: Record<string, string>;
  }): Promise<FakeContext>;
  __crash(): void;
  __silentlyDisconnect(): void;
  readonly __closeCount: number;
  readonly __contexts: FakeContext[];
  /** Release ALL pending deferred newContext() calls (see `deferNewContext`). */
  __releaseNewContexts(): void;
  /** Number of newContext() calls currently parked awaiting release. */
  readonly __pendingNewContexts: number;
}

let nextBrowserId = 0;
let nextContextId = 0;

function makeFakeBrowser(opts?: {
  newContextThrows?: boolean;
  /** When true, newContext() does NOT resolve until __releaseNewContexts() is
   *  called. Lets a test park an in-flight context-open across an await so a
   *  concurrent acquire/release/timeout can interleave deterministically. */
  deferNewContext?: boolean;
}): FakeBrowser {
  const id = nextBrowserId++;
  let connected = true;
  let closeCount = 0;
  const contexts: FakeContext[] = [];
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  const pendingReleases: Array<() => void> = [];
  const fire = (event: string): void => {
    for (const h of handlers.get(event) ?? []) h();
  };
  return {
    __id: id,
    get __closeCount() {
      return closeCount;
    },
    get __contexts() {
      return contexts;
    },
    get __pendingNewContexts() {
      return pendingReleases.length;
    },
    __releaseNewContexts() {
      const toRelease = pendingReleases.splice(0, pendingReleases.length);
      for (const r of toRelease) r();
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
    async newContext(ctxOpts) {
      if (opts?.newContextThrows) {
        throw new Error("simulated newContext failure");
      }
      if (opts?.deferNewContext) {
        await new Promise<void>((resolve) => pendingReleases.push(resolve));
      }
      const ctxId = nextContextId++;
      let ctxCloseCount = 0;
      let deferClose = false;
      let pendingClose: (() => void) | undefined;
      const ctx: FakeContext = {
        __id: ctxId,
        __headers: ctxOpts?.extraHTTPHeaders,
        get __closeCount() {
          return ctxCloseCount;
        },
        __deferClose() {
          deferClose = true;
        },
        __releaseClose() {
          const r = pendingClose;
          pendingClose = undefined;
          r?.();
        },
        async close() {
          if (deferClose) {
            await new Promise<void>((resolve) => {
              pendingClose = resolve;
            });
          }
          ctxCloseCount++;
        },
      };
      contexts.push(ctx);
      return ctx;
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
  failAtCalls?: number[];
  newContextThrowsForCalls?: number[];
  /** 1-based launch-call indices whose browser should DEFER every
   *  newContext() until __releaseNewContexts() is called. */
  deferNewContextForCalls?: number[];
}): FakeLauncher {
  const launched: FakeBrowser[] = [];
  let callCount = 0;
  const launchBrowser = async (): Promise<Browser> => {
    callCount++;
    if (opts?.failAtCalls?.includes(callCount)) {
      throw new Error("simulated launch failure");
    }
    const b = makeFakeBrowser({
      newContextThrows: opts?.newContextThrowsForCalls?.includes(callCount),
      deferNewContext: opts?.deferNewContextForCalls?.includes(callCount),
    });
    launched.push(b);
    return b as unknown as Browser;
  };
  return { launchBrowser, launched };
}

interface LeveledLog {
  level: "info" | "warn" | "error";
  event: string;
  meta?: Record<string, unknown>;
}

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
      info: (event, meta) => events.push({ level: "info", event, meta }),
      warn: (event, meta) => events.push({ level: "warn", event, meta }),
      error: (event, meta) => events.push({ level: "error", event, meta }),
    },
    events,
  };
}

async function drainMicrotasks(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3_000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const ctxId = (c: BrowserContext): number => (c as unknown as FakeContext).__id;

describe("BrowserPool — context pooling over fixed browser set", () => {
  // CASE 1 — THE load-bearing assertion: no process fork on the hot path.
  it("does NOT fork a browser process across many acquire/release cycles (launched stays == N)", async () => {
    const { launchBrowser, launched } = makeFakeLauncher();
    const pool = new BrowserPool({
      browsers: 3,
      maxContexts: 24,
      recycleAfter: 300,
      launchBrowser,
      launchStaggerMs: 0,
    });
    await pool.init();
    expect(launched.length).toBe(3);

    // Acquire/release many contexts across many cycles. The OLD pool forked
    // on the 100th release (recycleAfter); the new pool never forks here.
    for (let i = 0; i < 250; i++) {
      const ctx = await pool.acquire();
      await pool.release(ctx);
    }

    expect(launched.length).toBe(3); // init only — zero forks on the hot path
    await pool.shutdown();
  });

  // CASE 2 — release(ctx) closes the context, no relaunch.
  it("release(ctx) closes the context and does not relaunch", async () => {
    const { launchBrowser, launched } = makeFakeLauncher();
    const pool = new BrowserPool({
      browsers: 2,
      maxContexts: 10,
      launchBrowser,
      launchStaggerMs: 0,
    });
    await pool.init();
    const ctx = await pool.acquire();
    const fake = ctx as unknown as FakeContext;
    expect(fake.__closeCount).toBe(0);
    await pool.release(ctx);
    expect(fake.__closeCount).toBe(1);
    expect(launched.length).toBe(2);
    await pool.shutdown();
  });

  // CASE 3 — maxContexts cap + FIFO waiter; launched never grows.
  it("enforces maxContexts and serves a pending FIFO waiter on release without forking", async () => {
    const { launchBrowser, launched } = makeFakeLauncher();
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 2,
      launchBrowser,
      launchStaggerMs: 0,
    });
    await pool.init();

    const c1 = await pool.acquire();
    const c2 = await pool.acquire();
    expect(pool.stats().inUse).toBe(2);
    expect(pool.stats().available).toBe(0);

    // Third acquire pends past the cap.
    let c3: BrowserContext | undefined;
    const pending = pool.acquire().then((c) => (c3 = c));
    await drainMicrotasks();
    expect(c3).toBeUndefined();

    // Release frees one — the waiter is served.
    await pool.release(c1);
    await pending;
    expect(c3).toBeDefined();
    expect(pool.stats().inUse).toBe(2);
    expect(launched.length).toBe(1); // never grew

    await pool.release(c2);
    await pool.release(c3!);
    await pool.shutdown();
  });

  // CASE 4 — least-loaded assignment across N browsers.
  it("assigns contexts to the least-loaded live browser", async () => {
    const { launchBrowser, launched } = makeFakeLauncher();
    const pool = new BrowserPool({
      browsers: 3,
      maxContexts: 30,
      launchBrowser,
      launchStaggerMs: 0,
    });
    await pool.init();

    // First 3 acquires should each land on a distinct browser (all start at 0).
    const c1 = await pool.acquire();
    const c2 = await pool.acquire();
    const c3 = await pool.acquire();
    const owners = launched.map((b) => b.__contexts.length);
    expect(owners).toEqual([1, 1, 1]);

    // 4th acquire goes to a browser tied at the minimum (1 each → first).
    await pool.acquire();
    const after = launched.map((b) => b.__contexts.length).sort();
    expect(after).toEqual([1, 1, 2]);

    void c1;
    void c2;
    void c3;
    await pool.shutdown();
  });

  // CASE 5 — browser crash: its contexts removed, ONE relaunch, subsequent
  // acquire served by a live browser, blast radius = only its contexts.
  it("recovers from a browser crash with exactly one relaunch and bounded blast radius", async () => {
    const { launchBrowser, launched } = makeFakeLauncher();
    const { logger } = makeLeveledLogger();
    const pool = new BrowserPool({
      browsers: 2,
      maxContexts: 10,
      logger,
      launchBrowser,
      launchStaggerMs: 0,
    });
    await pool.init();
    expect(launched.length).toBe(2);

    // Acquire one context on each browser.
    const c1 = await pool.acquire();
    const c2 = await pool.acquire();
    expect(pool.stats().inUse).toBe(2);

    // Crash the browser that owns c1 (browser 0).
    launched[0]!.__crash();
    await waitFor(() => launched.length === 3); // exactly one relaunch

    expect(launched.length).toBe(3);
    // The crashed browser's context was dropped from accounting; c2 survives.
    expect(pool.stats().inUse).toBe(1);

    // A subsequent acquire is served by a live browser (no throw).
    const c3 = await pool.acquire();
    expect(c3).toBeDefined();

    await pool.release(c2);
    await pool.release(c3);
    void c1;
    await pool.shutdown();
  });

  // CASE 6 — hygiene recycle fires exactly once and ONLY when idle.
  it("hygiene-recycles a browser once it has served recycleAfter contexts AND is idle", async () => {
    const { launchBrowser, launched } = makeFakeLauncher();
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 10,
      recycleAfter: 3,
      launchBrowser,
      launchStaggerMs: 0,
    });
    await pool.init();
    expect(launched.length).toBe(1);

    // Serve 2 contexts (below threshold) → no relaunch.
    for (let i = 0; i < 2; i++) {
      const c = await pool.acquire();
      await pool.release(c);
    }
    await drainMicrotasks();
    expect(launched.length).toBe(1);

    // The 3rd release crosses recycleAfter=3 while idle → exactly one recycle.
    const c = await pool.acquire();
    await pool.release(c);
    await waitFor(() => launched.length === 2);
    expect(launched.length).toBe(2);

    await pool.shutdown();
  });

  // A1 — release/serve/recycle race. A release that crosses the recycleAfter
  // boundary WHILE a waiter is queued must NOT hygiene-recycle the freed entry:
  // serveNextWaiter() reserves + asynchronously opens a context on that same
  // entry, and a recycle fired on the now-stale synchronous snapshot would tear
  // the browser out from under the just-served waiter. The hygiene recycle must
  // defer to a later genuinely-idle release.
  it("does NOT hygiene-recycle on a boundary-crossing release while a waiter is queued (serve wins)", async () => {
    const { launchBrowser, launched } = makeFakeLauncher();
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 1,
      recycleAfter: 1, // the very first served context makes the entry eligible
      launchBrowser,
      launchStaggerMs: 0,
    });
    await pool.init();
    expect(launched.length).toBe(1);

    // Fill the cap with one context → servedContexts becomes 1 (>= recycleAfter).
    const c1 = await pool.acquire();
    expect(pool.stats().inUse).toBe(1);

    // Queue a waiter past the cap.
    let c2: BrowserContext | undefined;
    const pending = pool.acquire().then((c) => (c2 = c));
    await drainMicrotasks();
    expect(c2).toBeUndefined();

    // Release c1: it crosses recycleAfter=1 while idle (shouldRecycle would be
    // true) BUT a waiter is queued, so the waiter must be served onto the SAME
    // browser and NO recycle may fire.
    await pool.release(c1);
    await pending;

    expect(c2).toBeDefined();
    // No recycle, no relaunch — the waiter is served on the original browser.
    expect(pool.stats().totalRecycles).toBe(0);
    expect(launched.length).toBe(1);
    expect(launched[0]!.isConnected()).toBe(true);
    // The served context lives on the original browser.
    expect(launched[0]!.__contexts.map((x) => x.__id)).toContain(ctxId(c2!));
    expect(pool.stats().inUse).toBe(1);

    await pool.release(c2!);
    await pool.shutdown();
  });

  it("does NOT hygiene-recycle while the browser still has live contexts", async () => {
    const { launchBrowser, launched } = makeFakeLauncher();
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 10,
      recycleAfter: 2,
      launchBrowser,
      launchStaggerMs: 0,
    });
    await pool.init();

    // Hold one context open while crossing the threshold via others.
    const held = await pool.acquire();
    const a = await pool.acquire();
    await pool.release(a);
    const b = await pool.acquire();
    await pool.release(b);
    await drainMicrotasks();
    // servedContexts >= 2 but a live context is held → no recycle yet.
    expect(launched.length).toBe(1);

    await pool.release(held);
    await pool.shutdown();
  });

  // CASE 7 — never hands out a context on a recycling/disconnected browser.
  it("never opens a context on a disconnected browser", async () => {
    const { launchBrowser, launched } = makeFakeLauncher();
    const pool = new BrowserPool({
      browsers: 2,
      maxContexts: 10,
      launchBrowser,
      launchStaggerMs: 0,
    });
    await pool.init();

    // Silently disconnect browser 0 (no event) — acquire must skip it.
    launched[0]!.__silentlyDisconnect();
    const c1 = await pool.acquire();
    // Context must have been opened on the live browser (index 1).
    expect(launched[1]!.__contexts.map((x) => x.__id)).toContain(ctxId(c1));
    expect(launched[0]!.__contexts.length).toBe(0);

    await pool.release(c1);
    await pool.shutdown();
  });

  // CASE 8 — shutdown rejects waiters, awaits in-flight recycle, closes all,
  // no relaunch loop.
  it("shutdown rejects queued waiters and closes all browsers", async () => {
    const { launchBrowser, launched } = makeFakeLauncher();
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 1,
      launchBrowser,
      launchStaggerMs: 0,
    });
    await pool.init();

    const c1 = await pool.acquire();
    // Pend a waiter past the cap.
    let rejected: Error | undefined;
    const pending = pool.acquire().catch((e: Error) => (rejected = e));
    await drainMicrotasks();

    await pool.shutdown();
    await pending;
    expect(rejected).toBeInstanceOf(Error);
    expect(launched[0]!.__closeCount).toBeGreaterThanOrEqual(1);
    void c1;
  });

  // CASE 9 — stats() semantics.
  it("reports stats with maxContexts size and live-context-derived counters", async () => {
    const { launchBrowser } = makeFakeLauncher();
    const pool = new BrowserPool({
      browsers: 2,
      maxContexts: 5,
      launchBrowser,
      launchStaggerMs: 0,
    });
    await pool.init();

    expect(pool.stats()).toEqual({
      size: 5,
      available: 5,
      inUse: 0,
      totalRecycles: 0,
    });

    const c1 = await pool.acquire();
    const c2 = await pool.acquire();
    expect(pool.stats()).toEqual({
      size: 5,
      available: 3,
      inUse: 2,
      totalRecycles: 0,
    });

    await pool.release(c1);
    expect(pool.stats()).toEqual({
      size: 5,
      available: 4,
      inUse: 1,
      totalRecycles: 0,
    });

    await pool.release(c2);
    await pool.shutdown();
  });

  // Header centralization: X-AIMock-Strict default + caller header merge.
  it("centralizes X-AIMock-Strict and merges caller-supplied headers", async () => {
    const { launchBrowser } = makeFakeLauncher();
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 5,
      launchBrowser,
      launchStaggerMs: 0,
    });
    await pool.init();

    const ctx = await pool.acquire({
      extraHTTPHeaders: {
        "X-AIMock-Context": "slug-a",
        "X-Test-Id": "d4-slug-a",
      },
    });
    const headers = (ctx as unknown as FakeContext).__headers;
    expect(headers).toEqual({
      "X-AIMock-Strict": "true",
      "X-AIMock-Context": "slug-a",
      "X-Test-Id": "d4-slug-a",
    });

    await pool.release(ctx);
    await pool.shutdown();
  });

  // Double / unknown release is a no-op.
  it("double release is a no-op", async () => {
    const { launchBrowser } = makeFakeLauncher();
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 5,
      launchBrowser,
      launchStaggerMs: 0,
    });
    await pool.init();

    const ctx = await pool.acquire();
    await pool.release(ctx);
    expect(pool.stats().inUse).toBe(0);
    // Second release must not drive inUse negative.
    await pool.release(ctx);
    expect(pool.stats().inUse).toBe(0);
    await pool.shutdown();
  });

  // acquire after shutdown throws.
  it("acquire after shutdown throws", async () => {
    const { launchBrowser } = makeFakeLauncher();
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 5,
      launchBrowser,
      launchStaggerMs: 0,
    });
    await pool.init();
    await pool.shutdown();
    await expect(pool.acquire()).rejects.toThrow(/shut down/);
  });

  // env fallback: BROWSER_POOL_SIZE seeds browser count when BROWSERS unset.
  it("falls back to BROWSER_POOL_SIZE for browser count when BROWSER_POOL_BROWSERS is unset", async () => {
    const prevBrowsers = process.env.BROWSER_POOL_BROWSERS;
    const prevSize = process.env.BROWSER_POOL_SIZE;
    delete process.env.BROWSER_POOL_BROWSERS;
    process.env.BROWSER_POOL_SIZE = "2";
    try {
      const { launchBrowser, launched } = makeFakeLauncher();
      const pool = new BrowserPool({ launchBrowser, launchStaggerMs: 0 });
      await pool.init();
      expect(launched.length).toBe(2);
      await pool.shutdown();
    } finally {
      if (prevBrowsers === undefined) delete process.env.BROWSER_POOL_BROWSERS;
      else process.env.BROWSER_POOL_BROWSERS = prevBrowsers;
      if (prevSize === undefined) delete process.env.BROWSER_POOL_SIZE;
      else process.env.BROWSER_POOL_SIZE = prevSize;
    }
  });

  // ── CONCURRENT-PATH RACE REGRESSIONS ──────────────────────────────────────
  // The cases above are all SEQUENTIAL (await each acquire before the next),
  // which is exactly why the check-then-await-then-mutate races never showed.
  // These drive concurrent / interleaved paths.

  // RACE A — N concurrent acquire() never exceed maxContexts. With a SYNC
  // reservation the cap holds even when every acquire passes its check during
  // one another's newContext() await. Use a deferred-newContext browser so all
  // acquires sit in newContext() simultaneously, then assert no overshoot.
  it("N concurrent acquire() never exceed maxContexts (no cap overshoot)", async () => {
    const { launchBrowser, launched } = makeFakeLauncher({
      // The single init browser defers newContext so all acquires park in the
      // await together — the window the old code overshot in.
      deferNewContextForCalls: [1],
    });
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 2,
      launchBrowser,
      launchStaggerMs: 0,
    });
    await pool.init();

    // Fire 5 concurrent acquires at a cap of 2.
    const acquires = Array.from({ length: 5 }, () => pool.acquire());
    await drainMicrotasks();

    // With a synchronous reservation, AT MOST maxContexts newContext() calls
    // are ever in flight. The old code let all 5 pass the check and call
    // newContext() → overshoot.
    expect(launched[0]!.__pendingNewContexts).toBeLessThanOrEqual(2);

    // Release the parked opens; the 2 reserved ones resolve, the rest pend.
    launched[0]!.__releaseNewContexts();
    await drainMicrotasks();

    expect(pool.stats().inUse).toBe(2);
    expect(pool.stats().available).toBe(0);
    expect(pool.stats().inUse).toBeLessThanOrEqual(2);

    // Total contexts ever opened on the browser must never exceed the cap
    // while 3 acquires are still pending as waiters.
    expect(launched[0]!.__contexts.length).toBeLessThanOrEqual(2);

    await pool.shutdown();
    // The 3 still-pending acquires reject on shutdown; swallow them.
    await Promise.allSettled(acquires);
  });

  // RACE B — the newContext-failure retry path must respect the cap. The retry
  // branch in acquire() previously called openContextOn() with no cap re-check;
  // under the reservation model the retry reuses the held reservation and never
  // overshoots.
  it("the newContext-failure retry path respects maxContexts", async () => {
    // Two browsers: browser 1 (launch call 1) throws on newContext so the first
    // acquire fails-and-retries onto browser 2 (launch call 2). Concurrent
    // acquires must still not exceed the cap across the retry.
    const { launchBrowser, launched } = makeFakeLauncher({
      newContextThrowsForCalls: [1],
    });
    const pool = new BrowserPool({
      browsers: 2,
      maxContexts: 1,
      launchBrowser,
      launchStaggerMs: 0,
    });
    await pool.init();

    // Two concurrent acquires at a cap of 1. The first may hit browser 1
    // (throws) and retry onto browser 2; the second must NOT also open on
    // browser 2 past the cap.
    const [r1, r2] = await Promise.allSettled([
      pool.acquire(undefined, 200),
      pool.acquire(undefined, 200),
    ]);
    await drainMicrotasks();

    // Exactly one context should be live (cap=1); the other pends/times out.
    expect(pool.stats().inUse).toBeLessThanOrEqual(1);
    const totalLive = launched.reduce((n, b) => n + b.__contexts.length, 0);
    expect(totalLive).toBeLessThanOrEqual(1);

    // Clean up whichever acquire succeeded.
    for (const r of [r1, r2]) {
      if (r.status === "fulfilled") await pool.release(r.value);
    }
    await pool.shutdown();
  });

  // A2 — acquire() retry path: a SECOND consecutive newContext failure (a
  // second browser dying in the same EAGAIN burst) must enqueue the caller as
  // a waiter and let recovery fulfill it gracefully, NOT reject hard. The first
  // attempt throws → recycle + re-reserve + retry onto the other browser; the
  // retry ALSO throws → the fix recycles the retry browser and pends a waiter
  // that resolves once the recycle relaunch lands.
  it("enqueues the caller (no hard reject) when the acquire retry's newContext also fails", async () => {
    // Both initial browsers (launch calls 1 + 2) throw on newContext. Their
    // recycle relaunches (calls 3 + 4) succeed and drain the queued waiter.
    const { launchBrowser, launched } = makeFakeLauncher({
      newContextThrowsForCalls: [1, 2],
    });
    const { logger, events } = makeLeveledLogger();
    const pool = new BrowserPool({
      browsers: 2,
      maxContexts: 2,
      logger,
      launchBrowser,
      launchStaggerMs: 0,
    });
    await pool.init();
    expect(launched.length).toBe(2);

    // Single acquire: first attempt throws → retry onto the other browser →
    // retry ALSO throws. The fix must enqueue rather than reject. Give a
    // generous timeout so the recovery relaunch resolves it.
    const ctx = await pool.acquire(undefined, 2_000);
    expect(ctx).toBeDefined();

    // Both original browsers were recycled (their newContext threw); the
    // relaunched ones served the waiter — no hard rejection reached the caller.
    expect(pool.stats().totalRecycles).toBeGreaterThanOrEqual(2);
    expect(launched.length).toBe(4); // 2 init + 2 relaunch
    // The retry-failure path logged its dedicated warn (proves we hit it).
    expect(
      events.some(
        (e) => e.event === "browser-pool.acquire-retry-newcontext-failed",
      ),
    ).toBe(true);

    await pool.release(ctx);
    await pool.shutdown();
  });

  // RACE C — a waiter that times out WHILE serveNextWaiter is opening its
  // context must NOT leak the freshly-opened context. The orphan must be closed
  // and the count rolled back.
  it("does not leak a context when a waiter times out mid-serveNextWaiter", async () => {
    const { launchBrowser, launched } = makeFakeLauncher({
      deferNewContextForCalls: [1],
    });
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 1,
      launchBrowser,
      launchStaggerMs: 0,
    });
    await pool.init();

    // Fill the cap with one context (parked open → release it).
    const c1p = pool.acquire();
    await drainMicrotasks();
    launched[0]!.__releaseNewContexts();
    const c1 = await c1p;
    expect(pool.stats().inUse).toBe(1);

    // Enqueue a waiter with a SHORT timeout — it pends past the cap.
    let waiterRejected: Error | undefined;
    const waiterP = pool
      .acquire(undefined, 20)
      .catch((e: Error) => (waiterRejected = e));
    await drainMicrotasks();

    // Release c1 → serveNextWaiter() picks the waiter, calls newContext()
    // (parked, deferred). While that open is in flight, let the waiter's
    // 20ms timeout fire.
    await pool.release(c1);
    await drainMicrotasks();
    await new Promise((r) => setTimeout(r, 40)); // waiter times out now
    expect(waiterRejected).toBeInstanceOf(Error);

    // Now let the parked newContext() for the dead waiter resolve.
    launched[0]!.__releaseNewContexts();
    await drainMicrotasks();

    // The orphan context must have been CLOSED and the count rolled back to 0.
    // Old code: resolve() no-ops on the settled waiter → context leaks, count
    // stuck at 1.
    expect(pool.stats().inUse).toBe(0);
    expect(pool.stats().available).toBe(1);
    // Every context ever opened on the browser must be closed.
    const openButNotClosed = launched[0]!.__contexts.filter(
      (c) => c.__closeCount === 0,
    );
    expect(openButNotClosed.length).toBe(0);

    await pool.shutdown();
  });

  // RACE D — release/recycle interleave must NOT recycle a browser that still
  // has (or concurrently gains) a live context. With the fix, release() does
  // its bookkeeping (delete + decrement) and evaluates the idle-recycle
  // decision off purely SYNCHRONOUS state, with no await straddling the
  // decrement and the size check, and only THEN awaits context.close(). A
  // concurrent acquire that lands while a parked close is in flight therefore
  // cannot be abandoned by a spurious recycle: the recycle decision was already
  // taken against the true live-set, and a busy browser is never recycled.
  //
  // This is a forward regression GUARD for the close/accounting reorder. (It
  // holds on the pre-fix code too, because the pre-fix order kept the released
  // context IN the live set across its close-await — conservative, never
  // reading a false-idle. The reorder makes the no-await-gap invariant explicit
  // and machine-checkable so a future edit that re-introduces an await between
  // the decrement and the size check is caught here.)
  it("release evaluates the idle-recycle decision on synchronous state and never recycles a busy browser (close/accounting reorder)", async () => {
    const { launchBrowser, launched } = makeFakeLauncher();
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 5,
      recycleAfter: 1, // eligible after the very first served context
      launchBrowser,
      launchStaggerMs: 0,
    });
    await pool.init();
    expect(launched.length).toBe(1);

    // Hold one context open for the entire test so the browser is NEVER idle —
    // a recycle would be spurious and would abandon `held`.
    const held = await pool.acquire();
    // Serve + release a second context so servedContexts crosses recycleAfter=1.
    const c1 = await pool.acquire();
    expect(pool.stats().inUse).toBe(2);

    // Park c1's close so release(c1) straddles its `await context.close()`.
    (c1 as unknown as FakeContext).__deferClose();
    const release1 = pool.release(c1);
    await drainMicrotasks();

    // While that close is parked, acquire + release ANOTHER context. The
    // browser is busy throughout (held is live) so no release may recycle it.
    const c2 = await pool.acquire();
    await pool.release(c2);
    await drainMicrotasks();

    // Let c1's parked close finish.
    (c1 as unknown as FakeContext).__releaseClose();
    await release1;
    await drainMicrotasks();

    // `held` is still live; its browser must NOT have been recycled.
    expect(pool.stats().totalRecycles).toBe(0);
    expect(launched.length).toBe(1);
    expect(launched[0]!.isConnected()).toBe(true);
    expect(pool.stats().inUse).toBe(1); // only `held` remains

    await pool.release(held);
    await pool.shutdown();
  });

  // ── RECYCLE-VS-IN-FLIGHT-OPEN INVARIANT MATRIX ────────────────────────────
  // One structural invariant closes a whole class of recycle-vs-concurrent-
  // operation races: a context being opened in `openContextOn` has taken a cap
  // reservation BEFORE its `await newContext()` but is added to
  // `entry.liveContexts` only AFTER the await resolves. During that window
  // `liveContexts.size` undercounts, so any recycle/idle decision made off
  // `liveContexts.size` alone is blind to the in-flight open. The fix adds a
  // per-entry `pendingOpens` counter and a single `isEntryIdle` predicate that
  // every recycle/idle decision consults, an orphan guard in `openContextOn`
  // for the entry-recycled-mid-await case, and a `recyclePending` flag so a
  // deferred hygiene recycle still fires at the next idle release under
  // sustained waiter pressure. The cases below are parametrized over the two
  // faces of the gap (in-flight open invisible to recycle; deferred recycle
  // starved) and the belt-and-suspenders orphan path.

  // MATRIX (a) — a hygiene recycle does NOT fire while an `openContextOn` is in
  // flight on that entry. recycleAfter=1 makes the entry eligible after one
  // served context; a SECOND open is parked in newContext() (pendingOpens=1,
  // not yet in liveContexts) when the boundary-crossing release lands. The
  // pre-fix `liveContexts.size === 0` idle check reads the entry as idle and
  // hygiene-recycles it OUT FROM UNDER the in-flight open (RED). The fix's
  // `isEntryRecyclable` (pendingOpens === 0) defers it.
  it("MATRIX(a): does NOT hygiene-recycle while an openContextOn is in flight on that entry", async () => {
    const { launchBrowser, launched } = makeFakeLauncher({
      deferNewContextForCalls: [1],
    });
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 2,
      recycleAfter: 1, // first served context makes the entry eligible
      launchBrowser,
      launchStaggerMs: 0,
    });
    await pool.init();
    expect(launched.length).toBe(1);

    // Open c1 (parked) → release the park so c1 becomes live; servedContexts=1.
    const c1p = pool.acquire();
    await drainMicrotasks();
    launched[0]!.__releaseNewContexts();
    const c1 = await c1p;
    expect(pool.stats().inUse).toBe(1);

    // Start a SECOND acquire — it parks in newContext() (deferred), so its open
    // is IN FLIGHT (pendingOpens=1) but it is NOT yet in liveContexts.
    let c2: BrowserContext | undefined;
    const c2p = pool.acquire().then((c) => (c2 = c));
    await drainMicrotasks();
    expect(c2).toBeUndefined();
    expect(launched[0]!.__pendingNewContexts).toBe(1);

    // Release c1: servedContexts(1) >= recycleAfter(1) and (pre-fix) liveContexts
    // is now empty, so the pre-fix code hygiene-recycles immediately — tearing
    // the browser down under the in-flight c2 open.
    await pool.release(c1);
    await drainMicrotasks();

    // INVARIANT: no recycle fired while the open was in flight.
    expect(pool.stats().totalRecycles).toBe(0);
    expect(launched.length).toBe(1);
    expect(launched[0]!.isConnected()).toBe(true);

    // Let the in-flight open resolve; c2 lands live on the SAME original browser.
    launched[0]!.__releaseNewContexts();
    await c2p;
    expect(c2).toBeDefined();
    expect(launched[0]!.__contexts.map((x) => x.__id)).toContain(ctxId(c2!));
    expect(pool.stats().inUse).toBe(1);

    await pool.release(c2!);
    await pool.shutdown();
  });

  // MATRIX (b) — an `openContextOn` whose entry is recycled MID-AWAIT closes the
  // freshly-opened orphan + rolls back the count (no cap leak, no dead context
  // handed out). A held context keeps the entry from being idle; the open is
  // parked; we CRASH the browser mid-open (recovery recycle reassigns
  // entry.browser). When the parked newContext() resolves, the orphan guard
  // (entry.browser !== browserBefore / !isConnected) closes it, rolls back the
  // reservation, and surfaces a failure so acquire's retry path enqueues. The
  // pre-fix code adds the orphan to liveContexts on a dead/replaced browser,
  // leaking a cap slot and handing out a dead context (RED).
  it("MATRIX(b): closes the orphan + rolls back the count when an open's entry is recycled mid-await", async () => {
    const { launchBrowser, launched } = makeFakeLauncher({
      // Browser 1 (init) defers newContext; its relaunch (call 2) does not, so
      // the enqueued caller is eventually served on the fresh browser.
      deferNewContextForCalls: [1],
    });
    const { logger, events } = makeLeveledLogger();
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 2,
      recycleAfter: 1000, // hygiene out of the picture; this is the crash path
      logger,
      launchBrowser,
      launchStaggerMs: 0,
    });
    await pool.init();
    expect(launched.length).toBe(1);

    // Start an acquire — parks in newContext() on browser 0 (pendingOpens=1).
    let acquired: BrowserContext | undefined;
    const acquireP = pool
      .acquire(undefined, 2_000)
      .then((c) => (acquired = c))
      .catch(() => {});
    await drainMicrotasks();
    expect(launched[0]!.__pendingNewContexts).toBe(1);
    expect(pool.stats().inUse).toBe(1); // reservation taken for the in-flight open

    // CRASH browser 0 while its open is in flight → recovery recycle reassigns
    // entry.browser to a fresh process (launch call 2) and drains waiters.
    launched[0]!.__crash();
    await waitFor(() => launched.length === 2);

    // Now resolve the parked open on the ORIGINAL (now-dead/replaced) browser.
    // The orphan guard must close it, roll back the reservation, and surface a
    // failure (acquire then enqueues + the relaunch serves the caller).
    launched[0]!.__releaseNewContexts();
    await drainMicrotasks();

    // The caller is eventually served once a fresh (non-deferred) browser is
    // available. Drain any parked opens on the relaunched browsers so the
    // enqueued caller resolves, then await it.
    await waitFor(() => {
      for (const b of launched.slice(1)) {
        if (b.__pendingNewContexts > 0) b.__releaseNewContexts();
      }
      return acquired !== undefined;
    });
    await acquireP;

    // The orphan guard logged its dedicated warn (proves we hit it).
    expect(
      events.some((e) => e.event === "browser-pool.open-orphaned-by-recycle"),
    ).toBe(true);

    // NO cap leak: the orphaned open's reservation was rolled back. The only
    // live context is the one served on a fresh browser.
    expect(acquired).toBeDefined();
    expect(pool.stats().inUse).toBe(1);
    // The orphan context on the ORIGINAL (dead) browser was closed, never
    // handed out — no open-but-not-closed context lingers on it.
    const origOrphans = launched[0]!.__contexts.filter(
      (c) => c.__closeCount === 0,
    );
    expect(origOrphans.length).toBe(0);
    // The handed-out context is NOT the orphan from the dead original browser.
    expect(launched[0]!.__contexts.map((x) => x.__id)).not.toContain(
      ctxId(acquired!),
    );
    // It lives on a live (recycled/fresh) browser that is connected.
    const owner = launched.find((b) =>
      b.__contexts.some((c) => c.__id === ctxId(acquired!)),
    );
    expect(owner).toBeDefined();
    expect(owner!.__id).not.toBe(launched[0]!.__id);
    expect(owner!.isConnected()).toBe(true);

    await pool.release(acquired!);
    await pool.shutdown();
  });

  // MATRIX (c) — a hygiene recycle that becomes eligible on a release while a
  // concurrent open is in flight (pendingOpens=1) must NOT fire during the open,
  // and the eligibility must NOT be lost: it fires at the next safe idle
  // release (recyclePending honored). This is the GAP-2 face — the eligible
  // recycle is deferred while the entry is busy with an in-flight open, and the
  // fix carries the intent forward rather than dropping it.
  //
  // The pre-fix idle check is `liveContexts.size === 0` and is blind to the
  // in-flight open, so on the boundary-crossing release (which has NO queued
  // waiter → the pre-fix `!hadWaiter` gate is satisfied) it FIRES the hygiene
  // recycle DURING the concurrent open — tearing the browser down under it
  // (RED). The fix's `isEntryRecyclable` (pendingOpens===0) defers it and
  // `recyclePending` makes it fire at the next idle release instead.
  it("MATRIX(c): an eligible hygiene recycle defers past an in-flight open and fires at the next idle release", async () => {
    const { launchBrowser, launched } = makeFakeLauncher({
      deferNewContextForCalls: [1], // browser0 defers every newContext
    });
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 3,
      recycleAfter: 1, // eligible after the first served context
      launchBrowser,
      launchStaggerMs: 0,
    });
    await pool.init();
    expect(launched.length).toBe(1);

    // Open c0 (parked) → release park → c0 live; served0=1 (>= recycleAfter).
    const c0p = pool.acquire();
    await drainMicrotasks();
    launched[0]!.__releaseNewContexts();
    const c0 = await c0p;
    expect(pool.stats().inUse).toBe(1);

    // Start a CONCURRENT acquire c1 — it reserves a slot and parks in
    // newContext() (deferred). pendingOpens=1, NOT yet in liveContexts. NO
    // waiter is queued (cap=3 has room), so the boundary-crossing release below
    // has hadWaiter=false.
    let c1: BrowserContext | undefined;
    const c1p = pool.acquire().then((c) => (c1 = c));
    await drainMicrotasks();
    expect(c1).toBeUndefined();
    expect(launched[0]!.__pendingNewContexts).toBe(1);

    // Release c0: servedContexts(1) >= recycleAfter(1); the pre-fix idle check
    // (liveContexts.size===0, blind to pendingOpens) is satisfied and there is
    // NO waiter, so the pre-fix code FIRES the hygiene recycle here — DURING
    // c1's in-flight open.
    await pool.release(c0);
    await drainMicrotasks();

    // INVARIANT: no recycle fired while c1's open is in flight.
    expect(launched[0]!.__pendingNewContexts).toBe(1); // c1 still opening
    expect(pool.stats().totalRecycles).toBe(0);
    expect(launched[0]!.isConnected()).toBe(true);

    // Let c1's open complete → c1 live on the original browser, served0=2.
    launched[0]!.__releaseNewContexts();
    await c1p;
    expect(c1).toBeDefined();
    expect(launched[0]!.__contexts.map((x) => x.__id)).toContain(ctxId(c1!));
    // The recycle was deferred, not dropped.
    expect(pool.stats().totalRecycles).toBe(0);

    // Release c1 with no waiter queued → entry genuinely idle + recycle pending
    // → the deferred hygiene recycle fires at this safe idle point.
    await pool.release(c1!);
    await waitFor(() => launched.length === 2);
    expect(pool.stats().totalRecycles).toBe(1);
    expect(launched.length).toBe(2);

    await pool.shutdown();
  });

  // MATRIX (d) — the prior serve-vs-recycle guard still holds: a
  // boundary-crossing release WHILE a waiter is queued must serve the waiter
  // onto the SAME browser and NOT recycle it out from under the just-served
  // waiter. (Mirrors A1; re-asserted here so the recyclePending mechanics added
  // for (c) did not regress the deferral.)
  it("MATRIX(d): does NOT recycle out from under a just-served waiter (serve-vs-recycle guard preserved)", async () => {
    const { launchBrowser, launched } = makeFakeLauncher();
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 1,
      recycleAfter: 1,
      launchBrowser,
      launchStaggerMs: 0,
    });
    await pool.init();
    expect(launched.length).toBe(1);

    const c1 = await pool.acquire();
    expect(pool.stats().inUse).toBe(1);

    let c2: BrowserContext | undefined;
    const c2p = pool.acquire().then((c) => (c2 = c));
    await drainMicrotasks();
    expect(c2).toBeUndefined();

    // The boundary-crossing release serves the waiter, does NOT recycle.
    await pool.release(c1);
    await c2p;

    expect(c2).toBeDefined();
    expect(pool.stats().totalRecycles).toBe(0);
    expect(launched.length).toBe(1);
    expect(launched[0]!.isConnected()).toBe(true);
    // The served context lives on the original (un-recycled) browser.
    expect(launched[0]!.__contexts.map((x) => x.__id)).toContain(ctxId(c2!));
    expect(pool.stats().inUse).toBe(1);

    await pool.release(c2!);
    await pool.shutdown();
  });

  // ── BUCKET-D CONCURRENCY-HARDENING REGRESSIONS ────────────────────────────
  // Three PRE-EXISTING defects in the non-release teardown paths, each driven
  // by an interleave the sequential cases above never exercised.

  // Internal-state probe: read a private BrowserEntry field for assertions the
  // public stats() surface does not expose (servedContexts / recyclePending).
  // The pool keeps these per-entry; the only way to assert the orphan-close
  // bookkeeping is to read them directly.
  const entry0 = (
    pool: BrowserPool,
  ): { servedContexts: number; recyclePending: boolean; pendingOpens: number } =>
    (
      pool as unknown as {
        browsers: Array<{
          servedContexts: number;
          recyclePending: boolean;
          pendingOpens: number;
        }>;
      }
    ).browsers[0]!;

  // BUG 1 — a waiter that times out WHILE serveNextWaiter is opening its
  // context leaks `servedContexts`. openContextOn did servedContexts++ when it
  // added the never-delivered context; the orphan-close cleanup decrements the
  // reservation + drops liveContexts but (pre-fix) does NOT decrement
  // servedContexts. So every timed-out-mid-serve permanently inflates
  // servedContexts, biasing the hygiene recycle to fire early. The fix mirrors
  // the increment with a decrement in the orphan-close block.
  it("BUG1: a waiter that times out mid-serveNextWaiter does NOT inflate servedContexts", async () => {
    const { launchBrowser, launched } = makeFakeLauncher({
      deferNewContextForCalls: [1],
    });
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 1,
      recycleAfter: 1000, // keep hygiene out of the picture; assert the count
      launchBrowser,
      launchStaggerMs: 0,
    });
    await pool.init();

    // Fill the cap with one context (parked open → release it).
    const c1p = pool.acquire();
    await drainMicrotasks();
    launched[0]!.__releaseNewContexts();
    const c1 = await c1p;
    expect(pool.stats().inUse).toBe(1);
    // One context genuinely served.
    expect(entry0(pool).servedContexts).toBe(1);

    // Enqueue a waiter with a SHORT timeout — it pends past the cap.
    let waiterRejected: Error | undefined;
    const waiterP = pool
      .acquire(undefined, 20)
      .catch((e: Error) => (waiterRejected = e));
    await drainMicrotasks();

    // Release c1 → serveNextWaiter() picks the waiter, calls newContext()
    // (parked). While that open is in flight, let the 20ms timeout fire.
    await pool.release(c1);
    await drainMicrotasks();
    await new Promise((r) => setTimeout(r, 40)); // waiter times out now
    expect(waiterRejected).toBeInstanceOf(Error);

    // Let the parked newContext() for the dead waiter resolve → orphan-close.
    launched[0]!.__releaseNewContexts();
    await drainMicrotasks();
    await waiterP;

    // The orphaned serve must NOT count toward servedContexts: the context was
    // opened (servedContexts++) but never delivered, then closed + rolled back.
    // Pre-fix: servedContexts stuck at 2 (the orphan inflated it). Fixed: 1.
    expect(entry0(pool).servedContexts).toBe(1);
    expect(pool.stats().inUse).toBe(0);

    await pool.shutdown();
  });

  // BUG 2 — a hygiene recycle deferred via the `shouldRecycle && hadWaiter`
  // guard sets recyclePending=true, expecting "the next idle release honors it."
  // But if the just-served waiter's lifecycle ends via a NON-release teardown
  // (here: the waiter times out mid-serve → serveNextWaiter orphan-close), no
  // release() ever fires, so the deferred recycle is dropped and the browser
  // exceeds recycleAfter indefinitely. The fix re-checks the deferred recycle on
  // the non-release teardown paths.
  it("BUG2: a deferred hygiene recycle still fires when the just-served waiter ends via a non-release teardown", async () => {
    const { launchBrowser, launched } = makeFakeLauncher({
      deferNewContextForCalls: [1], // browser0 defers every newContext
    });
    const { logger } = makeLeveledLogger();
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 1,
      recycleAfter: 1, // eligible after the first served context
      logger,
      launchBrowser,
      launchStaggerMs: 0,
    });
    await pool.init();
    expect(launched.length).toBe(1);

    // Fill the cap with one context (parked open → release the park).
    const c1p = pool.acquire();
    await drainMicrotasks();
    launched[0]!.__releaseNewContexts();
    const c1 = await c1p;
    expect(pool.stats().inUse).toBe(1);
    expect(entry0(pool).servedContexts).toBe(1); // >= recycleAfter

    // Queue a waiter W past the cap with a SHORT timeout.
    let wRejected: Error | undefined;
    const wP = pool
      .acquire(undefined, 20)
      .catch((e: Error) => (wRejected = e));
    await drainMicrotasks();

    // Release c1: the boundary-crossing release (servedContexts>=recycleAfter,
    // entry momentarily idle) computes shouldRecycle=true AND has a queued waiter
    // → it serves W (parks in deferred newContext) and DEFERS the recycle, setting
    // recyclePending=true. No recycle fires now.
    await pool.release(c1);
    await drainMicrotasks();
    expect(pool.stats().totalRecycles).toBe(0);
    expect(entry0(pool).recyclePending).toBe(true);

    // W now times out WHILE its serve's newContext() is still parked in flight.
    await new Promise((r) => setTimeout(r, 40));
    expect(wRejected).toBeInstanceOf(Error);

    // Resolve the parked open for the dead waiter → serveNextWaiter orphan-close,
    // a NON-release teardown that returns the entry to idle. Pre-fix: nothing
    // re-checks the deferred recycle here, so recyclePending stays true forever
    // and the browser is never recycled (totalRecycles stuck at 0). The fix
    // re-checks isEntryRecyclable && recyclePending on the orphan-close path and
    // fires the deferred recycle.
    launched[0]!.__releaseNewContexts();
    await wP;
    await waitFor(() => pool.stats().totalRecycles === 1);
    expect(pool.stats().totalRecycles).toBe(1);
    expect(entry0(pool).recyclePending).toBe(false);

    await pool.shutdown();
  });

  // BUG 3 — when an in-flight open is orphaned by a recycle and rolls back via
  // releaseReservation(), it does NOT drain the waiter queue. So a queued waiter
  // can stall with free capacity until the next unrelated release/recycle
  // handoff. The fix calls scheduleServeNextWaiter() after the rollback so freed
  // capacity immediately serves the waiter.
  it("BUG3: an open orphaned by recycle drains a queued waiter from the freed capacity", async () => {
    // browser0 (init) defers its first newContext so we can park an in-flight
    // open and orphan it; its relaunch (call 2) does NOT defer, so a waiter
    // served onto the fresh browser resolves immediately.
    const { launchBrowser, launched } = makeFakeLauncher({
      deferNewContextForCalls: [1],
    });
    const { logger } = makeLeveledLogger();
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 1,
      recycleAfter: 1000, // hygiene out of the picture
      logger,
      launchBrowser,
      launchStaggerMs: 0,
    });
    await pool.init();
    expect(launched.length).toBe(1);

    // Acquire A parks in newContext() on browser0 (pendingOpens=1, reservation
    // held → cap saturated at 1).
    let aDone = false;
    const aP = pool
      .acquire(undefined, 5_000)
      .then(() => (aDone = true))
      .catch(() => {});
    await drainMicrotasks();
    expect(launched[0]!.__pendingNewContexts).toBe(1);
    expect(pool.stats().inUse).toBe(1);

    // Acquire B pends as a WAITER past the cap (cap=1, A holds the only slot).
    let b: BrowserContext | undefined;
    const bP = pool
      .acquire(undefined, 5_000)
      .then((c) => (b = c))
      .catch(() => {});
    await drainMicrotasks();
    expect(b).toBeUndefined();

    // CRASH browser0 → recovery recycle reassigns entry.browser to a fresh,
    // NON-deferring process (call 2). Resolve A's parked open on the ORIGINAL
    // (now-replaced) browser: the orphan guard closes it and rolls back the
    // reservation — freeing the only cap slot.
    launched[0]!.__crash();
    await waitFor(() => launched.length === 2);
    launched[0]!.__releaseNewContexts(); // A's open resolves → orphaned + rolled back
    await drainMicrotasks();

    // BUG3 INVARIANT: the freed slot must immediately serve waiter B from the
    // rollback's scheduleServeNextWaiter(). Pre-fix the rollback did not drain
    // the queue, so B stalled with free capacity. The crash-recovery relaunch's
    // own drain loop would EVENTUALLY serve B, so to isolate the rollback-drain
    // we assert B resolves promptly after the rollback without any further pool
    // activity.
    await waitFor(() => b !== undefined, 1_000);
    expect(b).toBeDefined();
    expect(pool.stats().inUse).toBe(1); // exactly B is live

    void aDone;
    await aP;
    await bP;
    await pool.release(b!);
    await pool.shutdown();
  });
});
