import { describe, it, expect, beforeEach } from "vitest";
import {
  createE2eFullDriver,
  createPooledE2eFullLauncher,
  DEPLOY_CHURN_GRACE_MS,
  e2eFullDriver,
  FEATURE_CONCURRENCY_D6,
  Semaphore,
} from "./d6-all-pills.js";
import type {
  E2eFullAggregateSignal,
  E2eFullBrowser,
  E2eFullBrowserContext,
  E2eFullFeatureSignal,
  E2eFullPage,
} from "./d6-all-pills.js";
import {
  __clearD5RegistryForTesting,
  registerD5Script,
} from "../helpers/d5-registry.js";
import type { D5Script } from "../helpers/d5-registry.js";
import { logger } from "../../logger.js";
import type { Browser } from "playwright";
import type { BrowserPool } from "../helpers/browser-pool.js";
import type {
  ProbeContext,
  ProbeResult,
  ProbeResultWriter,
} from "../../types/index.js";

// Driver tests for the e2e-full (D6) ProbeDriver.
//
// We mock the browser, the registry (via the registerD5Script + clear
// helper), and the script loader (a no-op so the test never touches
// disk). Each test populates the registry with the script(s) it needs.

// --- Page / browser fakes -------------------------------------------------

interface PageScript {
  throwOnGoto?: Error;
  stallEvaluate?: boolean;
}

function makePage(script: PageScript = {}): E2eFullPage {
  let messageCount = 0;
  return {
    async goto() {
      if (script.throwOnGoto) throw script.throwOnGoto;
    },
    async waitForSelector() {},
    async fill() {},
    async press() {
      if (!script.stallEvaluate) {
        messageCount++;
      }
    },
    async evaluate<R>(fn: () => R): Promise<R> {
      void fn;
      return messageCount as unknown as R;
    },
    async click() {},
    async waitForFunction() {},
    async close() {},
  };
}

function makeContext(opts?: {
  pageScript?: PageScript;
}): E2eFullBrowserContext {
  return {
    newPage: async () => makePage(opts?.pageScript),
    close: async () => {},
  };
}

function makeBrowser(opts?: {
  pageScript?: PageScript;
  throwOnNewContext?: Error;
}): E2eFullBrowser {
  return {
    newContext: async () => {
      if (opts?.throwOnNewContext) throw opts.throwOnNewContext;
      return makeContext({ pageScript: opts?.pageScript });
    },
    close: async () => {},
  };
}

function makeCtx(overrides?: {
  writer?: ProbeResultWriter;
  featureTypes?: string[];
}): ProbeContext {
  return {
    now: () => new Date("2025-01-01T00:00:00Z"),
    logger,
    env: {},
    writer: overrides?.writer,
    featureTypes: overrides?.featureTypes,
  };
}

function noopScriptLoader() {
  return async () => {};
}

function makeScript(
  featureTypes: string[],
  opts?: { preNavigateRoute?: string },
): D5Script {
  return {
    featureTypes: featureTypes as D5Script["featureTypes"],
    fixtureFile: "test-fixture.json",
    buildTurns: () => [
      {
        input: "hello",
      },
    ],
    preNavigateRoute: opts?.preNavigateRoute
      ? () => opts.preNavigateRoute!
      : undefined,
  };
}

// --- Tests -----------------------------------------------------------------

