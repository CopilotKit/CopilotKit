import { describe, it, expect, afterEach } from "vitest";
import type { Browser } from "playwright";
import { BrowserPool } from "./probes/helpers/browser-pool.js";
import type { LaunchBrowser } from "./probes/helpers/browser-pool.js";

/**
 * Regression for the NaN env-parsing footgun the orchestrator USED to have when
 * constructing the BrowserPool (orchestrator.ts ~L292):
 *
 *   new BrowserPool({
 *     browsers: Number(process.env.BROWSER_POOL_BROWSERS ?? ... ?? 3),
 *     maxContexts: Number(process.env.BROWSER_POOL_MAX_CONTEXTS ?? 24),
 *     logger,
 *   })
 *
 * `Number("abc")` is `NaN`. Because `NaN` is NOT nullish, the constructor's own
 * `options.browsers ?? <env/default>` keeps the NaN → `browserCount = NaN` →
 * `init()`'s `for (i=0; i < NaN; i++)` never iterates → ZERO browsers launch →
 * every `acquire()` times out with the opaque "BrowserPool acquire timeout"
 * (this exact shape took down staging).
 *
 * The fix: the orchestrator stops pre-parsing and constructs `new BrowserPool({
 * logger })`, delegating all numeric resolution to the constructor's
 * parseInt + Number.isNaN + >0 guarded env handling.
 *
 * These tests pin both halves of that contract at the BrowserPool boundary by
 * counting how many times the injected launcher fires during `init()` (which is
 * exactly `browserCount`). We do NOT touch browser-pool.test.ts (owned
 * elsewhere) — this file lives orchestrator-side.
 */

const ENV_KEYS = [
  "BROWSER_POOL_BROWSERS",
  "BROWSER_POOL_SIZE",
  "BROWSER_POOL_MAX_CONTEXTS",
] as const;

function snapshotEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) snap[k] = process.env[k];
  return snap;
}

function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const k of ENV_KEYS) {
    if (snap[k] === undefined) delete process.env[k];
    else process.env[k] = snap[k];
  }
}

/** A launcher that returns a connected no-op Browser and counts its calls. */
function makeCountingLauncher(): {
  launch: LaunchBrowser;
  count: () => number;
} {
  let calls = 0;
  const launch: LaunchBrowser = async () => {
    calls++;
    const browser = {
      isConnected: () => true,
      on: () => {},
      async close() {},
      async newContext() {
        return { async close() {} };
      },
    } as unknown as Browser;
    return browser;
  };
  return { launch, count: () => calls };
}

describe("orchestrator BrowserPool env construction (NaN footgun regression)", () => {
  const envSnap = snapshotEnv();
  afterEach(() => restoreEnv(envSnap));

  it("a non-numeric BROWSER_POOL_BROWSERS yields the default count, never zero", async () => {
    // Reproduce the staging trigger: a garbage env value.
    process.env.BROWSER_POOL_BROWSERS = "abc";
    delete process.env.BROWSER_POOL_SIZE;

    const { launch, count } = makeCountingLauncher();
    // The FIXED orchestrator construction: only `logger` (here we omit it) plus
    // the injected launcher. Crucially it does NOT pass a pre-parsed
    // `browsers: Number(...)` that would smuggle NaN past the constructor guard.
    const pool = new BrowserPool({ launchBrowser: launch, launchStaggerMs: 0 });
    await pool.init();

    // Pre-fix (orchestrator passing `browsers: NaN`) this was 0. Post-fix the
    // constructor's env path rejects the NaN and falls back to the default 3.
    expect(count()).toBe(3);
    await pool.shutdown();
  });

  it("a valid numeric BROWSER_POOL_BROWSERS env is still honored", async () => {
    process.env.BROWSER_POOL_BROWSERS = "2";
    delete process.env.BROWSER_POOL_SIZE;

    const { launch, count } = makeCountingLauncher();
    const pool = new BrowserPool({ launchBrowser: launch, launchStaggerMs: 0 });
    await pool.init();

    expect(count()).toBe(2);
    await pool.shutdown();
  });

  it("an unset env yields the default count", async () => {
    delete process.env.BROWSER_POOL_BROWSERS;
    delete process.env.BROWSER_POOL_SIZE;

    const { launch, count } = makeCountingLauncher();
    const pool = new BrowserPool({ launchBrowser: launch, launchStaggerMs: 0 });
    await pool.init();

    expect(count()).toBe(3);
    await pool.shutdown();
  });

  it("an unset BROWSER_POOL_MAX_CONTEXTS yields the default cap of 24", async () => {
    delete process.env.BROWSER_POOL_MAX_CONTEXTS;

    const { launch } = makeCountingLauncher();
    const pool = new BrowserPool({ launchBrowser: launch, launchStaggerMs: 0 });
    await pool.init();

    // `stats().size` exposes the resolved maxContexts. LOWERED from 40 to 24 to
    // cap THREAD demand under the platform-fixed cgroup pids.max=1000 ceiling
    // (the proven browser-pool wedge): fewer concurrent contexts → fewer
    // chromium renderer threads → peak pids.current stays well under the ceiling.
    expect(pool.stats().size).toBe(24);
    await pool.shutdown();
  });

  it("a valid numeric BROWSER_POOL_MAX_CONTEXTS env still wins over the default", async () => {
    process.env.BROWSER_POOL_MAX_CONTEXTS = "12";

    const { launch } = makeCountingLauncher();
    const pool = new BrowserPool({ launchBrowser: launch, launchStaggerMs: 0 });
    await pool.init();

    expect(pool.stats().size).toBe(12);
    await pool.shutdown();
  });
});
