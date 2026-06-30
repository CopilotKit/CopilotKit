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
  /** Arm `n` consecutive TRANSIENT newContext() throws (no isConnected flip).
   *  Pass `Infinity` for a browser that throws transiently FOREVER while staying
   *  connected (drives the serveNextWaiter re-drive ceiling). */
  __armTransientThrow(n?: number): void;
  /** Total number of newContext() calls made against this browser — including
   *  the ones that threw — so a test can assert the pool did NOT hot-loop. */
  readonly __newContextCalls: number;
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
  /** When set together with `newContextThrows`, the throwing browser also flips
   *  isConnected() false (dead browser) so the pool recycles it (FIX #7). */
  newContextThrowsDisconnects?: boolean;
  /** When true, newContext() does NOT resolve until __releaseNewContexts() is
   *  called. Lets a test park an in-flight context-open across an await so a
   *  concurrent acquire/release/timeout can interleave deterministically. */
  deferNewContext?: boolean;
}): FakeBrowser {
  const id = nextBrowserId++;
  let connected = true;
  let transientThrowsRemaining = 0;
  let newContextCalls = 0;
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
    get __newContextCalls() {
      return newContextCalls;
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
      newContextCalls++;
      if (transientThrowsRemaining > 0) {
        // TRANSIENT failure: throw WITHOUT flipping isConnected(). The browser
        // is still alive, so the pool's FIX #7 dead-vs-alive gate must NOT
        // recycle it.
        transientThrowsRemaining--;
        throw new Error("simulated transient newContext failure");
      }
      if (opts?.newContextThrows) {
        // When `newContextThrowsDisconnects` is set, the throw represents a
        // genuinely DEAD browser: flip isConnected() false (and fire
        // `disconnected` once) so the pool's dead-vs-alive logic (FIX #7)
        // correctly treats it as a crash and recycles, rather than as a
        // transient error on a still-live browser.
        if (opts?.newContextThrowsDisconnects && connected) {
          connected = false;
          fire("disconnected");
        }
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
    /** Arm `n` consecutive TRANSIENT newContext() throws (throws WITHOUT
     *  flipping isConnected()) at a precise moment in a test. */
    __armTransientThrow(n = 1) {
      transientThrowsRemaining = n;
    },
  };
}

interface FakeLauncher {
  launchBrowser: LaunchBrowser;
  launched: FakeBrowser[];
  /** Mutate the `failAfterCall` threshold mid-run — set to a large value (or
   *  undefined) to "heal" the simulated thread-exhausted kernel so subsequent
   *  relaunches succeed. */
  setFailAfter(threshold: number | undefined): void;
  /** Number of launchBrowser() calls currently PARKED mid-launch (the
   *  `parkLaunchForCalls` set), awaiting __releaseParkedLaunches(). Models a real
   *  chromium.launch() that has not yet resolved — its browser object exists but
   *  is not yet registered in the pool's `this.browsers`. */
  readonly __parkedLaunches: number;
  /** Resolve ALL parked launches, returning the FakeBrowsers they resolve to (so
   *  a test can assert on / crash them). */
  __releaseParkedLaunches(): FakeBrowser[];
}

function makeFakeLauncher(opts?: {
  failAtCalls?: number[];
  newContextThrowsForCalls?: number[];
  /** Subset of `newContextThrowsForCalls` whose throw represents a DEAD browser
   *  (flips isConnected() false) so the pool recycles it on the FIX #7
   *  dead-vs-alive gate, rather than treating the throw as transient. */
  newContextThrowsDisconnectsForCalls?: number[];
  /** 1-based launch-call indices whose browser should DEFER every
   *  newContext() until __releaseNewContexts() is called. */
  deferNewContextForCalls?: number[];
  /** Every launch-call STRICTLY AFTER this 1-based index throws — simulates a
   *  PID/thread-ceiling pthread_create EAGAIN that persists across the whole
   *  recovery storm (init succeeds, all subsequent relaunches fail). Mutable
   *  via the returned `setFailAfter` so a test can "heal" the kernel mid-run. */
  failAfterCall?: number;
  /** 1-based launch-call indices whose launchBrowser() PARKS — the FakeBrowser is
   *  created but the launch promise does not resolve until
   *  __releaseParkedLaunches() is called. Models a real chromium.launch() that is
   *  mid-startup: the browser object exists (and can be closed!) but is not yet
   *  registered in the pool's `this.browsers`. Drives the close-during-launch
   *  teardown race. */
  parkLaunchForCalls?: number[];
}): FakeLauncher {
  const launched: FakeBrowser[] = [];
  let callCount = 0;
  let failAfter = opts?.failAfterCall;
  const parkedReleases: Array<() => void> = [];
  const launchBrowser = async (): Promise<Browser> => {
    callCount++;
    if (opts?.failAtCalls?.includes(callCount)) {
      throw new Error("simulated launch failure");
    }
    if (failAfter !== undefined && callCount > failAfter) {
      throw new Error("pthread_create: Resource temporarily unavailable (11)");
    }
    const b = makeFakeBrowser({
      newContextThrows: opts?.newContextThrowsForCalls?.includes(callCount),
      newContextThrowsDisconnects:
        opts?.newContextThrowsDisconnectsForCalls?.includes(callCount),
      deferNewContext: opts?.deferNewContextForCalls?.includes(callCount),
    });
    launched.push(b);
    if (opts?.parkLaunchForCalls?.includes(callCount)) {
      // The browser object exists but the launch is still "in flight": park the
      // resolve so a concurrent teardown can run while the launch is mid-startup.
      // A real chromium.launch() that has its target/browser closed underneath it
      // rejects with "Target page, context or browser has been closed".
      await new Promise<void>((resolve) => parkedReleases.push(resolve));
      if (!b.isConnected()) {
        throw new Error(
          "browserType.launch: Target page, context or browser has been closed",
        );
      }
    }
    return b as unknown as Browser;
  };
  return {
    launchBrowser,
    launched,
    setFailAfter(threshold) {
      failAfter = threshold;
    },
    get __parkedLaunches() {
      return parkedReleases.length;
    },
    __releaseParkedLaunches() {
      const toRelease = parkedReleases.splice(0, parkedReleases.length);
      for (const r of toRelease) r();
      return launched;
    },
  };
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

  // RACE B — a newContext() failure must never let the pool overshoot the cap.
  // Under the reservation model every (re)open holds exactly one reservation, so
  // a transient throw on a still-connected browser (post-FIX#7: retried once on
  // the SAME browser, then the caller pends as a waiter — NOT cross-recycled
  // onto a sibling) cannot push live contexts past maxContexts. This guards that
  // the cap holds across the transient-retry / pend path under concurrency.
  it("the newContext-failure retry path respects maxContexts", async () => {
    // Two browsers: browser 1 (launch call 1) throws on newContext but stays
    // connected (transient). Post-FIX#7 the first acquire retries once on
    // browser 1, then pends as a waiter rather than cross-recycling onto browser
    // 2. Concurrent acquires must still not exceed the cap.
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

    // Two concurrent acquires at a cap of 1. Whichever path each takes
    // (transient retry, pend, or a clean open on browser 2), the pool must NOT
    // open more than one live context.
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
    // Both initial browsers (launch calls 1 + 2) DIE: their newContext throws
    // AND they report disconnected (FIX #7 only recycles a DEAD browser — a
    // transient throw on a still-connected browser is retried, not recycled).
    // Their recycle relaunches (calls 3 + 4) succeed and drain the queued waiter.
    const { launchBrowser, launched } = makeFakeLauncher({
      newContextThrowsForCalls: [1, 2],
      newContextThrowsDisconnectsForCalls: [1, 2],
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
    void pool.acquire(undefined, 20).catch((e: Error) => (waiterRejected = e));
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

  // RACE C.2 — a serve that ORPHANS on a settled (timed-out) waiter must NOT
  // advance `servedContexts` toward the recycleAfter hygiene threshold. The
  // orphaned open's servedContexts++ (in openContextOn) must be rolled back in
  // the orphan-cleanup block, exactly as its liveContexts/reservation are. If
  // it isn't, the orphaned-on-timeout serve over-counts, prematurely tripping
  // the recycle threshold → an extra chromium launch (the PID pressure the
  // module avoids).
  it("does NOT advance servedContexts toward recycle when a serve orphans on a timed-out waiter", async () => {
    const { launchBrowser, launched } = makeFakeLauncher({
      deferNewContextForCalls: [1],
    });
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 1,
      // recycleAfter=4 makes the orphan the load-bearing distinction. There
      // are exactly THREE legitimately-served contexts in this test (c1, cFill,
      // c3). The orphaned serve would be a phantom 4th IF it over-counts:
      //   c1 served       → servedContexts = 1
      //   cFill served    → servedContexts = 2
      //   orphaned serve  → +1 ONLY if the orphan over-counts (the bug) → 3
      //   c3 served       → 3 (fixed) or 4 (buggy)
      // The recycle fires the instant servedContexts reaches 4. With the fix
      // the orphan rolls its servedContexts++ back, so after c3 the count is 3
      // (< 4) → NO recycle. Pre-fix the orphan leaves it at 3, so c3 brings it
      // to 4 → a premature recycle (RED).
      recycleAfter: 4,
      launchBrowser,
      launchStaggerMs: 0,
    });
    await pool.init();

    // Serve c1 (parked open → release it), then release it. servedContexts=1.
    const c1p = pool.acquire();
    await drainMicrotasks();
    launched[0]!.__releaseNewContexts();
    const c1 = await c1p;
    expect(pool.stats().inUse).toBe(1);
    await pool.release(c1);
    await drainMicrotasks();
    expect(pool.stats().totalRecycles).toBe(0);

    // Acquire to fill the cap again (parked open → release), then enqueue a
    // waiter with a SHORT timeout that pends past the cap.
    const c2p = pool.acquire();
    await drainMicrotasks();
    launched[0]!.__releaseNewContexts();
    const cFill = await c2p;
    expect(pool.stats().inUse).toBe(1);

    let waiterRejected: Error | undefined;
    const waiterP = pool
      .acquire(undefined, 20)
      .catch((e: Error) => (waiterRejected = e));
    await drainMicrotasks();

    // Release cFill → serveNextWaiter() picks the waiter, calls newContext()
    // (parked). While that open is in flight, let the 20ms timeout fire so the
    // serve orphans its freshly-opened context. The orphaned open's
    // servedContexts++ (in openContextOn) is the bug under test.
    await pool.release(cFill);
    await drainMicrotasks();
    await new Promise((r) => setTimeout(r, 40)); // waiter times out now
    expect(waiterRejected).toBeInstanceOf(Error);

    // Let the parked newContext() for the dead waiter resolve → orphan path.
    launched[0]!.__releaseNewContexts();
    await drainMicrotasks();
    await waiterP;

    // Capacity rolled back to free; orphan closed; no recycle yet.
    expect(pool.stats().inUse).toBe(0);
    expect(pool.stats().totalRecycles).toBe(0);

    // Serve + release ONE more legitimate context (c3) while idle. With the fix
    // the three real serves are c1, cFill, c3 → servedContexts = 3 <
    // recycleAfter(4) → NO recycle. Pre-fix the orphaned serve over-counted as a
    // phantom 4th, so by c3 the count reaches 4 → a premature recycle.
    const c3p = pool.acquire();
    await drainMicrotasks();
    launched[0]!.__releaseNewContexts();
    const c3 = await c3p;
    await pool.release(c3);
    await drainMicrotasks();

    // No premature recycle — the orphan did not advance servedContexts.
    expect(pool.stats().totalRecycles).toBe(0);

    await pool.shutdown();
  });

  // RACE C.3 — serveNextWaiter must NOT recycle a still-connected browser on a
  // TRANSIENT newContext() failure. This is the FIX #7 dead-vs-alive gate that
  // acquire() already enforces, propagated to serveNextWaiter. A `newContext()`
  // throw does NOT prove the browser died: on a still-`isConnected()` shared
  // browser the unfixed serveNextWaiter unconditionally recycled the entry,
  // tearing down a HEALTHY chromium AND abandoning every SIBLING live context
  // on it — exactly under saturation (a waiter is queued), this module's target
  // load. The fixed path leaves the live browser intact, re-queues the waiter,
  // and re-drives the queue so the waiter is served once the open succeeds.
  it("does NOT recycle a still-connected browser when serveNextWaiter hits a transient newContext failure", async () => {
    const { launchBrowser, launched } = makeFakeLauncher();
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 2, // room for a sibling (c1) to stay live during the serve
      recycleAfter: 1000, // hygiene out of the picture; this is the FIX #7 path
      launchBrowser,
      launchStaggerMs: 0,
    });
    await pool.init();

    // Fill the cap with two contexts on the single browser (both open cleanly).
    const c1 = await pool.acquire();
    const c2 = await pool.acquire();
    expect(pool.stats().inUse).toBe(2);
    expect(launched.length).toBe(1);
    expect(launched[0]!.isConnected()).toBe(true);

    // Enqueue a waiter (generous timeout) — it pends past the full cap.
    const waiterP = pool.acquire(undefined, 5_000);
    await drainMicrotasks();

    // Arm a SINGLE transient throw for the upcoming serve, then release c2 →
    // serveNextWaiter() picks the waiter and calls newContext(), which throws
    // transiently on the still-connected browser (isConnected stays true).
    launched[0]!.__armTransientThrow(1);
    await pool.release(c2);
    await drainMicrotasks();

    // The browser must NOT have been recycled (it is still connected — the
    // throw was transient). Pre-fix: serveNextWaiter recycled it → totalRecycles
    // === 1, the process is torn down, and c1 (the sibling) is abandoned.
    expect(pool.stats().totalRecycles).toBe(0);
    expect(launched.length).toBe(1);
    expect(launched[0]!.isConnected()).toBe(true);

    // The sibling context c1 is still live and usable (not abandoned by a
    // spurious recycle teardown).
    expect(pool.stats().inUse).toBeGreaterThanOrEqual(1);

    // The re-driven serve re-opens successfully on the SAME live browser and
    // resolves the queued waiter — no extra chromium launch.
    const served = await waiterP;
    expect(launched.length).toBe(1);
    expect(pool.stats().totalRecycles).toBe(0);

    await pool.release(c1);
    await pool.release(served);
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
  ): {
    servedContexts: number;
    recyclePending: boolean;
    pendingOpens: number;
  } =>
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
    const wP = pool.acquire(undefined, 20).catch((e: Error) => (wRejected = e));
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
    //
    // A's open is ABOUT to be orphaned by the crash recycle below. Under the
    // crash-recovery acquire path, an acquire whose in-flight open is orphaned
    // re-enqueues as a FIFO waiter — and here the freed slot is consumed by
    // waiter B (cap=1), so A's waiter is never served and only settles when A's
    // own acquire timeout fires. Give A a SHORT, bounded timeout so the trailing
    // `await aP` settles deterministically (A times out + is caught) instead of
    // racing the suite's 5s test deadline. The assertions below (B served from
    // the freed capacity, inUse === 1) are what BUG3 actually verifies; A's fate
    // is just "settles, does not wedge".
    let aDone = false;
    const aP = pool
      .acquire(undefined, 200)
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

  // ── STAGING-OUTAGE REGRESSIONS (PID-ceiling thread exhaustion) ────────────
  // Reproduces the 10:41–10:57Z outage: the container hit `pthread_create:
  // Resource temporarily unavailable (errno 11)` — OS thread/PID-ceiling
  // exhaustion. Every long-lived chromium disconnected; the crash-recovery
  // relaunch path looped, and every relaunch failure spliced a browser OUT of
  // the set until it EMPTIED. After that, pickLeastLoaded() returned undefined
  // forever → every acquire() enqueued a waiter that hit the 30s timeout → all
  // dashboard cells RED, and the pool sat PERMANENTLY DEAD until a manual
  // redeploy. The signal was ALSO silent: degraded=red only emitted on init()
  // failure, never on mid-life set death.

  // RED (pre-fix) → GREEN (post-fix): all browsers crash AND every relaunch
  // fails (persistent pthread EAGAIN). Pre-fix the pool evicted every entry,
  // the set emptied, NO degraded alarm fired, and acquire() wedged forever
  // (timeout). Post-fix: the moment the set empties the degraded alarm fires
  // (onDegraded called + browser-pool.set-empty-degraded logged), so the
  // outage is no longer silent.
  it("OUTAGE: fires a degraded alarm (not silent) when the browser set empties from a relaunch storm", async () => {
    // init launches 2 browsers (calls 1+2). Everything AFTER call 2 fails —
    // i.e. every crash-recovery relaunch throws the pthread EAGAIN.
    const launcher = makeFakeLauncher({ failAfterCall: 2 });
    const { logger, events } = makeLeveledLogger();
    let degradedCalls = 0;
    const pool = new BrowserPool({
      browsers: 2,
      maxContexts: 4,
      logger,
      launchBrowser: launcher.launchBrowser,
      launchStaggerMs: 0,
      relaunchMaxRetries: 0, // fail-fast: one relaunch attempt, then evict
      relaunchBackoffMs: 0,
      // Self-heal cannot succeed (kernel stays exhausted), so it must keep
      // retrying without throwing; keep its interval tiny for the test.
      selfHealIntervalMs: 5,
      onDegraded: () => {
        degradedCalls++;
      },
    });
    await pool.init();
    expect(launcher.launched.length).toBe(2);

    // Crash BOTH browsers — each triggers a recovery recycle whose relaunch
    // throws, evicting the entry. The second eviction empties the set.
    launcher.launched[0]!.__crash();
    launcher.launched[1]!.__crash();

    // INVARIANT (post-fix): the degraded alarm fired exactly the moment the set
    // emptied. Pre-fix nothing was emitted on mid-life death → degradedCalls
    // stayed 0 and the only signal was per-cell acquire timeouts.
    await waitFor(() => degradedCalls >= 1);
    expect(degradedCalls).toBeGreaterThanOrEqual(1);
    expect(
      events.some((e) => e.event === "browser-pool.set-empty-degraded"),
    ).toBe(true);

    await pool.shutdown();
  });

  // GREEN: self-heal. The set empties (relaunch storm) and then the kernel
  // RELAXES (threads free up). Pre-fix the pool stayed permanently dead even
  // after the kernel recovered — it required a manual redeploy. Post-fix the
  // background self-heal loop relaunches a fresh set the moment a launch
  // succeeds, fires onRecovered, and a subsequent acquire() succeeds.
  it("OUTAGE: self-heals (re-inits a fresh browser set) once the kernel relaxes, instead of staying dead", async () => {
    const launcher = makeFakeLauncher({ failAfterCall: 1 });
    const { logger, events } = makeLeveledLogger();
    let recovered = 0;
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 2,
      logger,
      launchBrowser: launcher.launchBrowser,
      launchStaggerMs: 0,
      relaunchMaxRetries: 0,
      relaunchBackoffMs: 0,
      selfHealIntervalMs: 5,
      onRecovered: () => {
        recovered++;
      },
    });
    await pool.init();
    expect(launcher.launched.length).toBe(1);

    // Crash the only browser → relaunch fails → set empties → self-heal begins
    // (but keeps failing while the kernel is still exhausted). Wait for the
    // set-empty alarm so we heal AFTER the set has genuinely died (healing
    // before the failed relaunch would let the crash recycle succeed and the
    // set would never empty — no self-heal to observe).
    launcher.launched[0]!.__crash();
    await waitFor(() =>
      events.some((e) => e.event === "browser-pool.set-empty-degraded"),
    );

    // "Heal" the kernel: subsequent launches now succeed.
    launcher.setFailAfter(undefined);

    // The self-heal loop revives the set and fires onRecovered.
    await waitFor(() => recovered >= 1, 5_000);
    expect(recovered).toBeGreaterThanOrEqual(1);

    // The pool is alive again: a fresh acquire succeeds (no timeout, no wedge).
    const ctx = await pool.acquire(undefined, 2_000);
    expect(ctx).toBeDefined();
    expect(pool.stats().inUse).toBe(1);

    await pool.release(ctx);
    await pool.shutdown();
  });

  // GREEN: a queued waiter pending during the dead window is SERVED by the
  // self-heal relaunch (not left to time out) once the kernel relaxes.
  it("OUTAGE: a waiter queued during the dead window is served by self-heal after recovery", async () => {
    const launcher = makeFakeLauncher({ failAfterCall: 1 });
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 2,
      launchBrowser: launcher.launchBrowser,
      launchStaggerMs: 0,
      relaunchMaxRetries: 0,
      relaunchBackoffMs: 0,
      selfHealIntervalMs: 5,
    });
    await pool.init();

    // Crash the browser → set empties.
    launcher.launched[0]!.__crash();
    await waitFor(() => pool.stats().inUse === 0);

    // Enqueue an acquire while the pool is dead — it pends (set empty,
    // pickLeastLoaded undefined). Generous timeout so self-heal can serve it.
    let served: BrowserContext | undefined;
    const acquireP = pool.acquire(undefined, 5_000).then((c) => (served = c));
    await drainMicrotasks();
    expect(served).toBeUndefined();

    // Heal the kernel; self-heal revives the set and drains the waiter.
    launcher.setFailAfter(undefined);
    await acquireP;
    expect(served).toBeDefined();
    expect(pool.stats().inUse).toBe(1);

    await pool.release(served!);
    await pool.shutdown();
  });

  // GREEN (fix #1): a TRANSIENT pthread EAGAIN on relaunch is RETRIED with
  // backoff and survives — the entry is NOT evicted and the set never empties.
  // The unfixed code evicted on the first relaunch throw; here the first
  // relaunch attempt fails but the retry (after the kernel relaxes) succeeds,
  // so totalRecycles advances, the browser count is preserved, and no degraded
  // alarm fires.
  it("backpressure: a transient relaunch EAGAIN is retried and the entry survives (no eviction, no alarm)", async () => {
    // init = call 1. Make call 2 (the first relaunch attempt) fail, then heal
    // so the retry (call 3) succeeds.
    const launcher = makeFakeLauncher({ failAfterCall: 1 });
    const { logger, events } = makeLeveledLogger();
    let degradedCalls = 0;
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 2,
      logger,
      launchBrowser: launcher.launchBrowser,
      launchStaggerMs: 0,
      relaunchMaxRetries: 3,
      relaunchBackoffMs: 1,
      selfHealIntervalMs: 5,
      onDegraded: () => {
        degradedCalls++;
      },
    });
    await pool.init();
    expect(launcher.launched.length).toBe(1);

    // Crash the only browser → crash recycle's FIRST relaunch attempt (call 2)
    // throws the pthread EAGAIN. Wait for that failed-attempt log, THEN heal so
    // the backoff retry (call 3) succeeds — proving the retry rescued the entry.
    launcher.launched[0]!.__crash();
    await waitFor(() =>
      events.some((e) => e.event === "browser-pool.relaunch-attempt-failed"),
    );
    launcher.setFailAfter(undefined);

    // The entry is preserved via the retry — set never empties, no alarm.
    await waitFor(() => pool.stats().totalRecycles >= 1);
    // A fresh browser was launched by the retry (init=1, failed attempt=2,
    // successful retry=3).
    await waitFor(() => launcher.launched.length === 2);
    expect(launcher.launched.length).toBe(2);
    expect(degradedCalls).toBe(0);
    expect(
      events.some((e) => e.event === "browser-pool.relaunch-attempt-failed"),
    ).toBe(true);

    // The pool is healthy: acquire succeeds on the retried browser.
    const ctx = await pool.acquire(undefined, 2_000);
    expect(ctx).toBeDefined();
    await pool.release(ctx);
    await pool.shutdown();
  });

  // ── SELF-HEAL CIRCUIT-BREAKER (durable fix for the RECURRING wedge) ─────────
  //
  // The RECURRING staging BrowserPool collapse (#5185/#5221/#5225 each chipped
  // at it but it kept recurring): after the long-lived harness container runs
  // ~hours under sustained d6 cron load, chromium enters a LAUNCH crash-loop —
  // every `chromium.launch()` throws `browserType.launch: Target page, context
  // or browser has been closed`. The set empties, `startSelfHeal()` kicks in,
  // and its loop just RELAUNCHES into the SAME wedged state forever
  // (`self-heal-launch-failed` repeating) — backing off between identical
  // attempts but NEVER escaping (the wedge is the cgroup PID/thread ceiling, a
  // platform-fixed demand-side ceiling an immediate relaunch only re-pins).
  // acquire() therefore has no
  // contexts forever → blocks to timeout fleet-wide. Only a container RESTART
  // cleared it (reactive). The circuit-breaker makes the loop ESCAPE: after N
  // consecutive launch failures it HARD-recovers (a PACED cold relaunch — gives
  // the thread-exhausted kernel time to relax; NO /tmp purge); if even K hard
  // recoveries fail it fires a LOUD
  // pool-unrecoverable alarm instead of spinning silently.

  // RED (pre-breaker) → GREEN (post-breaker): chromium is wedged (every launch
  // throws "...has been closed"). PRE-breaker the self-heal loop relaunches
  // identically forever and acquire() never gets a context (wedged). POST-breaker
  // the breaker trips at the threshold, the HARD recovery PACES a cold relaunch
  // (gives the kernel time to relax — modeled here by the pacing "unwedging" the
  // launcher) and the pool cold-launches fresh, so acquire() succeeds again.
  it("OUTAGE: circuit-breaker hard-recovers (paced cold relaunch) out of a chromium launch-crash-loop the plain self-heal could not escape", async () => {
    // init launches 1 browser (call 1). Everything AFTER call 1 throws the
    // "...has been closed" launch-crash-loop error — modeling the wedged
    // container. The PROVEN wedge (cgroup PID/thread-ceiling exhaustion) relaxes
    // over time, so the hard recovery is a PACED cold relaunch: after the
    // threshold of consecutive failures the breaker backs off, then flips the
    // launcher healthy (the kernel relaxing) so the subsequent cold launch
    // succeeds. Without the breaker's give-up backstop the loop would spin into
    // the same wedge forever with no operator signal.
    const launcher = makeFakeLauncher({ failAfterCall: 1 });
    const { logger, events } = makeLeveledLogger();
    let hardRecoveries = 0;
    let recovered = 0;
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 2,
      logger,
      launchBrowser: launcher.launchBrowser,
      launchStaggerMs: 0,
      relaunchMaxRetries: 0,
      relaunchBackoffMs: 0,
      selfHealIntervalMs: 1,
      // Trip the hard recovery after 3 consecutive self-heal launch failures.
      selfHealHardRecoveryThreshold: 3,
      selfHealMaxHardRecoveries: 3,
      onRecovered: () => {
        recovered++;
      },
    });
    await pool.init();
    expect(launcher.launched.length).toBe(1);

    // Crash the only browser → crash recycle's relaunch throws (wedged) → set
    // empties → self-heal begins, but every relaunch keeps throwing the
    // "...has been closed" error. The plain self-heal would loop here forever.
    launcher.launched[0]!.__crash();

    // BREAKER PROOF: after the threshold of consecutive failures the hard
    // recovery fires (paced cold relaunch). The moment we observe it, flip the
    // launcher healthy (modeling the PID/thread ceiling relaxing) so the NEXT
    // cold relaunch succeeds and the pool revives to full strength + onRecovered.
    await waitFor(
      () =>
        events.some((e) => e.event === "browser-pool.self-heal-hard-recovery"),
      5_000,
    );
    hardRecoveries = events.filter(
      (e) => e.event === "browser-pool.self-heal-hard-recovery",
    ).length;
    launcher.setFailAfter(undefined);

    await waitFor(() => recovered >= 1, 5_000);
    expect(hardRecoveries).toBeGreaterThanOrEqual(1);
    expect(
      events.some((e) => e.event === "browser-pool.self-heal-hard-recovery"),
    ).toBe(true);

    // The pool is alive again: a fresh acquire succeeds (no timeout, no wedge).
    const ctx = await pool.acquire(undefined, 2_000);
    expect(ctx).toBeDefined();
    expect(pool.stats().inUse).toBe(1);

    await pool.release(ctx);
    await pool.shutdown();
  });

  // PROOF the breaker fires AT the threshold, not before. With threshold=3 the
  // first 3 consecutive failures must NOT trigger a hard recovery; only the
  // attempt past the threshold does.
  it("circuit-breaker: fires the hard recovery only AFTER the consecutive-failure threshold is reached", async () => {
    const launcher = makeFakeLauncher({ failAfterCall: 1 });
    const { logger, events } = makeLeveledLogger();
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 2,
      logger,
      launchBrowser: launcher.launchBrowser,
      launchStaggerMs: 0,
      relaunchMaxRetries: 0,
      relaunchBackoffMs: 0,
      selfHealIntervalMs: 1,
      selfHealHardRecoveryThreshold: 3,
      selfHealMaxHardRecoveries: 5,
    });
    await pool.init();
    launcher.launched[0]!.__crash();

    // Wait until the first hard recovery has fired.
    await waitFor(
      () =>
        events.some((e) => e.event === "browser-pool.self-heal-hard-recovery"),
      5_000,
    );

    // At the moment the FIRST hard recovery fired, at least `threshold`
    // consecutive self-heal launch failures must have been logged first (the
    // breaker does not fire early).
    const firstHardRecoveryIdx = events.findIndex(
      (e) => e.event === "browser-pool.self-heal-hard-recovery",
    );
    const failuresBeforeFirstHardRecovery = events
      .slice(0, firstHardRecoveryIdx)
      .filter((e) => e.event === "browser-pool.self-heal-launch-failed").length;
    expect(failuresBeforeFirstHardRecovery).toBeGreaterThanOrEqual(3);

    await pool.shutdown();
  });

  // RED (pre-breaker, silent spin) → GREEN: if even the HARD recovery (the paced
  // cold relaunch) cannot break the wedge — e.g. the PID/thread ceiling never
  // relaxes — the breaker gives up LOUDLY after K hard recoveries with a
  // `pool-unrecoverable` alarm and stops the heal loop, rather than spinning
  // self-heal-launch-failed forever with no operator signal.
  it("OUTAGE: circuit-breaker surfaces a loud pool-unrecoverable alarm (and stops) when even hard recovery cannot escape the wedge", async () => {
    // Permanently wedged: launches throw forever (the ceiling never relaxes).
    const launcher = makeFakeLauncher({ failAfterCall: 1 });
    const { logger, events } = makeLeveledLogger();
    let unrecoverableCalls = 0;
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 2,
      logger,
      launchBrowser: launcher.launchBrowser,
      launchStaggerMs: 0,
      relaunchMaxRetries: 0,
      relaunchBackoffMs: 0,
      selfHealIntervalMs: 1,
      selfHealHardRecoveryThreshold: 2,
      selfHealMaxHardRecoveries: 2,
      onUnrecoverable: () => {
        unrecoverableCalls++;
      },
    });
    await pool.init();
    launcher.launched[0]!.__crash();

    // The breaker hard-recovers twice (each preceded by `threshold` failures),
    // both fail, and then it gives up LOUDLY.
    await waitFor(() => unrecoverableCalls >= 1, 5_000);
    expect(unrecoverableCalls).toBe(1);
    const hardRecoveries = events.filter(
      (e) => e.event === "browser-pool.self-heal-hard-recovery",
    ).length;
    expect(hardRecoveries).toBeGreaterThanOrEqual(2);
    expect(
      events.some((e) => e.event === "browser-pool.pool-unrecoverable"),
    ).toBe(true);

    // The heal loop has STOPPED (not spinning) — the failure count stabilizes.
    const failuresAtGiveUp = events.filter(
      (e) => e.event === "browser-pool.self-heal-launch-failed",
    ).length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    const failuresAfter = events.filter(
      (e) => e.event === "browser-pool.self-heal-launch-failed",
    ).length;
    expect(failuresAfter).toBe(failuresAtGiveUp);

    await pool.shutdown();
  });

  // MULTI-BROWSER (shortfall > 1) breaker pacing. Every prior breaker test runs
  // browsers:1, leaving the multi-browser pacing of consecutiveFailures /
  // consecutiveHardRecoveries unverified. Here browsers:2: the set empties, the
  // heal loop must top BOTH back up. We let it revive ONE browser (partial
  // success) while the second relaunch in the SAME shortfall pass fails — the
  // partial success must RESET the consecutive-failure counter so the breaker
  // does NOT trip a premature hard recovery, then the loop tops up the second
  // browser on a later iteration and recovers to full strength.
  it("MULTI-BROWSER: a partial revive resets the breaker's consecutive-failure counter (no premature hard recovery)", async () => {
    // init launches 2 (calls 1,2). Crash both → set empties → heal loop runs.
    // Shape the launcher so the heal sequence is: fail, fail, fail (trip toward
    // threshold) … then SUCCEED once (partial revive — must reset the counter) …
    // then succeed again (full strength). If the counter did NOT reset on the
    // partial success, a hard recovery would fire; we assert it does NOT.
    let recovered = 0;
    const { logger, events } = makeLeveledLogger();

    // Custom launcher: init's 2 launches succeed; the next `failStreak` relaunch
    // attempts fail; everything after succeeds. With threshold=4 and a 3-failure
    // streak BEFORE the first success, the breaker must NOT trip (3 < 4), and the
    // success resets the streak so the remaining top-up never trips it either.
    let call = 0;
    const failStreak = 3;
    const initLaunches = 2;
    const launched: FakeBrowser[] = [];
    const launchBrowser: LaunchBrowser = async () => {
      call++;
      if (call > initLaunches && call <= initLaunches + failStreak) {
        throw new Error(
          "browserType.launch: Target page, context or browser has been closed",
        );
      }
      const b = makeFakeBrowser({});
      launched.push(b);
      return b as unknown as Browser;
    };

    const pool = new BrowserPool({
      browsers: 2,
      maxContexts: 4,
      logger,
      launchBrowser,
      launchStaggerMs: 0,
      relaunchMaxRetries: 0,
      relaunchBackoffMs: 0,
      selfHealIntervalMs: 1,
      selfHealHardRecoveryThreshold: 4,
      selfHealMaxHardRecoveries: 3,
      onRecovered: () => {
        recovered++;
      },
    });
    await pool.init();
    expect(launched.length).toBe(2);

    // Crash both → both recycle relaunches fail (in the failStreak window) → set
    // empties → heal loop begins, burns the rest of the streak, then revives.
    launched[0]!.__crash();
    launched[1]!.__crash();

    // The pool comes back to FULL strength (2 browsers) and fires onRecovered.
    await waitFor(() => recovered >= 1, 5_000);

    // The breaker NEVER tripped a hard recovery: the 3-failure streak stayed
    // below the threshold of 4, and the partial revive reset the counter so the
    // second top-up launch could not push a stale counter over the line.
    expect(
      events.some((e) => e.event === "browser-pool.self-heal-hard-recovery"),
    ).toBe(false);
    // Full strength restored.
    expect(pool.stats().size).toBe(4); // maxContexts is the reported size
    const live = launched.filter((b) => b.isConnected());
    expect(live.length).toBe(2);

    await pool.shutdown();
  });

  // LATCH SECOND-EPISODE (the silent-spin the breaker exists to kill). The give-up
  // path must be able to fire its alarm on EACH distinct degraded episode. The
  // unfixed code latched `this.unrecoverable` after the first give-up and cleared
  // it ONLY on a successful launch, so a pool that gave up, briefly revived, then
  // re-wedged into a SECOND give-up was silent on the second episode under any
  // ordering where the latch outlived the episode boundary. The fix removes the
  // instance latch (the loop-local consecutiveHardRecoveries guard already gives
  // once-per-episode), so each fresh self-heal spawn can alarm.
  //
  // This drives TWO distinct degraded episodes on ONE permanently-wedged pool.
  // Episode 1: the set empties and the breaker gives up (alarm #1), then the
  // heal loop EXITS (by design — `pool-unrecoverable (and stops)` asserts this).
  // Episode 2: the set is STILL wedged and empties AGAIN (the fresh degraded
  // episode the comment on `onBrowserSetEmpty` describes: "set empties AGAIN
  // while degraded is still true but NO heal loop is running"). That re-spawns a
  // fresh heal loop which must be able to fire its OWN alarm (#2). The unfixed
  // instance latch (`this.unrecoverable`, set on the first give-up and cleared
  // ONLY by a successful launch — which never happens while wedged) made the
  // second give-up SILENT. We trigger the second episode via the private
  // empty-set entrypoint, the same call the recycle-eviction path makes.
  it("LATCH: a second degraded episode ALSO fires onUnrecoverable (not silenced by a stale latch)", async () => {
    const launcher = makeFakeLauncher({ failAfterCall: 1 });
    const { logger, events } = makeLeveledLogger();
    let unrecoverableCalls = 0;
    const infos: Array<{ browserCount: number; maxHardRecoveries: number }> =
      [];
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 2,
      logger,
      launchBrowser: launcher.launchBrowser,
      launchStaggerMs: 0,
      relaunchMaxRetries: 0,
      relaunchBackoffMs: 0,
      selfHealIntervalMs: 1,
      selfHealHardRecoveryThreshold: 2,
      selfHealMaxHardRecoveries: 2,
      onUnrecoverable: (info) => {
        unrecoverableCalls++;
        infos.push({
          browserCount: info.browserCount,
          maxHardRecoveries: info.maxHardRecoveries,
        });
      },
    });
    await pool.init();

    // Private hooks: the empty-set entrypoint + the selfHealing guard so we can
    // wait for episode 1's loop to fully EXIT before triggering episode 2 (the
    // recycle path itself calls onBrowserSetEmpty when browsers.length===0).
    const priv = pool as unknown as {
      onBrowserSetEmpty(): void;
      selfHealing: boolean;
    };

    // EPISODE 1: crash the only browser → wedged → breaker gives up (#1) → loop
    // exits (selfHealing flips back to false).
    launcher.launched[0]!.__crash();
    await waitFor(() => unrecoverableCalls >= 1, 5_000);
    expect(unrecoverableCalls).toBe(1);
    await waitFor(() => priv.selfHealing === false, 5_000);

    // EPISODE 2: the container is STILL wedged and the set empties AGAIN. This is
    // the fresh degraded episode — re-spawn the heal loop via the same empty-set
    // entrypoint the recycle-eviction path uses. The breaker must be able to fire
    // its alarm a SECOND time (the stale latch previously silenced it).
    priv.onBrowserSetEmpty();
    await waitFor(() => unrecoverableCalls >= 2, 8_000);
    expect(unrecoverableCalls).toBe(2);
    // The alarm carried the breaker counters both times.
    expect(infos.every((i) => i.browserCount === 1)).toBe(true);
    expect(
      events.filter((e) => e.event === "browser-pool.pool-unrecoverable")
        .length,
    ).toBe(2);

    await pool.shutdown();
  });

  // FOOTGUN CLAMP. The breaker guards are `> 0`, so a `selfHealHardRecovery
  // Threshold` / `selfHealMaxHardRecoveries` of 0 (a config typo) would silently
  // DISABLE both the hard recovery AND the give-up — reverting to the infinite
  // silent spin this PR fixes. The fix CLAMPS resolved thresholds up to >= 1, so
  // a 0 can't disable the safety net. With both passed as 0 (→ clamped to 1) a
  // permanently-wedged pool MUST still hard-recover and then give up loudly.
  it("FOOTGUN: a 0 breaker threshold is clamped to 1 (breaker stays armed, not silently disabled)", async () => {
    const launcher = makeFakeLauncher({ failAfterCall: 1 });
    const { logger, events } = makeLeveledLogger();
    let unrecoverableCalls = 0;
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 2,
      logger,
      launchBrowser: launcher.launchBrowser,
      launchStaggerMs: 0,
      relaunchMaxRetries: 0,
      relaunchBackoffMs: 0,
      selfHealIntervalMs: 1,
      // The footgun: 0 would disable the `> 0` guards under the unfixed code.
      selfHealHardRecoveryThreshold: 0,
      selfHealMaxHardRecoveries: 0,
      onUnrecoverable: () => {
        unrecoverableCalls++;
      },
    });
    await pool.init();
    launcher.launched[0]!.__crash();

    // Clamped to 1: the breaker hard-recovers AND gives up loudly instead of
    // spinning forever. Without the clamp, neither would fire (silent spin).
    await waitFor(() => unrecoverableCalls >= 1, 5_000);
    expect(unrecoverableCalls).toBe(1);
    expect(
      events.some((e) => e.event === "browser-pool.self-heal-hard-recovery"),
    ).toBe(true);
    expect(
      events.some((e) => e.event === "browser-pool.pool-unrecoverable"),
    ).toBe(true);

    await pool.shutdown();
  });

  // ── CR-FIX BUCKET A: crash-recovery / self-heal / accounting bugs ──────────

  // FIX #5 — pickLeastLoaded must rank by liveContexts.size + pendingOpens, not
  // liveContexts.size alone. Under a BURST of concurrent opens (all parked in
  // newContext()), the unfixed ranker sees every browser at liveContexts.size=0
  // and stacks the WHOLE burst onto browser 0 — the per-process context pileup
  // that drove the pthread_create EAGAIN thread spike. RED pre-fix (all on b0);
  // GREEN post-fix (spread across the set as each open reserves).
  it("FIX#5: spreads a burst of concurrent opens across browsers instead of stacking on one (counts pendingOpens)", async () => {
    const { launchBrowser, launched } = makeFakeLauncher({
      // Every browser DEFERS its newContext so all opens are simultaneously
      // in-flight (pendingOpens) and none has settled into liveContexts yet.
      deferNewContextForCalls: [1, 2, 3],
    });
    const pool = new BrowserPool({
      browsers: 3,
      maxContexts: 9,
      recycleAfter: 1000,
      launchBrowser,
      launchStaggerMs: 0,
    });
    await pool.init();
    expect(launched.length).toBe(3);

    // Fire 3 concurrent acquires. Each reserves a slot and parks in
    // newContext(). With pendingOpens-aware ranking they must land one-per
    // browser; the unfixed ranker would put all 3 on browser 0.
    const ps = [pool.acquire(), pool.acquire(), pool.acquire()];
    await drainMicrotasks();

    expect(launched[0]!.__pendingNewContexts).toBe(1);
    expect(launched[1]!.__pendingNewContexts).toBe(1);
    expect(launched[2]!.__pendingNewContexts).toBe(1);

    // Release all parked opens and let the acquires resolve.
    for (const b of launched) b.__releaseNewContexts();
    const ctxs = await Promise.all(ps);
    expect(ctxs.length).toBe(3);

    // Each browser ended with exactly one live context — load is balanced.
    for (const b of launched) {
      expect(b.__contexts.length).toBe(1);
    }

    for (const c of ctxs) await pool.release(c);
    await pool.shutdown();
  });

  // FIX #7 — a transient newContext() throw on a STILL-CONNECTED shared browser
  // must NOT recycle it (which would tear down the healthy process and abandon
  // its sibling live contexts). The unfixed first-attempt catch recycled
  // unconditionally. RED pre-fix: totalRecycles advances + the sibling context
  // is abandoned (inUse desync); GREEN post-fix: no recycle, sibling intact.
  it("FIX#7: a transient newContext error on a connected browser does NOT recycle it or abandon siblings", async () => {
    let connected = true;
    let throwOnce = false;
    const closeCounts = { browser: 0 };
    // Track the FIRST (sibling) context BY IDENTITY: its own close() sets the
    // flag, so the assertion is genuinely falsifiable (a spurious recycle that
    // tore down the browser would close this exact object → closed=true). The
    // old length-based detection (`if (ctxs.length === 1)`) was tautological:
    // contexts were never removed from `ctxs`, so once both opened the length
    // was permanently 2 and the flag could never be set regardless of behavior.
    const siblingCtx: { closed: boolean } = { closed: false };
    // Hand-rolled fake browser: stays connected, throws newContext ONCE on
    // demand (transient), otherwise returns a context.
    const makeBrowser = (): Browser => {
      let openCount = 0;
      const handlers: Array<() => void> = [];
      return {
        isConnected: () => connected,
        on: (_e: string, h: () => void) => handlers.push(h),
        close: async () => {
          closeCounts.browser++;
          connected = false;
        },
        newContext: async () => {
          if (throwOnce) {
            throwOnce = false;
            throw new Error(
              "transient newContext failure (browser still alive)",
            );
          }
          const isSibling = openCount === 0;
          openCount++;
          const c = {
            close: async () => {
              // Flag THIS specific object closing — identity-based, not
              // length-based — so closing the sibling (the only way the flag
              // flips) is what a spurious recycle teardown would actually do.
              if (isSibling) siblingCtx.closed = true;
            },
          };
          return c as unknown as BrowserContext;
        },
      } as unknown as Browser;
    };
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 4,
      recycleAfter: 1000,
      launchBrowser: async () => makeBrowser(),
      launchStaggerMs: 0,
    });
    await pool.init();

    // Open a sibling context that will be live throughout.
    const sibling = await pool.acquire();
    expect(pool.stats().inUse).toBe(1);

    // Next acquire's first newContext THROWS transiently; the browser is still
    // connected. Post-fix: the pool retries on the same browser (no recycle).
    throwOnce = true;
    const ctx = await pool.acquire();
    expect(ctx).toBeDefined();

    // INVARIANT: no recycle fired (the connected browser was not destroyed) and
    // the sibling context was NOT abandoned/closed.
    expect(pool.stats().totalRecycles).toBe(0);
    expect(closeCounts.browser).toBe(0);
    expect(siblingCtx.closed).toBe(false);
    expect(pool.stats().inUse).toBe(2);

    await pool.release(sibling);
    await pool.release(ctx);
    await pool.shutdown();
  });

  // FIX #3 — a crashed browser whose in-flight newContext() NEVER settles must
  // not permanently inflate liveContextCount. The reservation is taken
  // (inUse++) before the await; if the browser dies and the promise hangs
  // forever, the unfixed code never rolled the reservation back → capacity bled
  // to a wedge. RED pre-fix (inUse stuck at 1 forever); GREEN post-fix (crash
  // teardown rolls back the in-flight reservation → inUse returns to 0).
  it("FIX#3: a crashed-and-never-settling open does not permanently inflate liveContextCount", async () => {
    const { launchBrowser, launched } = makeFakeLauncher({
      deferNewContextForCalls: [1], // browser0 parks its newContext forever
      // Relaunch (call 2+) succeeds with a normal (non-deferred) browser.
    });
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 2,
      recycleAfter: 1000,
      launchBrowser,
      launchStaggerMs: 0,
      relaunchMaxRetries: 0,
      relaunchBackoffMs: 0,
      selfHealIntervalMs: 5,
    });
    await pool.init();

    // Start an acquire — parks in newContext() on browser0 (reservation taken,
    // inUse=1, pendingOpens=1). It stays parked across the crash (a crashed
    // chromium's newContext can hang indefinitely).
    let settled = false;
    let stuckCtx: BrowserContext | undefined;
    const acquireP = pool
      .acquire(undefined, 1_000)
      .then((c) => {
        settled = true;
        stuckCtx = c;
      })
      .catch(() => (settled = true));
    await drainMicrotasks();
    expect(launched[0]!.__pendingNewContexts).toBe(1);
    expect(pool.stats().inUse).toBe(1);

    // CRASH browser0 while its open is in flight and never settles. The crash
    // teardown must account for the in-flight reservation.
    launched[0]!.__crash();
    await drainMicrotasks();

    // INVARIANT: the never-settling open's reservation is rolled back; inUse
    // drains back to 0 rather than staying permanently at 1. (The acquire promise
    // is STILL parked — proving the rollback happened WITHOUT the open settling,
    // i.e. the dead open does not permanently inflate the count.)
    expect(pool.stats().inUse).toBe(0);
    expect(settled).toBe(false);

    // The pool remains usable at full capacity (no permanent bleed): both slots
    // are acquirable again after recovery.
    await waitFor(() => launched.length >= 2);
    const a = await pool.acquire(undefined, 1_000);
    const b = await pool.acquire(undefined, 1_000);
    expect(pool.stats().inUse).toBe(2);
    await pool.release(a);
    await pool.release(b);
    expect(pool.stats().inUse).toBe(0);

    // Now let the original parked open settle. Its orphan-guard fires (generation
    // mismatch → no double rollback of the already-reclaimed reservation); the
    // acquire then transparently retries onto the recovered browser and resolves
    // with a fresh valid context (graceful — the caller is never stuck forever).
    launched[0]!.__releaseNewContexts();
    await acquireP;
    expect(settled).toBe(true);
    expect(stuckCtx).toBeDefined();
    // Exactly the one retried context is live — no double-count from the orphan.
    expect(pool.stats().inUse).toBe(1);
    await pool.release(stuckCtx!);
    expect(pool.stats().inUse).toBe(0);

    await pool.shutdown();
  });

  // FIX #2 — pendingOpens must be reset onto the fresh generation on a
  // crash-recycle, and the late settle of an in-flight open must NOT decrement
  // the fresh generation (generation token). The unfixed relaunch block reset
  // servedContexts/liveContexts/recycling/recyclePending but NOT pendingOpens;
  // the orphan-guard decrement then applied to the relaunched generation,
  // leaving pendingOpens stuck >= 1, which permanently blocks every future
  // hygiene recycle. RED pre-fix (no hygiene recycle ever fires post-crash);
  // GREEN post-fix (entry is hygiene-recyclable again).
  it("FIX#2: crash mid-open leaves pendingOpens consistent and the entry still hygiene-recyclable", async () => {
    // browser0 defers its first open; the relaunched browser (call 2) is normal.
    const { launchBrowser, launched } = makeFakeLauncher({
      deferNewContextForCalls: [1],
    });
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 2,
      recycleAfter: 1, // a single served context makes the entry hygiene-eligible
      launchBrowser,
      launchStaggerMs: 0,
      relaunchMaxRetries: 0,
      relaunchBackoffMs: 0,
      selfHealIntervalMs: 5,
    });
    await pool.init();

    // Park an open on browser0 (pendingOpens=1), then crash it. The crash
    // teardown rolls back the in-flight reservation + bumps the generation; the
    // relaunch success block resets pendingOpens to 0 on the fresh generation.
    let stuckCtx: BrowserContext | undefined;
    const stuck = pool
      .acquire(undefined, 1_000)
      .then((c) => (stuckCtx = c))
      .catch(() => undefined);
    await drainMicrotasks();
    expect(launched[0]!.__pendingNewContexts).toBe(1);
    launched[0]!.__crash();
    await waitFor(() => launched.length >= 2);

    // Let the ORIGINAL parked open finally settle on the dead browser. Its
    // orphan-guard rollback is GENERATION-GUARDED, so it must NOT touch the
    // fresh generation's pendingOpens (the crash teardown already owns that
    // rollback). The acquire transparently retries onto the recovered browser;
    // release that context so the entry returns to idle.
    launched[0]!.__releaseNewContexts();
    await stuck;
    await drainMicrotasks();
    if (stuckCtx) await pool.release(stuckCtx);
    await waitFor(() => pool.stats().inUse === 0, 3_000);

    // CRITICAL: if the fresh-generation pendingOpens were left inconsistent
    // (the relaunch block never reset it, or a cross-generation decrement
    // corrupted it), `isEntryRecyclable` (pendingOpens === 0) would be false
    // FOREVER and NO hygiene recycle could ever fire again. Drive a fresh
    // served context and release it idle; post-fix the hygiene recycle fires —
    // proving the in-flight counter is consistent across the crash generation.
    const recyclesBefore = pool.stats().totalRecycles;
    const c = await pool.acquire(undefined, 1_000);
    expect(pool.stats().inUse).toBe(1);
    await pool.release(c); // served>=recycleAfter AND idle → hygiene recycle
    await waitFor(() => pool.stats().totalRecycles > recyclesBefore, 3_000);
    expect(pool.stats().totalRecycles).toBeGreaterThan(recyclesBefore);

    await pool.shutdown();
  });

  // FIX #4a — self-heal must restore FULL browserCount before firing
  // onRecovered / clearing degraded. The unfixed loop broke + reported recovery
  // the instant ONE browser revived, even with browserCount=3 — silent
  // under-provisioning reported green. RED pre-fix (onRecovered at 1/3); GREEN
  // post-fix (onRecovered only once the set is back to 3).
  it("FIX#4a: self-heal restores full browserCount before firing onRecovered", async () => {
    // Controllable launcher: a `successBudget` caps how many launches may
    // succeed; further launches throw the pthread EAGAIN. This lets us grant
    // PARTIAL recovery (1 of 3) and observe what the pool reports — the unfixed
    // loop fires onRecovered the instant the set is non-empty (1/3), so it would
    // report green while under-provisioned. The fix tops the set up to 3 first.
    const launched: FakeBrowser[] = [];
    let successBudget = 3; // init succeeds (3), then crashes drain the set
    const launchBrowser: LaunchBrowser = async () => {
      if (successBudget <= 0) {
        throw new Error(
          "pthread_create: Resource temporarily unavailable (11)",
        );
      }
      successBudget--;
      const b = makeFakeBrowser();
      launched.push(b);
      return b as unknown as Browser;
    };
    const { logger, events } = makeLeveledLogger();
    let recovered = 0;
    let liveCountAtRecovery = -1;
    const pool = new BrowserPool({
      browsers: 3,
      maxContexts: 6,
      logger,
      launchBrowser,
      launchStaggerMs: 0,
      relaunchMaxRetries: 0,
      relaunchBackoffMs: 0,
      selfHealIntervalMs: 5,
      onRecovered: () => {
        recovered++;
        liveCountAtRecovery = launched.filter((b) => b.isConnected()).length;
      },
    });
    await pool.init();
    expect(launched.length).toBe(3);
    // successBudget is now 0 → all relaunches fail.

    // Crash all 3 → relaunches fail → set empties → self-heal begins (failing).
    for (const b of launched.slice(0, 3)) b.__crash();
    await waitFor(() =>
      events.some((e) => e.event === "browser-pool.set-empty-degraded"),
    );
    expect(recovered).toBe(0);

    // Grant PARTIAL recovery: exactly ONE launch may succeed, the rest still
    // fail. The unfixed loop would push that 1 browser, see browsers.length > 0,
    // fire onRecovered (RED — reports full recovery at 1/3) and break. The fix
    // must NOT fire yet: 1 < browserCount (3).
    successBudget = 1;
    await waitFor(() => launched.length === 4, 5_000); // the 1 partial revive
    await drainMicrotasks();
    // The fix has NOT reported recovery at 1/3.
    expect(recovered).toBe(0);

    // Now grant the full remainder: self-heal tops the set up to 3 and only THEN
    // fires onRecovered.
    successBudget = 10;
    await waitFor(() => recovered >= 1, 5_000);
    expect(recovered).toBe(1);
    // At the moment onRecovered fired the set was at FULL strength (3), not 1.
    expect(liveCountAtRecovery).toBe(3);

    // The pool is at full strength: acquiring all 6 context slots succeeds.
    const acquired: BrowserContext[] = [];
    for (let i = 0; i < 6; i++) {
      acquired.push(await pool.acquire(undefined, 2_000));
    }
    expect(pool.stats().inUse).toBe(6);

    for (const c of acquired) await pool.release(c);
    await pool.shutdown();
  });

  // FIX #4b — back-to-back empties must always leave an active heal path. If the
  // set empties again while `degraded` is still true but no heal loop is
  // running, the unfixed `if (degraded) return` guard left
  // degraded+empty+!selfHealing as a TERMINAL dead state. Post-fix every empty
  // (re)spawns the heal loop. We drive: empty → self-heal revives 1 → that
  // survivor crashes and re-empties → self-heal must run again and recover.
  it("FIX#4b: a re-empty while degraded re-spawns the heal loop (no terminal dead state)", async () => {
    const launcher = makeFakeLauncher({ failAfterCall: 1 });
    const { logger, events } = makeLeveledLogger();
    let recovered = 0;
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 2,
      logger,
      launchBrowser: launcher.launchBrowser,
      launchStaggerMs: 0,
      relaunchMaxRetries: 0,
      relaunchBackoffMs: 0,
      selfHealIntervalMs: 5,
      onRecovered: () => {
        recovered++;
      },
    });
    await pool.init();
    expect(launcher.launched.length).toBe(1);

    // Crash → relaunch fails → set empties → self-heal begins (failing). Wait
    // for the degraded alarm so we heal only after the set genuinely died.
    launcher.launched[0]!.__crash();
    await waitFor(() =>
      events.some((e) => e.event === "browser-pool.set-empty-degraded"),
    );

    // Heal → self-heal revives the set and fires recovery (recovered=1).
    launcher.setFailAfter(undefined);
    await waitFor(() => recovered >= 1, 5_000);
    expect(recovered).toBe(1);

    // Now crash the revived survivor. Its relaunch succeeds (kernel healthy), so
    // this is just a normal crash recycle — verify the pool stays alive and a
    // fresh acquire works (the re-empty path, even when briefly empty, never
    // wedges into a terminal dead state).
    const liveBefore = launcher.launched.filter((b) => b.isConnected());
    liveBefore[liveBefore.length - 1]!.__crash();
    const ctx = await pool.acquire(undefined, 3_000);
    expect(ctx).toBeDefined();
    expect(pool.stats().inUse).toBe(1);

    await pool.release(ctx);
    await pool.shutdown();
  });

  // FIX #1 — shutdown() during an active self-heal must (a) leave ZERO live
  // browsers and (b) return PROMPTLY (not stall up to selfHealIntervalMs). The
  // unfixed shutdown awaited a ONE-TIME snapshot of inFlightRecycles, so a
  // self-heal iteration registered AFTER the snapshot could launch a chromium
  // after shutdown returned (process leak); and the self-heal delay was not
  // abortable, so shutdown stalled. RED pre-fix; GREEN post-fix.
  it("FIX#1: shutdown during an active self-heal leaves zero live browsers and returns promptly", async () => {
    // Self-heal keeps failing (kernel stays exhausted) so the loop is actively
    // looping when we shut down. A LARGE selfHealIntervalMs would stall the
    // unfixed shutdown; the abortable delay must cut it short.
    const launcher = makeFakeLauncher({ failAfterCall: 1 });
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 2,
      launchBrowser: launcher.launchBrowser,
      launchStaggerMs: 0,
      relaunchMaxRetries: 0,
      relaunchBackoffMs: 0,
      selfHealIntervalMs: 10_000, // large: an un-abortable delay would stall
    });
    await pool.init();

    // Crash → relaunch fails → set empties → self-heal loop is now actively
    // looping (and parked on the 10s interval delay).
    launcher.launched[0]!.__crash();
    await waitFor(() => pool.stats().inUse === 0);
    await drainMicrotasks();

    const launchedBeforeShutdown = launcher.launched.length;

    // Shutdown must return promptly despite the 10s self-heal interval.
    const t0 = Date.now();
    await pool.shutdown();
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(2_000);

    // Give any leaked self-heal iteration a chance to launch a chromium AFTER
    // shutdown — there must be none.
    launcher.setFailAfter(undefined); // would let a leaked iteration succeed
    await new Promise((r) => setTimeout(r, 50));
    expect(launcher.launched.length).toBe(launchedBeforeShutdown);

    // Zero live browsers remain.
    const live = launcher.launched.filter((b) => b.isConnected());
    expect(live.length).toBe(0);
  });

  // FIX #8 — context-close failures across the orphan/release/error paths must
  // be routed through closeContext (logged at warn), not swallowed by a bare
  // `.catch(() => {})`. RED pre-fix (no warn emitted on a failing context
  // close); GREEN post-fix (browser-pool.context-close-failed warn logged).
  it("FIX#8: a failing context close on the orphan path is logged at warn (not swallowed)", async () => {
    // Drive the orphan path: an open whose entry is recycled mid-await closes
    // the orphan context. Make that context's close() throw and assert it logs.
    const ctxs: Array<{ close(): Promise<void>; __closeThrows: boolean }> = [];
    let connected = true;
    let recycledOnce = false;
    const handlers: Array<() => void> = [];
    let pendingOpen: (() => void) | undefined;
    const browser = {
      isConnected: () => connected,
      on: (_e: string, h: () => void) => handlers.push(h),
      close: async () => {
        connected = false;
      },
      newContext: async () => {
        // Park the FIRST open so we can recycle mid-await; later opens resolve.
        if (!recycledOnce) {
          await new Promise<void>((resolve) => (pendingOpen = resolve));
        }
        const c = {
          __closeThrows: true,
          close: async () => {
            if (c.__closeThrows) throw new Error("ctx close boom");
          },
        };
        ctxs.push(c);
        return c as unknown as BrowserContext;
      },
    } as unknown as Browser;
    const { logger, events } = makeLeveledLogger();
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 2,
      recycleAfter: 1000,
      logger,
      launchBrowser: async () => browser,
      launchStaggerMs: 0,
    });
    await pool.init();

    // Start an open (parks). Then trigger a hygiene-independent recycle by
    // crashing: connected flips false so the orphan guard fires when the parked
    // open settles.
    const p = pool.acquire(undefined, 1_000).catch(() => undefined);
    await drainMicrotasks();
    expect(pendingOpen).toBeDefined();

    // Recycle the entry out from under the in-flight open: flip connected false
    // so the orphan guard's `!browserBefore.isConnected()` branch fires, then
    // release the parked open. Its close() throws → must be logged.
    connected = false;
    recycledOnce = true;
    pendingOpen!();
    await p;
    await drainMicrotasks();

    expect(
      events.some(
        (e) =>
          e.level === "warn" && e.event === "browser-pool.context-close-failed",
      ),
    ).toBe(true);

    await pool.shutdown();
  });

  // FIX #10 (rewrite of MATRIX(c)) — genuinely exercise the recyclePending
  // CARRY-FORWARD: a boundary-crossing release with a queued waiter DEFERS the
  // hygiene recycle (sets recyclePending), the waiter is served onto the SAME
  // entry, and a later genuinely-idle release fires the recycle. This goes RED
  // if `recyclePending` is removed because the deferring release serves the
  // waiter (entry non-idle → shouldRecycle false at the deferring release), and
  // the recycle would otherwise be lost. (Verified RED-on-removal during
  // development by forcing recyclePending to a no-op.)
  it("FIX#10/MATRIX(c'): recyclePending carries a deferred hygiene recycle forward and fires it at the next idle release", async () => {
    const { launchBrowser, launched } = makeFakeLauncher();
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 1, // cap=1 → a second acquire always pends a waiter
      recycleAfter: 1, // eligible after the first served context
      launchBrowser,
      launchStaggerMs: 0,
    });
    await pool.init();
    expect(launched.length).toBe(1);

    // c0 live, served0=1 (>= recycleAfter). Cap (1) is now full.
    const c0 = await pool.acquire();
    expect(pool.stats().inUse).toBe(1);

    // Queue a waiter w (cap full → pends).
    let w: BrowserContext | undefined;
    const wp = pool.acquire().then((c) => (w = c));
    await drainMicrotasks();
    expect(w).toBeUndefined();

    // Release c0: served0(1) >= recycleAfter(1) AND the entry is idle at the
    // synchronous capture (inUse just decremented to 0) → shouldRecycle TRUE.
    // BUT a waiter is queued (hadWaiter) → the recycle is DEFERRED via
    // recyclePending and the waiter is served onto the SAME (un-recycled)
    // browser instead of tearing it out from under the just-served waiter.
    await pool.release(c0);
    await wp;
    expect(w).toBeDefined();
    // No recycle fired at the deferring release (served onto same browser).
    expect(pool.stats().totalRecycles).toBe(0);
    expect(launched.length).toBe(1);
    expect(launched[0]!.__contexts.map((x) => x.__id)).toContain(ctxId(w!));

    // Release the served waiter with NO waiter queued → entry genuinely idle and
    // recyclePending set → the carried-forward recycle fires SOLELY because the
    // intent was preserved across the deferring release.
    await pool.release(w!);
    await waitFor(() => launched.length === 2);
    expect(pool.stats().totalRecycles).toBe(1);
    expect(launched.length).toBe(2);

    await pool.shutdown();
  });

  // FIX #12 — serveNextWaiter's transient re-drive must be BOUNDED. The round-3
  // FIX#7-mirror re-queued the waiter (unshift) + scheduleServeNextWaiter() on a
  // transient newContext() throw against a still-connected browser, with NO
  // ceiling. A persistently-transient newContext() on a connected browser thus
  // hot-loops (schedule → serve → throw → unshift → schedule) through microtasks,
  // starving the event loop until the waiter's acquire timeout fires. The fix
  // mirrors acquire()'s "retry ONCE then enqueue" semantics: self-reschedule at
  // most MAX_TRANSIENT_SERVE_RETRIES times, then leave the waiter enqueued for a
  // future release/recovery event. RED pre-fix (unbounded newContext calls);
  // GREEN post-fix (bounded serve attempts; waiter awaits a future event).
  it("FIX#12: serveNextWaiter does NOT busy-loop on a persistently-transient connected browser", async () => {
    const { launchBrowser, launched } = makeFakeLauncher();
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 2, // room for a sibling to stay live during the serve
      recycleAfter: 1000, // hygiene out of the picture; this is the FIX#7 path
      launchBrowser,
      launchStaggerMs: 0,
    });
    await pool.init();

    // Fill the cap with two contexts (both open cleanly).
    const c1 = await pool.acquire();
    const c2 = await pool.acquire();
    expect(pool.stats().inUse).toBe(2);
    expect(launched.length).toBe(1);

    // Enqueue a waiter (generous timeout) — it pends past the full cap.
    let waiterCtx: BrowserContext | undefined;
    const waiterP = pool.acquire(undefined, 5_000).then((c) => (waiterCtx = c));
    await drainMicrotasks();

    // Arm the browser to throw transiently FOREVER while staying connected, then
    // release c2 → serveNextWaiter picks the waiter and calls newContext, which
    // throws transiently on the still-connected browser every time.
    launched[0]!.__armTransientThrow(Infinity);
    const callsBeforeServe = launched[0]!.__newContextCalls;
    await pool.release(c2);

    // Let the (possibly recursive) re-drive run to its ceiling, plus generous
    // microtask + macrotask slack. If the re-drive were UNBOUNDED, newContext
    // would be hammered an ever-growing number of times across these turns
    // (hundreds+), starving the loop. Bounded, it makes only a small, constant
    // number of attempts and then stops.
    await drainMicrotasks(50);
    await new Promise((r) => setTimeout(r, 30));
    await drainMicrotasks(50);

    const transientServeCalls =
      launched[0]!.__newContextCalls - callsBeforeServe;

    // INVARIANT: the transient serve was attempted only a small BOUNDED number
    // of times (retry ceiling), NOT hot-looped. Pre-fix this count grows without
    // bound across the microtask turns; post-fix it is a tiny constant.
    expect(transientServeCalls).toBeLessThanOrEqual(5);

    // The waiter is NOT resolved (it is enqueued awaiting a future event), the
    // browser was NOT recycled (it stayed connected — transient), and no extra
    // chromium was launched.
    expect(waiterCtx).toBeUndefined();
    expect(pool.stats().totalRecycles).toBe(0);
    expect(launched.length).toBe(1);
    expect(launched[0]!.isConnected()).toBe(true);

    // Disarm the transient throws → a subsequent release re-drives the queue and
    // the waiter is served on the SAME live browser (event-driven, not hot-loop).
    launched[0]!.__armTransientThrow(0);
    await pool.release(c1);
    const served = await waiterP;
    expect(served).toBeDefined();
    expect(launched.length).toBe(1);
    expect(pool.stats().totalRecycles).toBe(0);

    await pool.release(served);
    await pool.shutdown();
  });

  // ===========================================================================
  // FIX#13 — close-during-launch teardown race (the staging outage).
  //
  // A browser that is mid-`launch()` (the launch promise has not yet resolved,
  // so it is NOT yet in `this.browsers` and has NOT yet had a disconnect handler
  // attached) can be closed by a concurrent teardown path BEFORE the launch
  // resolves. In production this manifested as the self-heal loop's
  // `chromium.launch()` itself rejecting with
  //   `browserType.launch: Target page, context or browser has been closed`
  // (SIGTRAP — the browser was killed mid-startup). 336 such
  // `self-heal-launch-failed` events in 4 min wedged the pool: every relaunch
  // hit the same race, so the set never refilled.
  //
  // RED (pre-fix): `shutdown()` flips `isShutdown` and immediately closes every
  // browser in `this.browsers`, but it has NO knowledge of a launch that is
  // IN FLIGHT (created but not yet pushed). When the in-flight launch finally
  // settles the pool either (a) hands the fresh browser out / leaves it leaked,
  // or — modeled here — (b) the launch itself rejects because the browser was
  // closed underneath it. The fix registers a "launching" marker BEFORE the
  // await so shutdown awaits it instead of closing the browser mid-startup, and
  // the launching path re-checks `isShutdown` AFTER the await to close cleanly
  // ONLY then.
  // GREEN: no `Target page, context or browser has been closed` rejection
  // surfaces; the in-flight launch is either cleanly registered or cleanly
  // closed exactly once after it settles.
  // ===========================================================================
  it("FIX#13: shutdown during an in-flight init launch waits for + cleanly closes the launching browser (no leak)", async () => {
    // The init() fill loop launches the fixed set one browser at a time. A
    // launch that is IN FLIGHT (the launch promise has not resolved) has its
    // FakeBrowser created but is NOT yet in `this.browsers` and has NO disconnect
    // handler. A concurrent shutdown() has no marker for this in-flight launch:
    //   - shutdown's `inFlightRecycles` drain does NOT track init,
    //   - shutdown closes only the browsers already in `this.browsers`.
    // So pre-fix, shutdown returns while init's launch is still in flight; when
    // the launch finally resolves it pushes a live browser that NOTHING ever
    // closes — a permanently leaked chromium process (the steady-state form of
    // the staging wedge: launches that escape teardown accounting).
    //
    // Drive it: browsers:2 so init does call 1 (resolves) then call 2 (PARKS).
    const launcher = makeFakeLauncher({
      parkLaunchForCalls: [2],
    });
    const { launchBrowser, launched } = launcher;
    const pool = new BrowserPool({
      browsers: 2,
      maxContexts: 4,
      launchBrowser,
      launchStaggerMs: 0,
    });

    const rejections: string[] = [];
    const onRej = (e: unknown): void => {
      rejections.push(e instanceof Error ? e.message : String(e));
    };
    process.on("unhandledRejection", onRej);

    // Kick init() but do NOT await — its second launch (call 2) parks in flight.
    const initP = pool.init();
    await waitFor(() => launcher.__parkedLaunches > 0);
    expect(launched.length).toBe(2);

    // Concurrent teardown WHILE init's 2nd launch is in flight.
    const shutdownP = pool.shutdown();
    await drainMicrotasks();

    // Release the parked launch so init can finish.
    launcher.__releaseParkedLaunches();
    await Promise.allSettled([initP, shutdownP]);
    await drainMicrotasks(20);
    await new Promise((r) => setTimeout(r, 20));
    process.off("unhandledRejection", onRej);

    // INVARIANT 1: no close-during-launch rejection escaped.
    expect(
      rejections.some((m) => m.includes("Target page, context or browser")),
    ).toBe(false);
    // INVARIANT 2: BOTH launched browsers were closed on shutdown — the
    // in-flight one (launched[1]) is NOT leaked. Pre-fix shutdown returns before
    // launched[1] registers, so it is never closed (__closeCount === 0).
    expect(launched[0]!.__closeCount).toBeGreaterThanOrEqual(1);
    expect(launched[1]!.__closeCount).toBeGreaterThanOrEqual(1);
  });

  // ── SHUTDOWN-RACE REGRESSIONS (pre-existing; surfaced by #5221's CR) ───────
  // Two latent races distinct from #5221's close-during-launch fix:
  //   (1) a serveNextWaiter()/openContextOn() that already shifted a waiter +
  //       reserved BEFORE shutdown can settle its newContext() AFTER shutdown's
  //       close-pass → the freshly-opened context lands in contextToBrowser /
  //       liveContexts and is never closed (leaked context on a torn-down pool).
  //   (2) the acquire() transient-retry → concurrent-recycle → orphan-guard
  //       straddle must keep the reservation accounting balanced (no overshoot).

  // Internal-state probe for the maps the public stats() surface does not
  // expose: contextToBrowser size + total liveContexts across entries. Used to
  // assert no context survives the shutdown close-pass.
  const internals = (
    pool: BrowserPool,
  ): {
    contextToBrowser: Map<unknown, unknown>;
    liveContextCount: number;
    browsers: Array<{ liveContexts: Set<unknown> }>;
    waiters: unknown[];
  } =>
    pool as unknown as {
      contextToBrowser: Map<unknown, unknown>;
      liveContextCount: number;
      browsers: Array<{ liveContexts: Set<unknown> }>;
      waiters: unknown[];
    };

  // RACE 1 (post-shutdown context leak) — a serveNextWaiter() that shifted a
  // waiter + reserved a slot BEFORE shutdown parks in openContextOn()'s
  // newContext(). shutdown() flips isShutdown, drains inFlightRecycles +
  // pendingLaunches (neither tracks the fire-and-forget serve), then runs its
  // close-pass over contextToBrowser. AFTER that close-pass the parked
  // newContext() resolves: pre-fix, openContextOn()'s orphan guard does NOT
  // check isShutdown, so the just-opened context is added to liveContexts /
  // contextToBrowser on a torn-down pool — a leaked context that is never
  // closed. The fix treats shutdown like a recycle in the orphan guard (close
  // the orphan, roll back the reservation, throw) AND bails serveNextWaiter
  // before openContextOn when isShutdown.
  it("RACE1: does NOT leak a context when a serve's open settles AFTER shutdown's close-pass", async () => {
    // TWO browsers so we can hold shutdown()'s drain loop OPEN (a parked relaunch
    // sits in inFlightRecycles + pendingLaunches) WHILE the serve's open on the
    // OTHER, still-connected browser settles. That is the exact window the bug
    // lives in: isShutdown is already true, but the serving browser has NOT been
    // closed yet (shutdown's close-pass runs only AFTER the drain), so the
    // pre-existing orphan guard's `!isConnected()` / recycle checks all pass and
    // (pre-fix) the freshly-opened context is added to contextToBrowser/
    // liveContexts on a tearing-down pool — a leak shutdown will never close.
    //
    //   call 1 → browser0 (serves the waiter; defers its newContext)
    //   call 2 → browser1 (crashed below to trigger a recycle)
    //   call 3 → browser1's relaunch, PARKED in flight → holds shutdown's drain
    const launcher = makeFakeLauncher({
      deferNewContextForCalls: [1], // browser0 defers every newContext
      parkLaunchForCalls: [3], // browser1's relaunch parks → drain stays open
    });
    const { launchBrowser, launched } = launcher;
    const { logger } = makeLeveledLogger();
    const pool = new BrowserPool({
      browsers: 2,
      maxContexts: 1, // cap=1 so a single waiter queues behind c1
      recycleAfter: 1000,
      relaunchBackoffMs: 0,
      logger,
      launchBrowser,
      launchStaggerMs: 0,
    });
    await pool.init();
    expect(launched.length).toBe(2);

    // Fill the single cap slot with one context on browser0 (parked open →
    // release the park). pickLeastLoaded picks browser0 (index 0, equal load).
    const c1p = pool.acquire();
    await drainMicrotasks();
    await waitFor(() => launched[0]!.__pendingNewContexts > 0);
    launched[0]!.__releaseNewContexts();
    const c1 = await c1p;
    expect(pool.stats().inUse).toBe(1);

    // Enqueue a waiter past the cap. Bounded timeout so the test never hangs on
    // the waiter's fate — the leak we assert is in the pool's internal maps.
    let waiterSettled = false;
    const waiterP = pool
      .acquire(undefined, 5_000)
      .then(() => (waiterSettled = true))
      .catch(() => (waiterSettled = true));
    await drainMicrotasks();

    // CRASH browser1 → its recycle relaunch (call 3) PARKS in flight, keeping
    // shutdown's drain loop (inFlightRecycles + pendingLaunches) open.
    launched[1]!.__crash();
    await waitFor(() => launcher.__parkedLaunches > 0);
    expect(launched.length).toBe(3); // browser1's relaunch object exists, parked

    // Release c1 → serveNextWaiter() shifts the waiter, RESERVES the freed slot,
    // and parks its open in browser0's deferred newContext(). This serve is
    // fire-and-forget — tracked by NEITHER inFlightRecycles NOR pendingLaunches.
    await pool.release(c1);
    await drainMicrotasks();
    await waitFor(() => launched[0]!.__pendingNewContexts > 0);
    expect(launched[0]!.__pendingNewContexts).toBe(1);

    // Shutdown. isShutdown flips true synchronously; the drain loop then BLOCKS
    // on the parked browser1 relaunch (call 3) — so shutdown's close-pass has
    // NOT run yet and browser0 is still connected/open.
    const shutdownP = pool.shutdown();
    await drainMicrotasks();

    // Resolve browser0's parked serve open NOW — isShutdown is true but browser0
    // is still connected and un-recycled, so ONLY an isShutdown check in the
    // orphan guard catches it. Pre-fix: the context lands in contextToBrowser/
    // liveContexts on the tearing-down pool — a leak.
    launched[0]!.__releaseNewContexts();
    await drainMicrotasks(20);

    // INVARIANT (asserted BEFORE the parked relaunch is released, so shutdown's
    // close-pass has demonstrably not run): no serve context has leaked onto the
    // tearing-down pool. Pre-fix: contextToBrowser.size === 1 / live === 1.
    expect(internals(pool).contextToBrowser.size).toBe(0);
    expect(internals(pool).liveContextCount).toBe(0);
    // The orphaned serve context on browser0 must have been CLOSED, not lingering.
    const openButNotClosed = launched[0]!.__contexts.filter(
      (c) => c.__closeCount === 0,
    );
    expect(openButNotClosed.length).toBe(0);

    // Release the parked relaunch so shutdown's drain loop completes + finishes.
    launcher.__releaseParkedLaunches();
    await shutdownP;
    await waiterP;
    expect(waiterSettled).toBe(true);
    // Post-shutdown the pool is fully clean.
    expect(internals(pool).contextToBrowser.size).toBe(0);
    expect(internals(pool).liveContextCount).toBe(0);
  });

  // RACE 2 (acquire transient-retry cap-overshoot) — REGRESSION LOCK FOR A
  // PRE-EXISTING INVARIANT, NOT a shutdown-race proof. This test does NOT exercise
  // any code added by the shutdown-leak fix and passes against main UNCHANGED; it
  // is here purely to pin the generation-guarded exactly-once-rollback invariant
  // that the transient-retry / orphan-by-recycle straddle already relied on, so a
  // future edit to that interleaving regresses loudly.
  //
  // The scenario: acquire()'s transient retry path — a connected browser throws
  // transiently, acquire() re-reserves and retries openContextOn(); the retry
  // parks in newContext(); a CONCURRENT crash recycles the entry; the parked retry
  // then hits openContextOn()'s orphan-by-recycle guard. The accounting invariant
  // ("every reserveSlot matched by EXACTLY ONE trackOpenedContext OR
  // releaseReservation") must hold across that straddle: the crash teardown rolls
  // back the in-flight re-reservation against the OLD generation + bumps the
  // generation, so the late settle's own `rollbackPendingOpen` is
  // generation-guarded into a no-op — the reservation is rolled back EXACTLY ONCE
  // (no overshoot, no double-rollback). This invariant is UPHELD by the
  // pre-existing generation guard; the shutdown fix neither created nor altered it.
  it("RACE2 (pre-existing-invariant lock, NOT a shutdown-race proof): transient-retry orphaned by a concurrent recycle keeps accounting balanced (no overshoot)", async () => {
    // browser0 (init) defers every newContext so the transient-retry's open can
    // be parked across a concurrent crash.
    const { launchBrowser, launched } = makeFakeLauncher({
      deferNewContextForCalls: [1],
    });
    const { logger, events } = makeLeveledLogger();
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 2,
      recycleAfter: 1000, // hygiene out of the picture; this is the crash path
      relaunchBackoffMs: 0,
      logger,
      launchBrowser,
      launchStaggerMs: 0,
    });
    await pool.init();
    expect(launched.length).toBe(1);

    // Arm ONE transient newContext() throw on browser0: the FIRST open in this
    // acquire throws transiently (browser stays connected), driving acquire into
    // its transient-retry branch (re-reserve + retry openContextOn).
    launched[0]!.__armTransientThrow(1);

    // Start an acquire. attempt 1 throws transiently → acquire re-reserves and
    // retries; the retry parks in the deferred newContext() (pendingOpens=1, the
    // re-reservation is held). Bounded timeout so the caller settles
    // deterministically even though it ends up orphaned + re-enqueued.
    let acquireSettled = false;
    const acquireP = pool
      .acquire(undefined, 200)
      .then(() => (acquireSettled = true))
      .catch(() => (acquireSettled = true));
    await drainMicrotasks();
    await waitFor(() => launched[0]!.__pendingNewContexts > 0);
    // The transient retry's open is parked, holding exactly one reservation.
    expect(pool.stats().inUse).toBe(1);
    expect(entry0(pool).pendingOpens).toBe(1);

    // CRASH browser0 WHILE the transient retry's open is in flight → recovery
    // recycle rolls back the in-flight reservation against the OLD generation,
    // bumps the generation, and reassigns entry.browser to a fresh process.
    launched[0]!.__crash();
    await waitFor(() => launched.length === 2);

    // Resolve the parked retry's open on the ORIGINAL (now-replaced) browser →
    // openContextOn's orphan-by-recycle guard closes it. Its own
    // rollbackPendingOpen is generation-guarded → a NO-OP (the teardown already
    // owned the rollback), so the reservation is rolled back EXACTLY ONCE.
    launched[0]!.__releaseNewContexts();
    await drainMicrotasks(30);

    // The orphan guard fired (proves we hit the recycle-straddle path).
    expect(
      events.some((e) => e.event === "browser-pool.open-orphaned-by-recycle"),
    ).toBe(true);

    // ACCOUNTING INVARIANT (the load-bearing assertion): the straddle left the
    // accounting BALANCED — no leaked reservation (would read inUse >= 1 with no
    // live context) and no double-rollback (would drive the count negative,
    // clamped to 0 but desyncing). liveContextCount + contextToBrowser are both
    // back to ZERO, and pendingOpens on the fresh entry is clean.
    expect(internals(pool).liveContextCount).toBe(0);
    expect(internals(pool).contextToBrowser.size).toBe(0);
    expect(pool.stats().inUse).toBe(0);
    expect(pool.stats().available).toBe(2); // full cap reclaimed
    expect(entry0(pool).pendingOpens).toBe(0);

    // The orphan on the original (dead) browser was closed, never handed out.
    const origOrphans = launched[0]!.__contexts.filter(
      (c) => c.__closeCount === 0,
    );
    expect(origOrphans.length).toBe(0);

    await acquireP;
    expect(acquireSettled).toBe(true);
    await pool.shutdown();
  });

  // RACE 3 (shutdown-straddle caller settlement) — covers the two REACHABLE
  // shutdown branches RACE1 does NOT: (3a) serveNextWaiter()'s post-open
  // `if (this.isShutdown) waiter.reject(...)` leg, and (3b) acquire()'s OUTER-catch
  // `if (this.isShutdown) throw` leg. In both, an open is in flight when
  // shutdown() flips isShutdown and clears `this.waiters`; when the open then
  // settles, openContextOn's orphan guard closes+rolls-back+throws, and the
  // straddle branch must settle the CALLER with the shutdown sentinel — NOT
  // re-enqueue onto the cleared `waiters` (where it would hang until its acquire
  // timeout). Reverting either source guard makes the corresponding caller hang
  // (RED); with the guard present the caller rejects promptly (GREEN).
  it("RACE3a: a shifted waiter whose serve open straddles shutdown REJECTS (not enqueued, not hung)", async () => {
    // Same two-browser drain-held setup as RACE1, but here we assert the WAITER's
    // fate: it must reject with the shutdown sentinel, settled WELL BEFORE its
    // (long) acquire timeout — proving serveNextWaiter's straddle reject ran and
    // it was not stranded on the cleared queue.
    const launcher = makeFakeLauncher({
      deferNewContextForCalls: [1], // browser0 defers every newContext
      parkLaunchForCalls: [3], // browser1's relaunch parks → drain stays open
    });
    const { launchBrowser, launched } = launcher;
    const { logger } = makeLeveledLogger();
    const pool = new BrowserPool({
      browsers: 2,
      maxContexts: 1, // cap=1 so a single waiter queues behind c1
      recycleAfter: 1000,
      relaunchBackoffMs: 0,
      logger,
      launchBrowser,
      launchStaggerMs: 0,
    });
    await pool.init();

    // Fill the single cap slot on browser0.
    const c1p = pool.acquire();
    await drainMicrotasks();
    await waitFor(() => launched[0]!.__pendingNewContexts > 0);
    launched[0]!.__releaseNewContexts();
    const c1 = await c1p;
    expect(pool.stats().inUse).toBe(1);

    // Enqueue a waiter past the cap with a LONG timeout — if the straddle reject
    // does NOT fire, the only way this settles is the timeout, so a prompt
    // rejection proves the reject branch ran.
    let waiterErr: Error | undefined;
    const waiterP = pool.acquire(undefined, 30_000).catch((e: Error) => {
      waiterErr = e;
    });
    await drainMicrotasks();

    // CRASH browser1 → its recycle relaunch (call 3) PARKS, holding shutdown's
    // drain loop open.
    launched[1]!.__crash();
    await waitFor(() => launcher.__parkedLaunches > 0);

    // Release c1 → serveNextWaiter() shifts the waiter, reserves, parks its open
    // in browser0's deferred newContext(). The waiter is now OFF this.waiters.
    await pool.release(c1);
    await drainMicrotasks();
    await waitFor(() => launched[0]!.__pendingNewContexts > 0);

    // Shutdown — isShutdown flips synchronously, this.waiters (now empty, the
    // waiter was shifted) is cleared; drain loop blocks on the parked relaunch.
    const shutdownP = pool.shutdown();
    await drainMicrotasks();

    // Settle the parked serve open: openContextOn's orphan guard fires (isShutdown
    // term), throws; serveNextWaiter's straddle branch must REJECT the shifted
    // waiter.
    launched[0]!.__releaseNewContexts();
    await drainMicrotasks(20);

    // The waiter settled by REJECTION (not hung, not enqueued).
    expect(waiterErr).toBeDefined();
    expect(waiterErr!.message).toBe("BrowserPool is shut down");
    // It must NOT be sitting on the (cleared) waiters queue.
    expect(internals(pool).waiters.length).toBe(0);

    // Release the parked relaunch so shutdown completes.
    launcher.__releaseParkedLaunches();
    await shutdownP;
    await waiterP;
    // The straddled orphan context was closed by the orphan guard's
    // fire-and-forget close, and never landed in contextToBrowser.
    const openButNotClosed = launched[0]!.__contexts.filter(
      (c) => c.__closeCount === 0,
    );
    expect(openButNotClosed.length).toBe(0);
    expect(internals(pool).contextToBrowser.size).toBe(0);
  });

  it("RACE3b: an acquire whose open straddles shutdown REJECTS via the outer catch (not enqueued, not hung)", async () => {
    // Single browser, cap large enough that the acquire opens directly (no waiter
    // path). browser0 defers its newContext so we can park the acquire's open in
    // flight, flip shutdown, then settle the open into the orphan guard. acquire()
    // takes the OUTER catch's `if (this.isShutdown) throw` leg.
    const { launchBrowser, launched } = makeFakeLauncher({
      deferNewContextForCalls: [1],
    });
    const { logger } = makeLeveledLogger();
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 4,
      recycleAfter: 1000,
      relaunchBackoffMs: 0,
      logger,
      launchBrowser,
      launchStaggerMs: 0,
    });
    await pool.init();

    // Start an acquire whose open parks in the deferred newContext().
    let acquireErr: Error | undefined;
    const acquireP = pool.acquire(undefined, 30_000).catch((e: Error) => {
      acquireErr = e;
    });
    await drainMicrotasks();
    await waitFor(() => launched[0]!.__pendingNewContexts > 0);
    expect(pool.stats().inUse).toBe(1); // reservation held by the parked open

    // Flip shutdown WHILE the open is parked. No parked relaunch here, so the
    // drain loop is empty and shutdown proceeds to its close-pass; the orphan
    // opened-then-straddled here is closed by openContextOn's fire-and-forget
    // orphan guard, not awaited by shutdown. Kick shutdown without awaiting so
    // the straddled open settles into the guard first.
    const shutdownP = pool.shutdown();
    await drainMicrotasks();

    // Settle the parked open: orphan guard (isShutdown term) closes+rolls-back+
    // throws; acquire()'s outer catch `if (this.isShutdown) throw` must reject.
    launched[0]!.__releaseNewContexts();

    await acquireP;
    expect(acquireErr).toBeDefined();
    expect(acquireErr!.message).toBe("BrowserPool is shut down");
    // No waiter was created (the acquire rejected, did not enqueue).
    expect(internals(pool).waiters.length).toBe(0);

    await shutdownP;
    // The straddled orphan context was closed by the orphan guard's
    // fire-and-forget close, and never landed in contextToBrowser.
    const openButNotClosed = launched[0]!.__contexts.filter(
      (c) => c.__closeCount === 0,
    );
    expect(openButNotClosed.length).toBe(0);
    expect(internals(pool).contextToBrowser.size).toBe(0);
  });
});