describe("e2e-full driver", () => {
  beforeEach(() => {
    __clearD5RegistryForTesting();
  });

  describe("exports", () => {
    it("exports createE2eFullDriver factory", () => {
      expect(typeof createE2eFullDriver).toBe("function");
    });

    it("exports createPooledE2eFullLauncher factory", () => {
      expect(typeof createPooledE2eFullLauncher).toBe("function");
    });

    it("exports FEATURE_CONCURRENCY_D6 = 4", () => {
      expect(FEATURE_CONCURRENCY_D6).toBe(4);
    });

    it("exports e2eFullDriver default instance", () => {
      expect(e2eFullDriver).toBeDefined();
      expect(e2eFullDriver.kind).toBe("e2e_d6");
    });

    it("exports DEPLOY_CHURN_GRACE_MS", () => {
      expect(DEPLOY_CHURN_GRACE_MS).toBe(120_000);
    });

    it("exports Semaphore class", () => {
      expect(typeof Semaphore).toBe("function");
      const sem = new Semaphore(1);
      expect(sem).toBeInstanceOf(Semaphore);
    });
  });

  describe("kind", () => {
    it("driver kind is e2e_d6", () => {
      const driver = createE2eFullDriver({
        launcher: async () => makeBrowser(),
        scriptLoader: noopScriptLoader(),
      });
      expect(driver.kind).toBe("e2e_d6");
    });

    it("default instance kind is e2e_d6", () => {
      expect(e2eFullDriver.kind).toBe("e2e_d6");
    });
  });

  describe("no features declared", () => {
    it("returns green with empty features", async () => {
      const driver = createE2eFullDriver({
        launcher: async () => makeBrowser(),
        scriptLoader: noopScriptLoader(),
      });
      const result = await driver.run(makeCtx(), {
        key: "e2e_d6:showcase-test-slug",
        backendUrl: "https://test.example.com",
        features: [],
      });
      expect(result.state).toBe("green");
      expect(result.signal.note).toContain("no D5 features declared");
    });
  });

  describe("missing script handling (strict)", () => {
    it("fails with red when feature has no registered script", async () => {
      const sideEmits: ProbeResult<unknown>[] = [];
      const writer: ProbeResultWriter = {
        write: async (r) => {
          sideEmits.push(r);
        },
      };

      const driver = createE2eFullDriver({
        launcher: async () => makeBrowser(),
        scriptLoader: noopScriptLoader(),
      });
      const result = await driver.run(makeCtx({ writer }), {
        key: "e2e_d6:showcase-test-slug",
        backendUrl: "https://test.example.com",
        features: ["agentic-chat"],
      });

      expect(result.state).toBe("red");
      const signal = result.signal as E2eFullAggregateSignal;
      expect(signal.failed).toContain("agentic-chat");

      // Should have emitted a red side row for the missing script
      const sideRow = sideEmits.find(
        (r) => r.key === "d6:test-slug/agentic-chat",
      );
      expect(sideRow).toBeDefined();
      expect(sideRow!.state).toBe("red");
      const sideSignal = sideRow!.signal as E2eFullFeatureSignal;
      expect(sideSignal.errorClass).toBe("missing-script");
    });
  });

  describe("happy path", () => {
    it("runs registered features and emits aggregate green", async () => {
      registerD5Script(makeScript(["agentic-chat"]));

      const sideEmits: ProbeResult<unknown>[] = [];
      const writer: ProbeResultWriter = {
        write: async (r) => {
          sideEmits.push(r);
        },
      };

      const driver = createE2eFullDriver({
        launcher: async () => makeBrowser(),
        scriptLoader: noopScriptLoader(),
      });
      const result = await driver.run(makeCtx({ writer }), {
        key: "e2e_d6:showcase-test-slug",
        backendUrl: "https://test.example.com",
        features: ["agentic-chat"],
      });

      expect(result.state).toBe("green");
      const signal = result.signal as E2eFullAggregateSignal;
      expect(signal.passed).toBe(1);
      expect(signal.failed).toEqual([]);

      // Side row uses d6: prefix
      const sideRow = sideEmits.find(
        (r) => r.key === "d6:test-slug/agentic-chat",
      );
      expect(sideRow).toBeDefined();
      expect(sideRow!.state).toBe("green");
    });
  });

  // Regression guard: the dashboard reads the integration-scoped aggregate
  // row `d6:<slug>` (see shell-dashboard/src/lib/live-status.ts:420 and
  // shell-dashboard/src/components/depth-utils.ts:218). The cron driver
  // path (input.key = "d6-all-pills-e2e:<name>") does NOT propagate that
  // key as its primary result, so the driver must explicitly side-emit
  // a `d6:<slug>` row carrying the aggregate signal — matching the
  // CLI path's shape (cli/targets.ts:328 -> key: `d6:${slug}`).
  describe("aggregate d6:<slug> side row (dashboard read contract)", () => {
    it("emits d6:<slug> green aggregate when all features pass", async () => {
      registerD5Script(makeScript(["agentic-chat"]));

      const sideEmits: ProbeResult<unknown>[] = [];
      const writer: ProbeResultWriter = {
        write: async (r) => {
          sideEmits.push(r);
        },
      };

      const driver = createE2eFullDriver({
        launcher: async () => makeBrowser(),
        scriptLoader: noopScriptLoader(),
      });
      // Use the cron-shape key (d6-all-pills-e2e:<name>) — the bug only
      // manifests on this path because the CLI path's primary key is
      // already d6:<slug>.
      const result = await driver.run(makeCtx({ writer }), {
        key: "d6-all-pills-e2e:showcase-test-slug",
        backendUrl: "https://test.example.com",
        features: ["agentic-chat"],
      });

      expect(result.state).toBe("green");

      const aggRow = sideEmits.find((r) => r.key === "d6:test-slug");
      expect(aggRow).toBeDefined();
      expect(aggRow!.state).toBe("green");
      const aggSignal = aggRow!.signal as E2eFullAggregateSignal;
      expect(aggSignal.slug).toBe("test-slug");
      expect(aggSignal.passed).toBe(1);
      expect(aggSignal.failed).toEqual([]);
      expect(aggSignal.total).toBe(1);
    });

    it("emits d6:<slug> red aggregate when any feature fails (missing script)", async () => {
      // No script registered — agentic-chat will fail with missing-script red.
      const sideEmits: ProbeResult<unknown>[] = [];
      const writer: ProbeResultWriter = {
        write: async (r) => {
          sideEmits.push(r);
        },
      };

      const driver = createE2eFullDriver({
        launcher: async () => makeBrowser(),
        scriptLoader: noopScriptLoader(),
      });
      const result = await driver.run(makeCtx({ writer }), {
        key: "d6-all-pills-e2e:showcase-test-slug",
        backendUrl: "https://test.example.com",
        features: ["agentic-chat"],
      });

      expect(result.state).toBe("red");

      const aggRow = sideEmits.find((r) => r.key === "d6:test-slug");
      expect(aggRow).toBeDefined();
      expect(aggRow!.state).toBe("red");
      const aggSignal = aggRow!.signal as E2eFullAggregateSignal;
      expect(aggSignal.slug).toBe("test-slug");
      expect(aggSignal.failed).toContain("agentic-chat");
    });
  });

  // NSF (not_supported_features) reclassification: when an integration's
  // manifest declares a feature in `not_supported_features` (framework
  // primitive gap, not a regression), the driver must NOT count a failing
  // probe on that feature as red. Instead, the feature is partitioned
  // out before script resolution and emitted as a green side row with
  // `errorClass: "skipped-incapable"`. The aggregate carries them in
  // `skipped[]` AND an explicit `incapable[]` subset.
  describe("NSF (not_supported_features) reclassification", () => {
    it("reclassifies an NSF feature with no registered script as skipped-incapable (green), NOT red", async () => {
      // No script registered for `gen-ui-interrupt`. Pre-NSF behaviour:
      // missingScript red. Post-NSF: feature is in notSupportedFeatures
      // → emitted as green side row, included in skipped[] + incapable[],
      // never reaches the failed[] list, aggregate stays green.
      const sideEmits: ProbeResult<unknown>[] = [];
      const writer: ProbeResultWriter = {
        write: async (r) => {
          sideEmits.push(r);
        },
      };

      const driver = createE2eFullDriver({
        launcher: async () => makeBrowser(),
        scriptLoader: noopScriptLoader(),
      });
      const result = await driver.run(makeCtx({ writer }), {
        key: "d6-all-pills-e2e:showcase-test-slug",
        backendUrl: "https://test.example.com",
        features: ["gen-ui-interrupt"],
        notSupportedFeatures: ["gen-ui-interrupt"],
      });

      // Aggregate must be green — the only requested feature is NSF.
      expect(result.state).toBe("green");

      const signal = result.signal as E2eFullAggregateSignal;
      expect(signal.failed).toEqual([]);
      expect(signal.skipped).toContain("gen-ui-interrupt");
      expect(signal.incapable).toEqual(["gen-ui-interrupt"]);

      // Aggregate side row honors the same reclassification.
      const aggRow = sideEmits.find((r) => r.key === "d6:test-slug");
      expect(aggRow).toBeDefined();
      expect(aggRow!.state).toBe("green");

      // Per-feature side row is green with skipped-incapable class.
      const ftRow = sideEmits.find(
        (r) => r.key === "d6:test-slug/gen-ui-interrupt",
      );
      expect(ftRow).toBeDefined();
      expect(ftRow!.state).toBe("green");
      const ftSignal = ftRow!.signal as E2eFullFeatureSignal;
      expect(ftSignal.errorClass).toBe("skipped-incapable");
      expect(ftSignal.note).toContain("not supported");
    });

    it("keeps capable features running while NSF feature is skipped", async () => {
      // agentic-chat (capable) passes, gen-ui-interrupt (NSF) is skipped.
      // Aggregate stays green; passed=1; skipped=[gen-ui-interrupt];
      // incapable=[gen-ui-interrupt]; failed=[].
      registerD5Script(makeScript(["agentic-chat"]));

      const sideEmits: ProbeResult<unknown>[] = [];
      const writer: ProbeResultWriter = {
        write: async (r) => {
          sideEmits.push(r);
        },
      };

      const driver = createE2eFullDriver({
        launcher: async () => makeBrowser(),
        scriptLoader: noopScriptLoader(),
      });
      const result = await driver.run(makeCtx({ writer }), {
        key: "d6-all-pills-e2e:showcase-test-slug",
        backendUrl: "https://test.example.com",
        features: ["agentic-chat", "gen-ui-interrupt"],
        notSupportedFeatures: ["gen-ui-interrupt"],
      });

      expect(result.state).toBe("green");
      const signal = result.signal as E2eFullAggregateSignal;
      expect(signal.passed).toBe(1);
      expect(signal.failed).toEqual([]);
      expect(signal.skipped).toEqual(["gen-ui-interrupt"]);
      expect(signal.incapable).toEqual(["gen-ui-interrupt"]);
    });

    it("does NOT affect features outside the NSF set", async () => {
      // agentic-chat is NOT in NSF but has no script — must still go red.
      // This guards against accidentally treating NSF as a global allow.
      const sideEmits: ProbeResult<unknown>[] = [];
      const writer: ProbeResultWriter = {
        write: async (r) => {
          sideEmits.push(r);
        },
      };

      const driver = createE2eFullDriver({
        launcher: async () => makeBrowser(),
        scriptLoader: noopScriptLoader(),
      });
      const result = await driver.run(makeCtx({ writer }), {
        key: "d6-all-pills-e2e:showcase-test-slug",
        backendUrl: "https://test.example.com",
        features: ["agentic-chat"],
        notSupportedFeatures: ["gen-ui-interrupt"],
      });

      expect(result.state).toBe("red");
      const signal = result.signal as E2eFullAggregateSignal;
      expect(signal.failed).toContain("agentic-chat");
    });
  });

  describe("deploy-churn grace window", () => {
    it("skips with green when deploy is recent", async () => {
      registerD5Script(makeScript(["agentic-chat"]));

      const sideEmits: ProbeResult<unknown>[] = [];
      const writer: ProbeResultWriter = {
        write: async (r) => {
          sideEmits.push(r);
        },
      };

      const driver = createE2eFullDriver({
        launcher: async () => makeBrowser(),
        scriptLoader: noopScriptLoader(),
      });

      // Deploy 30 seconds ago (within grace window)
      const deployedAt = new Date(
        new Date("2025-01-01T00:00:00Z").getTime() - 30_000,
      ).toISOString();

      const result = await driver.run(makeCtx({ writer }), {
        key: "e2e_d6:showcase-test-slug",
        backendUrl: "https://test.example.com",
        features: ["agentic-chat"],
        deployedAt,
      });

      expect(result.state).toBe("green");
      expect(result.signal.note).toContain("deploy-churn skip");
    });
  });

  describe("launcher error", () => {
    it("returns red on launcher failure", async () => {
      registerD5Script(makeScript(["agentic-chat"]));

      const driver = createE2eFullDriver({
        launcher: async () => {
          throw new Error("chromium launch failed");
        },
        scriptLoader: noopScriptLoader(),
      });

      const result = await driver.run(makeCtx(), {
        key: "e2e_d6:showcase-test-slug",
        backendUrl: "https://test.example.com",
        features: ["agentic-chat"],
      });

      expect(result.state).toBe("red");
      expect(result.signal.errorDesc).toBe("launcher-error");
    });
  });

  describe("Semaphore", () => {
    it("rejects limit < 1", () => {
      expect(() => new Semaphore(0)).toThrow();
      expect(() => new Semaphore(-1)).toThrow();
    });

    it("allows up to limit concurrent acquires", async () => {
      const sem = new Semaphore(2);
      await sem.acquire();
      await sem.acquire();
      // Third acquire should not resolve immediately
      let acquired = false;
      const p = sem.acquire().then(() => {
        acquired = true;
      });
      // Give microtask a chance to run
      await Promise.resolve();
      expect(acquired).toBe(false);
      sem.release();
      await p;
      expect(acquired).toBe(true);
      // Clean up
      sem.release();
      sem.release();
    });

    it("throws on release without acquire", () => {
      const sem = new Semaphore(1);
      expect(() => sem.release()).toThrow();
    });
  });

  // --------------------------------------------------------------------
  // Defensive re-acquire on disconnected browser. The pool's own
  // acquire() skips zombies whose `disconnected` event has already
  // fired, but a browser can also die in the narrow window AFTER
  // acquire() returns it but BEFORE the caller hands it to
  // `browser.newContext()` — most commonly during the D6 service
  // fan-out's Chromium-spawn burst when fork() returns EAGAIN. The
  // launcher must release-and-re-acquire so the entire service's
  // ~40 features don't all fail with "Target page, context or
  // browser has been closed".
  // --------------------------------------------------------------------
  // Context-pool migration: the pooled launcher checks out a pooled
  // CONTEXT per newContext() (pool.acquire) and releases it on close
  // (pool.release). No Browser is held, so the dead-browser re-acquire
  // dance is gone — the pool only opens contexts on live browsers. Each
  // acquire moves inUse by 1, per-feature headers forward into acquire,
  // and abort closes open contexts (each releasing its context).
  describe("createPooledE2eFullLauncher", () => {
    it("checks out a pooled context per newContext() and moves inUse by 1", async () => {
      const pool = makeFakeContextPool(4);
      const launcher = createPooledE2eFullLauncher(
        pool as unknown as BrowserPool,
      );
      const browser = await launcher();
      expect(pool.stats().inUse).toBe(0);
      const ctx = await browser.newContext();
      expect(pool.stats().inUse).toBe(1);
      await ctx.close();
      expect(pool.stats().inUse).toBe(0);
      expect(pool._releaseLog).toHaveLength(1);
    });

    it("forwards newContext(opts).extraHTTPHeaders into pool.acquire", async () => {
      const pool = makeFakeContextPool(4);
      const launcher = createPooledE2eFullLauncher(
        pool as unknown as BrowserPool,
      );
      const browser = await launcher();
      await browser.newContext({
        extraHTTPHeaders: {
          "X-AIMock-Context": "slug-d6",
          "X-Test-Id": "d6-slug-d6",
        },
      });
      expect(pool._acquireOptions[0]).toEqual({
        extraHTTPHeaders: {
          "X-AIMock-Context": "slug-d6",
          "X-Test-Id": "d6-slug-d6",
        },
      });
    });

    it("closes open contexts on abort (each releasing its pooled context)", async () => {
      const pool = makeFakeContextPool(4);
      const launcher = createPooledE2eFullLauncher(
        pool as unknown as BrowserPool,
      );
      const ac = new AbortController();
      const browser = await launcher(ac.signal);
      const ctx = await browser.newContext();
      await ctx.newPage();
      expect(pool.stats().inUse).toBe(1);
      ac.abort();
      await new Promise((r) => setTimeout(r, 10));
      expect(pool._releaseLog).toHaveLength(1);
      expect(pool.stats().inUse).toBe(0);
    });

    it("launcher-level close is a no-op (contexts release themselves)", async () => {
      const pool = makeFakeContextPool(4);
      const launcher = createPooledE2eFullLauncher(
        pool as unknown as BrowserPool,
      );
      const browser = await launcher();
      const ctx = await browser.newContext();
      await ctx.close();
      await browser.close(); // no-op
      expect(pool._releaseLog).toHaveLength(1);
    });
  });
});

