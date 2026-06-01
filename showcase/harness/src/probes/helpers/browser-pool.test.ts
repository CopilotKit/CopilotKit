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
}

let nextBrowserId = 0;
let nextContextId = 0;

function makeFakeBrowser(opts?: { newContextThrows?: boolean }): FakeBrowser {
  const id = nextBrowserId++;
  let connected = true;
  let closeCount = 0;
  const contexts: FakeContext[] = [];
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
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
      const ctxId = nextContextId++;
      let ctxCloseCount = 0;
      const ctx: FakeContext = {
        __id: ctxId,
        __headers: ctxOpts?.extraHTTPHeaders,
        get __closeCount() {
          return ctxCloseCount;
        },
        async close() {
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
});