// ── RESOURCE-GAUGE INSTRUMENTATION (early-warning logging) ───────────────────
//
// The PROVEN browser-pool wedge is cgroup PID/thread-ceiling exhaustion: a d6
// launch burst drives `pids.current` toward the platform-fixed `pids.max=1000`,
// every `chromium.launch()` then throws pthread EAGAIN → "...has been closed" →
// crash-loop. To make a burst approaching the ceiling OBSERVABLE — and let an
// EAGAIN be correlated to a measured `pids.current` — the pool samples + logs
// the OS resource gauges (`browser-pool.resource-gauges`, headline
// pids.current/pids.max + thread count) on EVERY launch and on the
// `self-heal-launch-failed` path. These tests pin that the gauge is sampled +
// logged on those events (they FAIL before the gauge is wired). Off-Linux the
// gauge fields degrade to -1; the test asserts the EVENT + label, not the
// (host-specific) numeric values.
describe("BrowserPool — resource-gauge instrumentation (PID-ceiling early warning)", () => {
  it("RED→GREEN: logs the resource gauges on every launchBrowser() (label=launch)", async () => {
    const launcher = makeFakeLauncher({});
    const { logger, events } = makeLeveledLogger();
    const pool = new BrowserPool({
      browsers: 3,
      maxContexts: 6,
      logger,
      launchBrowser: launcher.launchBrowser,
      launchStaggerMs: 0,
    });
    await pool.init();

    // init fills the fixed set with `browsers` launches — each must have logged a
    // gauge sample labeled `launch` BEFORE forking the chromium process.
    const launchGauges = events.filter(
      (e) =>
        e.event === "browser-pool.resource-gauges" &&
        e.meta?.label === "launch",
    );
    expect(launchGauges.length).toBe(3);
    // The headline cgroup PID fields are present in the structured payload (the
    // signal the alert names); off-Linux they are -1, which is still a number.
    const meta = launchGauges[0]!.meta!;
    expect("cgroupPidsCurrent" in meta).toBe(true);
    expect("cgroupPidsMax" in meta).toBe(true);
    expect("treeThreadCount" in meta).toBe(true);

    await pool.shutdown();
  });

  it("RED→GREEN: logs the resource gauges on the self-heal-launch-failed path", async () => {
    // init launches 1; everything after fails (persistent EAGAIN-style wedge).
    const launcher = makeFakeLauncher({ failAfterCall: 1 });
    const { logger, events } = makeLeveledLogger();
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 2,
      logger,
      launchBrowser: launcher.launchBrowser,
      launchStaggerMs: 0,
      relaunchMaxRetries: 0,
      relaunchBackoffMs: 0,
      selfHealIntervalMs: 1,
      // Give up after a couple hard recoveries so the loop terminates the test.
      selfHealHardRecoveryThreshold: 2,
      selfHealMaxHardRecoveries: 2,
    });
    await pool.init();
    // Crash the only browser → set empties → self-heal loop relaunches, every
    // attempt fails → each failure logs a gauge sample labeled accordingly.
    launcher.launched[0]!.__crash();

    await waitFor(
      () =>
        events.some(
          (e) =>
            e.event === "browser-pool.resource-gauges" &&
            e.meta?.label === "self-heal-launch-failed",
        ),
      5_000,
    );
    const healFailGauges = events.filter(
      (e) =>
        e.event === "browser-pool.resource-gauges" &&
        e.meta?.label === "self-heal-launch-failed",
    );
    expect(healFailGauges.length).toBeGreaterThanOrEqual(1);

    await pool.shutdown();
  });

  it("the pool-unrecoverable alarm payload carries the cgroup PID gauges (names the real signal)", async () => {
    const launcher = makeFakeLauncher({ failAfterCall: 1 });
    const { logger } = makeLeveledLogger();
    let captured:
      | {
          cgroupPidsCurrent: number;
          cgroupPidsMax: number;
          treeThreadCount: number;
        }
      | undefined;
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 2,
      logger,
      launchBrowser: launcher.launchBrowser,
      launchStaggerMs: 0,
      relaunchMaxRetries: 0,
      relaunchBackoffMs: 0,
      selfHealIntervalMs: 1,
      selfHealHardRecoveryThreshold: 2,
      selfHealMaxHardRecoveries: 2,
      onUnrecoverable: (info) => {
        captured = {
          cgroupPidsCurrent: info.cgroupPidsCurrent,
          cgroupPidsMax: info.cgroupPidsMax,
          treeThreadCount: info.treeThreadCount,
        };
      },
    });
    await pool.init();
    launcher.launched[0]!.__crash();

    await waitFor(() => captured !== undefined, 5_000);
    // The give-up alarm names the PROVEN wedge signal (the measured PID counts +
    // thread demand), not just the abstract breaker counters. Off-Linux these
    // degrade to -1 — still a number, still present in the payload.
    expect(typeof captured!.cgroupPidsCurrent).toBe("number");
    expect(typeof captured!.cgroupPidsMax).toBe("number");
    expect(typeof captured!.treeThreadCount).toBe("number");

    await pool.shutdown();
  });

  // ── DURABLE FORENSIC SNAPSHOTS: onSnapshot hook + heartbeat ─────────────────
  //
  // The wedge ends in a container restart that clears in-memory state, and the
  // Railway stdout window rolls off — so the gauge history MUST be persisted
  // durably (PB) to survive. The pool fires `onSnapshot` (full gauge sample +
  // stats + per-browser breakdown) on every meaningful transition AND on a
  // periodic heartbeat. These tests assert: (a) a snapshot fires on the
  // degraded + unrecoverable transitions; (b) the heartbeat samples
  // periodically; (c) BEST-EFFORT — a throwing onSnapshot never breaks the pool.

  // RED (pre-wiring): no onSnapshot → no forensic capture at the degraded
  // transition. GREEN: the moment the set empties, a `degraded` snapshot fires.
  it("SNAPSHOT: fires a forensic snapshot on the degraded transition", async () => {
    const launcher = makeFakeLauncher({ failAfterCall: 2 });
    const snapshots: string[] = [];
    const pool = new BrowserPool({
      browsers: 2,
      maxContexts: 4,
      launchBrowser: launcher.launchBrowser,
      launchStaggerMs: 0,
      relaunchMaxRetries: 0,
      relaunchBackoffMs: 0,
      selfHealIntervalMs: 5,
      heartbeatMs: 0, // isolate the transition snapshot from the heartbeat
      onSnapshot: (s) => {
        snapshots.push(s.event);
      },
    });
    await pool.init();
    launcher.launched[0]!.__crash();
    launcher.launched[1]!.__crash();

    await waitFor(() => snapshots.includes("degraded"), 5_000);
    expect(snapshots).toContain("degraded");
    // The init snapshot also fired (baseline at boot).
    expect(snapshots).toContain("init");

    await pool.shutdown();
  });

  // GREEN: the TERMINAL give-up fires an `unrecoverable` snapshot — the single
  // most important forensic row (pool dead, redeploy required).
  it("SNAPSHOT: fires a forensic snapshot on the unrecoverable give-up", async () => {
    const launcher = makeFakeLauncher({ failAfterCall: 1 });
    const snapshots: Array<{ event: string; pidsMax: number }> = [];
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 2,
      launchBrowser: launcher.launchBrowser,
      launchStaggerMs: 0,
      relaunchMaxRetries: 0,
      relaunchBackoffMs: 0,
      selfHealIntervalMs: 1,
      selfHealHardRecoveryThreshold: 2,
      selfHealMaxHardRecoveries: 2,
      heartbeatMs: 0,
      onSnapshot: (s) => {
        snapshots.push({ event: s.event, pidsMax: s.gauges.cgroupPidsMax });
      },
    });
    await pool.init();
    launcher.launched[0]!.__crash();

    await waitFor(
      () => snapshots.some((s) => s.event === "unrecoverable"),
      5_000,
    );
    expect(snapshots.some((s) => s.event === "unrecoverable")).toBe(true);
    // The snapshot carried a real gauge sample (pidsMax is a number, -1 off-Linux).
    const unrec = snapshots.find((s) => s.event === "unrecoverable")!;
    expect(typeof unrec.pidsMax).toBe("number");

    await pool.shutdown();
  });

  // GREEN: the periodic heartbeat fires baseline snapshots between events so a
  // slow PID creep is visible even when no transition fires.
  it("SNAPSHOT: heartbeat fires periodic baseline snapshots", async () => {
    const { launchBrowser } = makeFakeLauncher();
    let heartbeats = 0;
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 2,
      launchBrowser,
      launchStaggerMs: 0,
      heartbeatMs: 10, // tiny so the test observes several beats quickly
      onSnapshot: (s) => {
        if (s.event === "heartbeat") heartbeats++;
      },
    });
    await pool.init();

    await waitFor(() => heartbeats >= 2, 5_000);
    expect(heartbeats).toBeGreaterThanOrEqual(2);

    await pool.shutdown();

    // After shutdown the heartbeat loop stops — no further beats accrue.
    const afterShutdown = heartbeats;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(heartbeats).toBe(afterShutdown);
  });

  // BEST-EFFORT: a throwing onSnapshot hook is caught + logged and NEVER breaks
  // the pool — acquire/release keep working. Mirrors the safeHook doctrine.
  it("SNAPSHOT: a throwing onSnapshot hook does NOT break the pool (best-effort)", async () => {
    const { launchBrowser } = makeFakeLauncher();
    const { logger, events } = makeLeveledLogger();
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 2,
      logger,
      launchBrowser,
      launchStaggerMs: 0,
      heartbeatMs: 0,
      onSnapshot: () => {
        throw new Error("snapshot writer exploded");
      },
    });
    // init() fires the "init" snapshot → the hook throws → must NOT reject init.
    await expect(pool.init()).resolves.toBeUndefined();
    // The throw was caught + logged, not propagated.
    expect(
      events.some(
        (e) =>
          e.event === "browser-pool.hook-failed" &&
          e.meta?.hook === "onSnapshot",
      ),
    ).toBe(true);

    // The pool is fully functional despite the throwing hook.
    const ctx = await pool.acquire(undefined, 2_000);
    expect(ctx).toBeDefined();
    await pool.release(ctx);

    await pool.shutdown();
  });
});