// Module-scoped fake context-pool for the createPooledE2eFullLauncher tests
// above — lifted out of the describe so oxlint's consistent-function-scoping
// is satisfied (the factory captures no parent state). Tracks per-CONTEXT
// acquire/release and the contextOptions each acquire was called with.
function makeFakeContextPool(maxContexts: number) {
  let nextCtxId = 0;
  // Track the set of currently-live contexts so release fidelity matches
  // the real BrowserPool: an unknown / double release is a no-op (does
  // NOT decrement the count). The previous unconditional decrement could
  // drive `live` negative and silently mask a double-release bug.
  const liveContexts = new Set<object>();
  const releaseLog: number[] = [];
  const acquireOptions: Array<
    { extraHTTPHeaders?: Record<string, string> } | undefined
  > = [];
  return {
    async acquire(options?: { extraHTTPHeaders?: Record<string, string> }) {
      if (liveContexts.size >= maxContexts) throw new Error("FakePool: at cap");
      const id = nextCtxId++;
      acquireOptions.push(options);
      const ctx = {
        __id: id,
        async newPage() {
          return {
            on: () => {},
            waitForSelector: async () => {},
            fill: async () => {},
            press: async () => {},
            evaluate: async () => 0,
            goto: async () => {},
            close: async () => {},
            click: async () => {},
            waitForFunction: async () => {},
            isClosed: () => false,
            locator: () => ({ count: async () => 0 }),
            route: async () => {},
            unroute: async () => {},
          } as unknown;
        },
        async close() {},
      };
      liveContexts.add(ctx);
      return ctx as unknown as Browser;
    },
    async release(ctx: unknown) {
      // Unknown / double release — no-op, mirroring BrowserPool.release.
      if (typeof ctx !== "object" || ctx === null || !liveContexts.has(ctx)) {
        return;
      }
      liveContexts.delete(ctx);
      releaseLog.push((ctx as { __id: number }).__id);
    },
    stats() {
      return {
        size: maxContexts,
        available: maxContexts - liveContexts.size,
        inUse: liveContexts.size,
        totalRecycles: 0,
      };
    },
    get _releaseLog() {
      return releaseLog;
    },
    get _acquireOptions() {
      return acquireOptions;
    },
  };
}

