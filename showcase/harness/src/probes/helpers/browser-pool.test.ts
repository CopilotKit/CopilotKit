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
});