// budget() is the fleet WORKER's live "can I take more work?" signal for the
// pull-queue claim gate: free context budget (available > 0) AND cgroup-pids
// headroom keep each worker under its pids ceiling (the PROVEN wedge). These
// assert the in-memory counts track acquire/release and that the cheap cgroup
// pids read is folded in (injected reader, no live cgroup filesystem needed).
describe("BrowserPool — budget() worker capacity gate", () => {
  it("reflects inUse/available/max as contexts are acquired and released", async () => {
    const { launchBrowser } = makeFakeLauncher();
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 3,
      launchBrowser,
      launchStaggerMs: 0,
      // Injected cgroup reader so the pids fields are deterministic.
      cgroupPidsReader: () => ({ current: 120, max: 1000 }),
    });
    await pool.init();

    // Empty pool: full budget available, nothing in use.
    expect(pool.budget()).toEqual({
      inUse: 0,
      available: 3,
      max: 3,
      pidsCurrent: 120,
      pidsMax: 1000,
    });

    const c1 = await pool.acquire();
    expect(pool.budget()).toMatchObject({ inUse: 1, available: 2, max: 3 });

    const c2 = await pool.acquire();
    expect(pool.budget()).toMatchObject({ inUse: 2, available: 1, max: 3 });

    // At the cap: available hits 0 — the worker must NOT claim more work.
    const c3 = await pool.acquire();
    expect(pool.budget()).toMatchObject({ inUse: 3, available: 0, max: 3 });

    // Releasing frees budget back up.
    await pool.release(c2);
    expect(pool.budget()).toMatchObject({ inUse: 2, available: 1, max: 3 });

    await pool.release(c1);
    await pool.release(c3);
    expect(pool.budget()).toMatchObject({ inUse: 0, available: 3, max: 3 });

    await pool.shutdown();
  });

  it("folds the cgroup pids reading through (current/max from the reader)", async () => {
    const { launchBrowser } = makeFakeLauncher();
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 4,
      launchBrowser,
      launchStaggerMs: 0,
      cgroupPidsReader: () => ({ current: 873, max: 1000 }),
    });
    await pool.init();

    const b = pool.budget();
    expect(b.pidsCurrent).toBe(873);
    expect(b.pidsMax).toBe(1000);

    await pool.shutdown();
  });

  it("degrades pids fields to -1 when the cgroup reader throws", async () => {
    const { launchBrowser } = makeFakeLauncher();
    const pool = new BrowserPool({
      browsers: 1,
      maxContexts: 2,
      launchBrowser,
      launchStaggerMs: 0,
      cgroupPidsReader: () => {
        throw new Error("no cgroup controller");
      },
    });
    await pool.init();

    expect(pool.budget()).toEqual({
      inUse: 0,
      available: 2,
      max: 2,
      pidsCurrent: -1,
      pidsMax: -1,
    });

    await pool.shutdown();
  });
});