// ---------------------------------------------------------------------
// Pooled-context budget (e2e-full): feature-timeout must NOT free the
// semaphore slot until the orphaned (still-in-flight) runFeature's
// context is actually released. Otherwise a freed slot lets a new
// feature acquire a context while the orphan still holds one → live
// contexts exceed FEATURE_CONCURRENCY_D6's budget. Mirrors the d5 test.
// ---------------------------------------------------------------------
/** Module-scoped timer helper (oxlint consistent-function-scoping). */
function testSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Launcher whose contexts simulate pooled checkout: `newContext`
 * increments a live counter (tracking peak), each context's page `goto`
 * resolves only after `gotoDelayMs`, and `close()` resolves only after
 * `closeDelayMs` (the orphan window). Module-scoped for oxlint's
 * consistent-function-scoping.
 */
function makeSlowTeardownLauncherFull(opts: {
  gotoDelayMs: number;
  closeDelayMs: number;
}): {
  launcher: () => Promise<E2eFullBrowser>;
  state: { live: number; peakLive: number; opened: number; closed: number };
} {
  const state = { live: 0, peakLive: 0, opened: 0, closed: 0 };
  const browser: E2eFullBrowser = {
    async newContext(): Promise<E2eFullBrowserContext> {
      state.live++;
      state.opened++;
      if (state.live > state.peakLive) state.peakLive = state.live;
      return {
        async newPage(): Promise<E2eFullPage> {
          // Growing-count contract so the conversation settles quickly
          // (no 30s response timeout): runFeature then reaches its
          // finally and calls the (deliberately slow) context.close().
          let messageCount = 0;
          return {
            async goto() {
              await testSleep(opts.gotoDelayMs);
            },
            async waitForSelector() {},
            async fill() {},
            async press() {
              messageCount++;
            },
            async evaluate<R>() {
              return messageCount as unknown as R;
            },
            async click() {},
            async waitForFunction() {},
            async close() {},
          };
        },
        async close() {
          // The orphan window: the context stays live until this resolves.
          await testSleep(opts.closeDelayMs);
          state.live--;
          state.closed++;
        },
      };
    },
    async close() {},
  };
  return { launcher: async () => browser, state };
}

describe("e2e-full feature-timeout pooled-context budget", () => {
  beforeEach(() => {
    __clearD5RegistryForTesting();
  });

  it("does not exceed FEATURE_CONCURRENCY_D6 live contexts when features time out (slot release gated on orphan teardown)", async () => {
    // FEATURE_CONCURRENCY_D6 features acquire slots and time out (goto
    // hangs past featureTimeoutMs) but keep holding their contexts until
    // close() resolves. One extra feature waits in the semaphore queue.
    // If the slot is freed at timeout BEFORE the orphan's context is
    // released, the queued feature acquires an over-budget context →
    // peakLive > FEATURE_CONCURRENCY_D6. Gating slot release on the
    // in-flight runFeature settling keeps peakLive <= the budget.
    const conc = FEATURE_CONCURRENCY_D6;
    const featureTypes = [
      "agentic-chat",
      "tool-rendering",
      "shared-state-read",
      "shared-state-write",
      "hitl-text-input",
    ] as const;
    expect(featureTypes.length).toBeGreaterThan(conc);

    for (const ft of featureTypes) {
      registerD5Script(makeScript([ft]));
    }

    const { launcher, state } = makeSlowTeardownLauncherFull({
      gotoDelayMs: 60,
      closeDelayMs: 80,
    });

    const driver = createE2eFullDriver({
      launcher,
      scriptLoader: noopScriptLoader(),
      featureTimeoutMs: 20,
    });
    const sideEmits: ProbeResult<unknown>[] = [];
    const writer: ProbeResultWriter = {
      write: async (r) => {
        sideEmits.push(r);
      },
    };

    await driver.run(makeCtx({ writer }), {
      key: "d6-all-pills-e2e:showcase-test-slug",
      backendUrl: "https://test.example.com",
      features: [...featureTypes],
    });

    expect(state.opened).toBe(featureTypes.length);
    expect(state.peakLive).toBeLessThanOrEqual(conc);
    expect(state.live).toBe(0); // all released by the time run() resolves
  }, 20_000);
});

// ---------------------------------------------------------------------
// Per-feature retry uses an isolated AbortController per attempt (e2e-full):
// a retry after a RETRY-ELIGIBLE failure must actually execute the second
// attempt rather than being short-circuited by a poisoned (pre-aborted)
// signal. Observed via context-open count: runFeature returns `abort`
// WITHOUT opening a context if entered with an aborted signal, so a
// poisoned retry opens only ONE context; a healthy retry opens TWO.
// ---------------------------------------------------------------------
/**
 * Launcher whose first context FAILS with a retry-eligible `goto-error`
 * (goto rejects after >RETRY_MIN_DURATION_MS) and whose second SUCCEEDS.
 * Tracks contexts opened (one per executed attempt).
 */
function makeRetryLauncherFull(opts: { attempt1DelayMs: number }): {
  launcher: () => Promise<E2eFullBrowser>;
  state: { opened: number };
} {
  const state = { opened: 0 };
  const browser: E2eFullBrowser = {
    async newContext(): Promise<E2eFullBrowserContext> {
      const attempt = ++state.opened;
      return {
        async newPage(): Promise<E2eFullPage> {
          let messageCount = 0;
          return {
            async goto() {
              if (attempt === 1) {
                await testSleep(opts.attempt1DelayMs);
                throw new Error("nav blip (retryable)");
              }
            },
            async waitForSelector() {},
            async fill() {},
            async press() {
              messageCount++;
            },
            async evaluate<R>() {
              return messageCount as unknown as R;
            },
            async click() {},
            async waitForFunction() {},
            async close() {},
          };
        },
        async close() {},
      };
    },
    async close() {},
  };
  return { launcher: async () => browser, state };
}

describe("e2e-full per-feature retry signal isolation", () => {
  beforeEach(() => {
    __clearD5RegistryForTesting();
  });

  it("executes the second attempt after a retry-eligible failure (fresh, non-aborted signal)", async () => {
    // Attempt 1 fails retry-eligibly (goto-error) after
    // >= RETRY_MIN_DURATION_MS (2s); attempt 2 succeeds. The retry must
    // run with a fresh, un-aborted signal — observed by TWO contexts
    // being opened (a poisoned/aborted retry would open only one).
    registerD5Script(makeScript(["agentic-chat"]));

    const { launcher, state } = makeRetryLauncherFull({
      attempt1DelayMs: 2_100,
    });

    const driver = createE2eFullDriver({
      launcher,
      scriptLoader: noopScriptLoader(),
      featureTimeoutMs: 30_000, // above attempt durations — no timeout
    });
    const sideEmits: ProbeResult<unknown>[] = [];
    const writer: ProbeResultWriter = {
      write: async (r) => {
        sideEmits.push(r);
      },
    };

    await driver.run(makeCtx({ writer }), {
      key: "d6-all-pills-e2e:showcase-test-slug",
      backendUrl: "https://test.example.com",
      features: ["agentic-chat"],
    });

    // Two attempts executed → two contexts opened.
    expect(state.opened).toBe(2);
    const aggRow = sideEmits.find((r) => r.key === "d6:test-slug");
    expect(aggRow?.state).toBe("green");
  }, 15_000);

  // --- D5-take-one knobs ---------------------------------------------------
  //
  // The D5 probe is now a single-representative-pill invocation of THIS D6
  // driver: `representativeOnly: true` filters requestedFeatures to only the
  // featureTypes present in the representatives map, and `rowPrefix: "d5"`
  // threads the `d5:` dashboard key prefix through every emitted row so the
  // dashboard's D5 column lights up under D6's exact run conditions.
  describe("representativeOnly", () => {
    it("runs only featureTypes present in the representatives map", async () => {
      // Inject a narrow representatives set so the filter is discriminating:
      // only `agentic-chat` is a representative; `tool-rendering` is not.
      registerD5Script(makeScript(["agentic-chat"]));
      registerD5Script(makeScript(["tool-rendering"]));

      const sideEmits: ProbeResult<unknown>[] = [];
      const writer: ProbeResultWriter = {
        write: async (r) => {
          sideEmits.push(r);
        },
      };

      const driver = createE2eFullDriver({
        launcher: async () => makeBrowser(),
        scriptLoader: noopScriptLoader(),
        representatives: { "agentic-chat": "agentic-chat.json" },
      });
      const result = await driver.run(makeCtx({ writer }), {
        key: "d5-single-pill-e2e:showcase-test-slug",
        backendUrl: "https://test.example.com",
        features: ["agentic-chat", "tool-rendering"],
        representativeOnly: true,
      });

      expect(result.state).toBe("green");
      const signal = result.signal as E2eFullAggregateSignal;
      // Only the representative feature ran.
      expect(signal.total).toBe(1);
      expect(signal.passed).toBe(1);

      // tool-rendering was filtered out — no row emitted for it at all.
      const toolRow = sideEmits.find((r) => r.key.endsWith("/tool-rendering"));
      expect(toolRow).toBeUndefined();
    });

    it("runs ALL featureTypes when representativeOnly is false/absent", async () => {
      registerD5Script(makeScript(["agentic-chat"]));
      registerD5Script(makeScript(["tool-rendering"]));

      const sideEmits: ProbeResult<unknown>[] = [];
      const writer: ProbeResultWriter = {
        write: async (r) => {
          sideEmits.push(r);
        },
      };

      const driver = createE2eFullDriver({
        launcher: async () => makeBrowser(),
        scriptLoader: noopScriptLoader(),
        representatives: { "agentic-chat": "agentic-chat.json" },
      });
      const result = await driver.run(makeCtx({ writer }), {
        key: "d6:showcase-test-slug",
        backendUrl: "https://test.example.com",
        features: ["agentic-chat", "tool-rendering"],
      });

      const signal = result.signal as E2eFullAggregateSignal;
      expect(signal.total).toBe(2);
    });
  });

  describe("rowPrefix", () => {
    it("emits d5:<slug>/<ft> and d5:<slug> keys when rowPrefix is d5", async () => {
      registerD5Script(makeScript(["agentic-chat"]));

      const sideEmits: ProbeResult<unknown>[] = [];
      const writer: ProbeResultWriter = {
        write: async (r) => {
          sideEmits.push(r);
        },
      };

      const driver = createE2eFullDriver({
        launcher: async () => makeBrowser(),
        scriptLoader: noopScriptLoader(),
      });
      const result = await driver.run(makeCtx({ writer }), {
        key: "d5-single-pill-e2e:showcase-test-slug",
        backendUrl: "https://test.example.com",
        features: ["agentic-chat"],
        rowPrefix: "d5",
      });

      expect(result.state).toBe("green");

      // Per-cell side row uses the d5: prefix.
      const cellRow = sideEmits.find(
        (r) => r.key === "d5:test-slug/agentic-chat",
      );
      expect(cellRow).toBeDefined();
      expect(cellRow!.state).toBe("green");

      // Aggregate row uses the d5: prefix.
      const aggRow = sideEmits.find((r) => r.key === "d5:test-slug");
      expect(aggRow).toBeDefined();
      expect(aggRow!.state).toBe("green");

      // No d6: rows leaked.
      const d6Rows = sideEmits.filter((r) => r.key.startsWith("d6:"));
      expect(d6Rows).toEqual([]);
    });

    it("defaults to d6: prefix when rowPrefix is absent", async () => {
      registerD5Script(makeScript(["agentic-chat"]));

      const sideEmits: ProbeResult<unknown>[] = [];
      const writer: ProbeResultWriter = {
        write: async (r) => {
          sideEmits.push(r);
        },
      };

      const driver = createE2eFullDriver({
        launcher: async () => makeBrowser(),
        scriptLoader: noopScriptLoader(),
      });
      await driver.run(makeCtx({ writer }), {
        key: "d6:showcase-test-slug",
        backendUrl: "https://test.example.com",
        features: ["agentic-chat"],
      });

      const cellRow = sideEmits.find(
        (r) => r.key === "d6:test-slug/agentic-chat",
      );
      expect(cellRow).toBeDefined();
      const aggRow = sideEmits.find((r) => r.key === "d6:test-slug");
      expect(aggRow).toBeDefined();
    });
  });

  // --- Composed: the REAL D5 invocation shape ------------------------------
  //
  // buildDeepInputs stamps BOTH knobs together (`representativeOnly: true` AND
  // `rowPrefix: "d5"`). The isolated knob tests above don't exercise them in
  // combination; this asserts the actual D5 contract: only representative
  // featureTypes run, AND every emitted key (per-cell + aggregate) uses the
  // `d5:` prefix.
  describe("representativeOnly + rowPrefix:d5 (real D5 invocation shape)", () => {
    it("runs only D5_REPRESENTATIVES featureTypes and emits d5:<slug>/<ft> + d5:<slug> keys", async () => {
      // agentic-chat is a representative; tool-rendering is not.
      registerD5Script(makeScript(["agentic-chat"]));
      registerD5Script(makeScript(["tool-rendering"]));

      const sideEmits: ProbeResult<unknown>[] = [];
      const writer: ProbeResultWriter = {
        write: async (r) => {
          sideEmits.push(r);
        },
      };

      const driver = createE2eFullDriver({
        launcher: async () => makeBrowser(),
        scriptLoader: noopScriptLoader(),
        representatives: { "agentic-chat": "agentic-chat.json" },
      });
      const result = await driver.run(makeCtx({ writer }), {
        key: "d5-single-pill-e2e:showcase-test-slug",
        backendUrl: "https://test.example.com",
        features: ["agentic-chat", "tool-rendering"],
        representativeOnly: true,
        rowPrefix: "d5",
      });

      expect(result.state).toBe("green");

      // (a) Only the representative featureType ran (tool-rendering filtered).
      const signal = result.signal as E2eFullAggregateSignal;
      expect(signal.total).toBe(1);
      expect(signal.passed).toBe(1);
      const toolRow = sideEmits.find((r) => r.key.endsWith("/tool-rendering"));
      expect(toolRow).toBeUndefined();

      // (b) Per-cell key uses the d5: prefix: d5:<slug>/<ft>.
      const cellRow = sideEmits.find(
        (r) => r.key === "d5:test-slug/agentic-chat",
      );
      expect(cellRow).toBeDefined();
      expect(cellRow!.state).toBe("green");

      // (b) Aggregate key uses the d5: prefix: d5:<slug>.
      const aggRow = sideEmits.find((r) => r.key === "d5:test-slug");
      expect(aggRow).toBeDefined();
      expect(aggRow!.state).toBe("green");

      // No d6: rows leaked under the composed D5 shape.
      const d6Rows = sideEmits.filter((r) => r.key.startsWith("d6:"));
      expect(d6Rows).toEqual([]);
    });
  });
});
