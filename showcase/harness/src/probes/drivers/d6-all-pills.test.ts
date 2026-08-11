import { describe, it, expect, beforeEach } from "vitest";
import {
  BrowserDisconnectedError,
  createE2eFullDriver,
  createPooledE2eFullLauncher,
  DEPLOY_CHURN_GRACE_MS,
  e2eFullDriver,
  FEATURE_CONCURRENCY_D6,
  MAX_BROWSER_RELAUNCHES_D6,
  openGuardedContext,
  openSelfHealingContext,
  parseFailureClassifier,
  Semaphore,
} from "./d6-all-pills.js";
import type { SelfHealDeps } from "./d6-all-pills.js";
import { CVDIAG_FAILURE_CLASSIFIERS } from "../../cvdiag/index.js";
import type { GuardableBrowser } from "./d6-all-pills.js";
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
  /**
   * When true, `goto` never resolves — used to exercise the driver's
   * outer-cap timeout (the abort fires while the page is hung) so a test can
   * assert WHICH timeout value the driver resolved.
   */
  stallGoto?: boolean;
}

function makePage(script: PageScript = {}): E2eFullPage {
  let messageCount = 0;
  return {
    async goto() {
      if (script.throwOnGoto) throw script.throwOnGoto;
      if (script.stallGoto) {
        // Hang until the run's outer-cap abort tears the page down.
        await new Promise<void>(() => {});
      }
    },
    async waitForSelector() {},
    async fill() {},
    async press() {
      if (!script.stallEvaluate) {
        messageCount++;
      }
    },
    async evaluate<R>(fn: () => R): Promise<R> {
      // The conversation-runner now makes structurally different
      // page.evaluate calls — `countAssistantMessages` (returns number),
      // `readCascadeState` (returns `{count, text}`), `readErrorBanner`
      // (returns `{state, text?}`), `readRunsFinished` (number), and
      // `captureDiagnostics` (an object). Dispatch on the closure body so
      // each branch returns the right shape. Mirrors the dispatch table
      // used by the conversation-runner.test.ts fake (kept in lock-step).
      const fnBody = typeof fn === "function" ? fn.toString() : "";
      // SSE counter — readRunsFinished returns a number; surface the
      // current messageCount so the SSE conjunct in waitForTurnComplete
      // ticks alongside the DOM count.
      if (fnBody.includes("__hk_runsFinished")) {
        return messageCount as unknown as R;
      }
      // Error-banner probe — return `{state: "absent"}` (the validated
      // shape) so readErrorBanner reports absent and fast-fail stays
      // disarmed in these tests.
      if (fnBody.includes("copilot-error-banner")) {
        return { state: "absent" } as unknown as R;
      }
      // Atomic cascade-state read — readCascadeState returns
      // `{count, text}`. The closure body contains BOTH `querySelectorAll`
      // and `textContent` AND `{ count` in its return literal.
      if (
        fnBody.includes("querySelectorAll") &&
        fnBody.includes("textContent") &&
        fnBody.includes("{ count")
      ) {
        const text =
          messageCount > 0 ? `assistant-bubble-text-${messageCount}` : null;
        return { count: messageCount, text } as unknown as R;
      }
      // Diagnostics capture (captureDiagnostics) — returns an object
      // shape consumed by `diagnostics.assistantMsgCount = ...` merge.
      if (fnBody.includes("userMsgCount") || fnBody.includes("apiRequests")) {
        return {
          userMsgCount: 0,
          apiRequestCount: 0,
          apiRequests: [],
          pageErrors: [],
          chatContainerExists: true,
          url: "about:blank",
          title: "",
          bodyTextSnippet: "",
        } as unknown as R;
      }
      // Default — assistant/user message COUNT (countAssistantMessages
      // and similar) returns a number.
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
  abortSignal?: AbortSignal;
  drainReason?: "shutdown";
}): ProbeContext {
  return {
    now: () => new Date("2025-01-01T00:00:00Z"),
    logger,
    env: {},
    writer: overrides?.writer,
    featureTypes: overrides?.featureTypes,
    abortSignal: overrides?.abortSignal,
    drainReason: overrides?.drainReason,
  };
}

function noopScriptLoader() {
  return async () => {};
}

function makeScript(
  featureTypes: string[],
  opts?: {
    preNavigateRoute?: string;
    turns?: ReturnType<D5Script["buildTurns"]>;
  },
): D5Script {
  return {
    featureTypes: featureTypes as D5Script["featureTypes"],
    fixtureFile: "test-fixture.json",
    buildTurns: () =>
      opts?.turns ?? [
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

  // FIX 3 (graceful drain): when the run is aborted as part of a worker drain
  // (`ctx.drainReason === "shutdown"`), the driver must SUPPRESS the red
  // per-cell `errorClass: "abort"` side-emits it would otherwise write for
  // not-yet-completed features — a redeploy must not paint a mass-red block.
  // The worker-loop layer separately skips reporting the partial; the driver's
  // job here is purely to suppress the per-cell red side-emits.
  describe("graceful-drain abort suppression", () => {
    it("suppresses red abort side-emits for unstarted features when drainReason=shutdown", async () => {
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

      // Pre-aborted signal = the worker has already started draining when the
      // feature loop reaches this pill, so the abort branch fires immediately.
      const ac = new AbortController();
      ac.abort();

      await driver.run(
        makeCtx({ writer, abortSignal: ac.signal, drainReason: "shutdown" }),
        {
          key: "e2e_d6:showcase-test-slug",
          backendUrl: "https://test.example.com",
          features: ["agentic-chat"],
        },
      );

      // NO red per-cell abort side-emit for the unstarted pill.
      const redAbortCells = sideEmits.filter(
        (r) =>
          r.state === "red" &&
          (r.signal as { errorClass?: string })?.errorClass === "abort",
      );
      expect(redAbortCells).toEqual([]);
    });

    it("STILL emits red abort side-emits when aborted WITHOUT a drain reason (timeout/error abort)", async () => {
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

      // Pre-aborted, but NOT a drain (no drainReason) — a timeout/error abort
      // still paints red so a genuine failure is visible.
      const ac = new AbortController();
      ac.abort();

      await driver.run(makeCtx({ writer, abortSignal: ac.signal }), {
        key: "e2e_d6:showcase-test-slug",
        backendUrl: "https://test.example.com",
        features: ["agentic-chat"],
      });

      const redAbortCells = sideEmits.filter(
        (r) =>
          r.state === "red" &&
          (r.signal as { errorClass?: string })?.errorClass === "abort",
      );
      expect(redAbortCells.length).toBeGreaterThan(0);
    });

    it("internal timeout abort STILL emits red side-emits even when ctx carries an un-fired drain signal", async () => {
      // Fleet-shaped ctx: in production the worker threads its drain signal
      // into EVERY ctx (and stamps drainReason alongside it), but here the
      // signal never FIRES — the abort is the driver's own wall-clock
      // `timeoutMs` cap. A timeout is a genuine failure and must paint red;
      // suppression is only for an abort caused by the external drain signal
      // actually firing. Saturate the semaphore so the queued feature hits the
      // pre-start abort branch and the running ones hit the mid-run branch.
      const featureTypes = [
        "agentic-chat",
        "tool-rendering",
        "shared-state-read",
        "shared-state-write",
        "hitl-text-input",
      ] as const;
      expect(featureTypes.length).toBeGreaterThan(FEATURE_CONCURRENCY_D6);
      for (const ft of featureTypes) {
        registerD5Script(makeScript([ft]));
      }

      const sideEmits: ProbeResult<unknown>[] = [];
      const writer: ProbeResultWriter = {
        write: async (r) => {
          sideEmits.push(r);
        },
      };

      const { launcher } = makeSlowTeardownLauncherFull({
        gotoDelayMs: 200,
        closeDelayMs: 5,
      });
      const driver = createE2eFullDriver({
        launcher,
        scriptLoader: noopScriptLoader(),
        // Large enough that the OUTER cap (not the per-feature timer) drives
        // the abort.
        featureTimeoutMs: 60_000,
      });

      // The drain signal EXISTS but never fires.
      const ac = new AbortController();

      const result = await driver.run(
        makeCtx({ writer, abortSignal: ac.signal, drainReason: "shutdown" }),
        {
          key: "e2e_d6:showcase-test-slug",
          backendUrl: "https://test.example.com",
          features: [...featureTypes],
          // Tiny outer cap so the driver's INTERNAL timeout abort fires fast.
          timeout_ms: 5,
        },
      );

      expect(result.state).toBe("red");
      // The timeout abort must paint red per-cell side-emits — the un-fired
      // drain signal must NOT suppress them.
      const redAbortCells = sideEmits.filter(
        (r) =>
          r.state === "red" &&
          (r.signal as { errorClass?: string })?.errorClass === "abort",
      );
      expect(redAbortCells.length).toBeGreaterThan(0);
    }, 20_000);

    // B4 (finish-and-report): post-B2/B3 a run can FINISH-AND-REPORT after a
    // graceful drain (the drain signal is no longer the run's hard-cancel; the
    // run keeps going until grace-expiry fires the SEPARATE `runAbort`, which
    // becomes `ctx.abortSignal`). So a feature that RUNS TO COMPLETION while
    // the worker is draining — and returns a LEGITIMATE red (a genuine test
    // failure, errorClass `goto-error`, NOT `abort`) — MUST report that real
    // terminal red. Suppression is scoped to ABORTED runs only (the
    // `ctx.abortSignal.aborted` + `errorClass === "abort"` conjuncts), so the
    // mere presence of `drainReason: "shutdown"` must NOT swallow a finished
    // run's honest red. This pins the aborted-only contract: a draining worker
    // that finishes its in-flight cell paints the real result, red or green.
    it("B4: a FINISHED run's legitimate red is REPORTED (not suppressed) while drainReason=shutdown and the abort signal has NOT fired", async () => {
      registerD5Script(makeScript(["agentic-chat"]));

      const sideEmits: ProbeResult<unknown>[] = [];
      const writer: ProbeResultWriter = {
        write: async (r) => {
          sideEmits.push(r);
        },
      };

      // The feature runs to completion and FAILS with a genuine goto-error
      // (errorClass != "abort"). It is finished, not aborted.
      const driver = createE2eFullDriver({
        launcher: async () =>
          makeBrowser({ pageScript: { throwOnGoto: new Error("nav boom") } }),
        scriptLoader: noopScriptLoader(),
      });

      // Fleet-shaped ctx: the worker stamps `drainReason: "shutdown"` (the
      // drain signal FIRED) but the run's hard-cancel signal (`ctx.abortSignal`
      // = runAbort, the grace-expiry abort) has NOT fired — the run finished
      // within grace. This is exactly the finish-and-report surface.
      const runAbort = new AbortController(); // never aborted: run finished in grace

      const result = await driver.run(
        makeCtx({
          writer,
          abortSignal: runAbort.signal,
          drainReason: "shutdown",
        }),
        {
          key: "e2e_d6:showcase-test-slug",
          backendUrl: "https://test.example.com",
          features: ["agentic-chat"],
        },
      );

      // The finished run's REAL terminal result must surface: aggregate red…
      expect(result.state).toBe("red");
      // …and the per-cell side-emit for the finished-red feature must be
      // REPORTED, not drain-suppressed (its errorClass is the honest
      // failure class, not "abort").
      const featureRed = sideEmits.find(
        (r) => r.key === "d6:test-slug/agentic-chat" && r.state === "red",
      );
      expect(featureRed).toBeDefined();
      expect(
        (featureRed!.signal as { errorClass?: string }).errorClass,
      ).not.toBe("abort");
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

  // --------------------------------------------------------------------
  // Shared-browser disconnect guard (byoc "...has been closed" race).
  //
  // The single-shared-browser launcher (defaultLauncher / CLI headed
  // launcher) opens one Chromium and a CONTEXT per feature on it. Under
  // the D6 fan-out's spawn/memory burst (heaviest for byoc) the shared
  // browser can disconnect mid-run; the unguarded code then threw the raw
  // Playwright "Target page, context or browser has been closed" on every
  // remaining feature's newContext(), surfacing as an opaque driver-error.
  // openGuardedContext mirrors the pooled launcher's "open only on a LIVE
  // browser" model so the failure is a clean, classifiable
  // BrowserDisconnectedError instead of the raw string.
  // --------------------------------------------------------------------
  describe("openGuardedContext (shared-browser disconnect guard)", () => {
    it("opens a context when the browser is connected", async () => {
      const sentinel = { id: "ctx" };
      const browser: GuardableBrowser = {
        isConnected: () => true,
        newContext: async () => sentinel,
      };
      const ctx = await openGuardedContext<typeof sentinel>(browser);
      expect(ctx).toBe(sentinel);
    });

    it("throws BrowserDisconnectedError when the browser is already disconnected (never calls newContext)", async () => {
      let called = false;
      const browser: GuardableBrowser = {
        isConnected: () => false,
        newContext: async () => {
          called = true;
          return {};
        },
      };
      await expect(openGuardedContext(browser)).rejects.toBeInstanceOf(
        BrowserDisconnectedError,
      );
      expect(called).toBe(false);
    });

    it("converts a mid-open disconnect (raw 'has been closed') into BrowserDisconnectedError", async () => {
      let connected = true;
      const browser: GuardableBrowser = {
        isConnected: () => connected,
        newContext: async () => {
          // Simulate the browser dying WHILE newContext() is in flight: the
          // process disconnects and Playwright rejects with the raw string.
          connected = false;
          throw new Error(
            "browser.newContext: Target page, context or browser has been closed",
          );
        },
      };
      await expect(openGuardedContext(browser)).rejects.toBeInstanceOf(
        BrowserDisconnectedError,
      );
    });

    it("surfaces a transient open error unchanged when the browser is still live", async () => {
      const browser: GuardableBrowser = {
        isConnected: () => true,
        newContext: async () => {
          throw new Error("transient open hiccup");
        },
      };
      await expect(openGuardedContext(browser)).rejects.toThrow(
        "transient open hiccup",
      );
    });
  });

  describe("shared-browser disconnect mid-run (integration)", () => {
    it("fails features cleanly (no raw 'has been closed') when the shared browser disconnects mid-fanout", async () => {
      registerD5Script(makeScript(["agentic-chat"]));
      registerD5Script(makeScript(["tool-rendering"]));

      // Single shared raw browser that disconnects after the FIRST context
      // open — exactly the byoc burst scenario. The launcher routes every
      // newContext() through openGuardedContext, so the second feature gets a
      // clean BrowserDisconnectedError instead of the raw Playwright string.
      let connected = true;
      let opened = false;
      const rawBrowser: GuardableBrowser & { close(): Promise<void> } = {
        isConnected: () => connected,
        newContext: async () => {
          if (!connected) {
            // Browser already torn down — Playwright's raw throw. The guard's
            // start-check should normally prevent reaching here, but the
            // post-open re-check converts a mid-open disconnect too.
            throw new Error(
              "browser.newContext: Target page, context or browser has been closed",
            );
          }
          if (opened) {
            // A second open while still "connected": simulate the crash landing
            // exactly during this in-flight open (the mid-open window).
            connected = false;
            throw new Error(
              "browser.newContext: Target page, context or browser has been closed",
            );
          }
          // First open succeeds, then the shared Chromium disconnects.
          opened = true;
          connected = false;
          return {
            newPage: async () => makePage(),
            close: async () => {},
          };
        },
        close: async () => {},
      };

      const sideEmits: ProbeResult<E2eFullFeatureSignal>[] = [];
      const writer: ProbeResultWriter = {
        write: async (r) => {
          sideEmits.push(r as ProbeResult<E2eFullFeatureSignal>);
        },
      };

      const driver = createE2eFullDriver({
        launcher: async (): Promise<E2eFullBrowser> => ({
          async newContext(contextOpts?: {
            extraHTTPHeaders?: Record<string, string>;
          }): Promise<E2eFullBrowserContext> {
            const ctx = await openGuardedContext<{
              newPage: () => Promise<E2eFullPage>;
              close: () => Promise<void>;
            }>(rawBrowser, contextOpts);
            return ctx;
          },
          close: () => rawBrowser.close(),
        }),
        scriptLoader: noopScriptLoader(),
      });

      const result = await driver.run(makeCtx({ writer }), {
        key: "e2e_d6:byoc",
        backendUrl: "https://byoc.example.com",
        features: ["agentic-chat", "tool-rendering"],
      });

      expect(result.state).toBe("red");
      // The failing feature's reason must be the clean sentinel reason, NOT
      // the raw Playwright "has been closed" string.
      const failureSummary = result.signal.failureSummary ?? "";
      expect(failureSummary).toContain("shared browser disconnected");
      expect(failureSummary).not.toContain(
        "Target page, context or browser has been closed",
      );

      // And no per-feature side row leaked the raw string either.
      for (const emit of sideEmits) {
        const desc = emit.signal?.errorDesc ?? "";
        expect(desc).not.toContain(
          "Target page, context or browser has been closed",
        );
      }
    });
  });

  // --------------------------------------------------------------------
  // SELF-HEAL: openGuardedContext (above) makes a shared-browser crash
  // CLASSIFIABLE but does NOT recover — once the single shared Chromium
  // crashes mid-fanout, every remaining feature open hits a dead browser
  // and the whole run cascades red/abort (claude-sdk-python collapses
  // 0/40). openSelfHealingContext RELAUNCHES the shared browser (bounded)
  // and retries the open, so one crash no longer wipes the run.
  // --------------------------------------------------------------------
  describe("openSelfHealingContext (shared-browser crash recovery)", () => {
    // A relaunchable fake: `live[i]` toggles the i-th browser's connectivity.
    // newContext throws the raw "has been closed" once its browser is dead.
    function makeRelaunchable(opts: {
      // How many contexts the CURRENT browser opens before it "crashes".
      opensBeforeCrash: number;
    }) {
      let generation = 0;
      let opensOnCurrent = 0;
      let connected = true;
      const relaunchLog: number[] = [];
      const build = (): GuardableBrowser => ({
        isConnected: () => connected,
        newContext: async () => {
          if (!connected) {
            throw new Error(
              "browser.newContext: Target page, context or browser has been closed",
            );
          }
          opensOnCurrent += 1;
          if (opensOnCurrent >= opts.opensBeforeCrash) {
            // This open is the last before the crash: succeed, then die.
            connected = false;
          }
          return { id: `ctx-gen${generation}-open${opensOnCurrent}` };
        },
      });
      let current = build();
      return {
        deps(warnLogger?: {
          warn(e: string, m?: Record<string, unknown>): void;
        }): SelfHealDeps<GuardableBrowser> {
          return {
            get: () => current,
            set: (b) => {
              current = b;
            },
            relaunch: async () => {
              generation += 1;
              opensOnCurrent = 0;
              connected = true;
              relaunchLog.push(generation);
              current = build();
              return current;
            },
            maxRelaunches: MAX_BROWSER_RELAUNCHES_D6,
            counter: { relaunches: 0 },
            logger: warnLogger,
          };
        },
        relaunchLog,
      };
    }

    it("relaunches the shared browser and retries the open after a crash", async () => {
      const warns: string[] = [];
      const rel = makeRelaunchable({ opensBeforeCrash: 1 });
      const deps = rel.deps({ warn: (e) => warns.push(e) });

      // First open succeeds (and crashes the browser). Second open would hit a
      // dead browser under the plain guard; self-heal relaunches + retries.
      const ctx1 = await openSelfHealingContext<
        { id: string },
        GuardableBrowser
      >(deps);
      expect(ctx1.id).toContain("gen0");
      const ctx2 = await openSelfHealingContext<
        { id: string },
        GuardableBrowser
      >(deps);
      // The second context comes from a RELAUNCHED browser (gen1), proving the
      // shared ref was swapped and the open retried — no cascade.
      expect(ctx2.id).toContain("gen1");
      expect(rel.relaunchLog).toEqual([1]);
      expect(warns).toContain("probe.e2e-full.browser-relaunch");
    });

    it("bounds relaunches: a browser that will not stay up degrades to a clean BrowserDisconnectedError", async () => {
      const warns: string[] = [];
      // Every launched browser is born already-dead: its start-check refuses to
      // open (BrowserDisconnectedError), so every attempt triggers a relaunch,
      // exhausting the bounded budget. `gen` counts relaunches.
      let gen = 0;
      const deadBrowser: GuardableBrowser = {
        isConnected: () => false,
        newContext: async () => ({}),
      };
      const deps: SelfHealDeps<GuardableBrowser> = {
        get: () => deadBrowser,
        set: () => {},
        relaunch: async () => {
          gen += 1;
          return deadBrowser;
        },
        maxRelaunches: MAX_BROWSER_RELAUNCHES_D6,
        counter: { relaunches: 0 },
        logger: { warn: (e) => warns.push(e) },
      };
      await expect(openSelfHealingContext(deps)).rejects.toBeInstanceOf(
        BrowserDisconnectedError,
      );
      // Exactly the bounded number of relaunch attempts were made.
      expect(gen).toBe(MAX_BROWSER_RELAUNCHES_D6);
      expect(warns).toContain("probe.e2e-full.browser-relaunch-exhausted");
    });

    it("does NOT relaunch on a transient open error while the browser stays live (no cascade masking)", async () => {
      let relaunched = false;
      const deps: SelfHealDeps<never> = {
        get: () =>
          ({
            isConnected: () => true,
            newContext: async () => {
              throw new Error("transient open hiccup");
            },
          }) as unknown as never,
        set: () => {},
        relaunch: async () => {
          relaunched = true;
          return undefined as unknown as never;
        },
        maxRelaunches: MAX_BROWSER_RELAUNCHES_D6,
        counter: { relaunches: 0 },
      };
      await expect(openSelfHealingContext(deps)).rejects.toThrow(
        "transient open hiccup",
      );
      // A live-browser open error is that feature's own failure — never a
      // relaunch. The clean error taxonomy for genuine failures is preserved.
      expect(relaunched).toBe(false);
    });
  });

  // --------------------------------------------------------------------
  // The DRIVER-LEVEL cascade proof. Runs the real multi-feature loop
  // (createE2eFullDriver) with a launcher that routes every open through the
  // REAL openSelfHealingContext over a relaunchable raw-browser fake that
  // crashes after its first context open. This is the same repro surface the
  // pre-fix integration test above exercises — the ONLY difference is the open
  // path (openGuardedContext → cascade-red vs openSelfHealingContext →
  // recover). RED (pre-fix, plain guard): the second feature + aggregate go red
  // with "shared browser disconnected". GREEN (self-heal): the launcher
  // relaunches a fresh browser and both features complete.
  // --------------------------------------------------------------------
  describe("shared-browser crash self-heal (driver integration)", () => {
    // A relaunchable raw-browser fake: each browser crashes after
    // `opensBeforeCrash` context opens; relaunch yields a fresh live browser
    // that returns already-wrapped E2eFull pages (mirrors the pre-fix
    // integration test's launcher shape). `launchCount` counts initial +
    // relaunches so we can assert a relaunch actually happened.
    function makeRelaunchableRawBrowser(opts: { opensBeforeCrash: number }) {
      type RawCtx = {
        newPage: () => Promise<E2eFullPage>;
        close: () => Promise<void>;
      };
      type RawBrowser = GuardableBrowser & { close(): Promise<void> };
      let launchCount = 0;
      const build = (): RawBrowser => {
        let connected = true;
        let opens = 0;
        return {
          isConnected: () => connected,
          newContext: async (): Promise<RawCtx> => {
            if (!connected) {
              throw new Error(
                "browser.newContext: Target page, context or browser has been closed",
              );
            }
            opens += 1;
            if (opens >= opts.opensBeforeCrash) connected = false;
            return {
              newPage: async () => makePage(),
              close: async () => {},
            };
          },
          close: async () => {},
        };
      };
      let current = build();
      launchCount = 1;
      const counter = { relaunches: 0 };
      const warns: string[] = [];
      // A launcher whose newContext routes through the REAL self-heal helper.
      const launcher = async (): Promise<E2eFullBrowser> => ({
        async newContext(contextOpts?: {
          extraHTTPHeaders?: Record<string, string>;
        }): Promise<E2eFullBrowserContext> {
          const ctx = await openSelfHealingContext<RawCtx, RawBrowser>(
            {
              get: () => current,
              set: (b) => {
                current = b;
              },
              relaunch: async () => {
                launchCount += 1;
                current = build();
                return current;
              },
              maxRelaunches: MAX_BROWSER_RELAUNCHES_D6,
              counter,
              logger: { warn: (e) => warns.push(e) },
            },
            contextOpts,
          );
          return ctx as unknown as E2eFullBrowserContext;
        },
        close: () => current.close(),
      });
      return {
        launcher,
        warns,
        get launchCount() {
          return launchCount;
        },
      };
    }

    it("recovers remaining features after the shared browser crashes mid-fanout (cascade stopped)", async () => {
      registerD5Script(makeScript(["agentic-chat"]));
      registerD5Script(makeScript(["tool-rendering"]));

      const sideEmits: ProbeResult<E2eFullFeatureSignal>[] = [];
      const writer: ProbeResultWriter = {
        write: async (r) => {
          sideEmits.push(r as ProbeResult<E2eFullFeatureSignal>);
        },
      };

      // Crash after the first context open — exactly the byoc burst scenario.
      const fake = makeRelaunchableRawBrowser({ opensBeforeCrash: 1 });

      const driver = createE2eFullDriver({
        launcher: fake.launcher,
        scriptLoader: noopScriptLoader(),
      });

      const result = await driver.run(makeCtx({ writer }), {
        key: "e2e_d6:byoc",
        backendUrl: "https://byoc.example.com",
        features: ["agentic-chat", "tool-rendering"],
      });

      // GREEN: with self-heal, the crash is recovered and BOTH features pass —
      // no cascade. (Pre-fix, the second feature and the aggregate went red
      // with "shared browser disconnected".)
      const signal = result.signal as E2eFullAggregateSignal;
      expect(result.state).toBe("green");
      expect(signal.passed).toBe(2);
      expect(signal.failed).toEqual([]);
      // The browser was relaunched at least once (initial launch + relaunch).
      expect(fake.launchCount).toBeGreaterThanOrEqual(2);
      expect(fake.warns).toContain("probe.e2e-full.browser-relaunch");

      // No side row leaked the raw Playwright string.
      for (const emit of sideEmits) {
        const desc = emit.signal?.errorDesc ?? "";
        expect(desc).not.toContain(
          "Target page, context or browser has been closed",
        );
      }
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
            async evaluate<R>(fn: () => R): Promise<R> {
              // Dispatch on closure body — see `makePage` for the
              // full rationale; this launcher needs the same routing
              // so readCascadeState/readErrorBanner/captureDiagnostics
              // each get the right return shape.
              const fnBody = typeof fn === "function" ? fn.toString() : "";
              if (fnBody.includes("__hk_runsFinished")) {
                return messageCount as unknown as R;
              }
              if (fnBody.includes("copilot-error-banner")) {
                return { state: "absent" } as unknown as R;
              }
              if (
                fnBody.includes("querySelectorAll") &&
                fnBody.includes("textContent") &&
                fnBody.includes("{ count")
              ) {
                const text =
                  messageCount > 0
                    ? `assistant-bubble-text-${messageCount}`
                    : null;
                return { count: messageCount, text } as unknown as R;
              }
              if (
                fnBody.includes("userMsgCount") ||
                fnBody.includes("apiRequests")
              ) {
                return {
                  userMsgCount: 0,
                  apiRequestCount: 0,
                  apiRequests: [],
                  pageErrors: [],
                  chatContainerExists: true,
                  url: "about:blank",
                  title: "",
                  bodyTextSnippet: "",
                } as unknown as R;
              }
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

  // Fix B: the fleet enumerator conveys the YAML outer-cap in
  // `input.timeout_ms`; the driver must HONOR it over the dep/default. Without
  // the per-run read the driver falls back to DEFAULT_TIMEOUT_MS (10 min) and a
  // slow backend false-aborts at 10 min instead of the YAML budget.
  describe("input.timeout_ms is honored over the construction dep/default", () => {
    it("aborts at the conveyed input.timeout_ms (queued feature errorDesc names the conveyed value, not the 600000 default)", async () => {
      // Saturate the semaphore: more features than FEATURE_CONCURRENCY_D6 so at
      // least one feature is still QUEUED when the outer cap fires. The running
      // features have a slow goto; the tiny outer `timeout_ms` aborts mid-goto.
      // When the queued feature then acquires its slot it hits the pre-feature
      // abort check, which emits `timeout after <resolved-cap>ms` — the exact
      // value the driver resolved. With the bug (dep/default used) that text
      // would read 600000ms; with the fix it reads the conveyed 5ms.
      const featureTypes = [
        "agentic-chat",
        "tool-rendering",
        "shared-state-read",
        "shared-state-write",
        "hitl-text-input",
      ] as const;
      expect(featureTypes.length).toBeGreaterThan(FEATURE_CONCURRENCY_D6);
      for (const ft of featureTypes) {
        registerD5Script(makeScript([ft]));
      }

      const sideEmits: ProbeResult<unknown>[] = [];
      const writer: ProbeResultWriter = {
        write: async (r) => {
          sideEmits.push(r);
        },
      };

      const { launcher } = makeSlowTeardownLauncherFull({
        gotoDelayMs: 200,
        closeDelayMs: 5,
      });
      const driver = createE2eFullDriver({
        launcher,
        scriptLoader: noopScriptLoader(),
        // Construction-time dep is the 10-min default; the conveyed input cap
        // must win.
        timeoutMs: 600_000,
        // Large enough that the OUTER cap (not the per-feature timer) drives the
        // abort.
        featureTimeoutMs: 60_000,
      });
      const result = await driver.run(makeCtx({ writer }), {
        key: "d6-all-pills-e2e:showcase-test-slug",
        backendUrl: "https://test.example.com",
        features: [...featureTypes],
        // The fleet enumerator's conveyed cap — tiny so the test resolves fast.
        timeout_ms: 5,
      });

      expect(result.state).toBe("red");
      // Some feature side-row reports the OUTER-cap timeout with the conveyed
      // value (the queued feature that hit the pre-feature abort check).
      const timeoutRows = sideEmits.filter((r) => {
        const sig = r.signal as E2eFullFeatureSignal;
        return (
          typeof sig?.errorDesc === "string" &&
          sig.errorDesc.startsWith("timeout after ")
        );
      });
      expect(timeoutRows.length).toBeGreaterThan(0);
      for (const r of timeoutRows) {
        const sig = r.signal as E2eFullFeatureSignal;
        // PROOF the driver read input.timeout_ms (5), NOT the dep/default
        // (600000).
        expect(sig.errorDesc).toBe("timeout after 5ms");
        expect(sig.errorDesc).not.toContain("600000");
      }
    }, 20_000);
  });
});

// ── D6 CVDIAG probe instrumentation (probe-session) ─────────────────────────
//
// The d5/d6 probe path (`d6-all-pills`) now constructs the SAME
// `CvdiagProbeSession` the d4 driver uses, emitting probe-layer boundaries
// (notably `probe.exit` with `terminal_outcome` + `failure_classifier`) so the
// flapping d5/d6 runs are readable from `cvdiag_events`. These tests inject a
// VERBOSE-tier emitter wired to a capturing PB writer and assert the emitted
// envelopes directly — mirroring the d4 CVDIAG tests.

import { CvdiagEmitter } from "../../cvdiag/index.js";
import type { CvdiagEnvelope } from "../../cvdiag/index.js";

/** Capturing PB writer: records every flushed envelope for assertion. */
class D6CaptureWriter {
  events: CvdiagEnvelope[] = [];
  async writeBatch(events: CvdiagEnvelope[]): Promise<void> {
    this.events.push(...events);
  }
}

/** Build a VERBOSE-tier emitter wired to a capturing PB writer. */
function makeD6CvdiagEmitter(): {
  emitter: CvdiagEmitter;
  writer: D6CaptureWriter;
} {
  const writer = new D6CaptureWriter();
  const emitter = new CvdiagEmitter({
    verbose: true,
    env: {},
    layer: "probe",
    pbWriter: writer,
  });
  return { emitter, writer };
}

function byD6Boundary(
  writer: D6CaptureWriter,
  boundary: string,
): CvdiagEnvelope[] {
  return writer.events.filter((e) => e.boundary === boundary);
}

describe("d6 CVDIAG probe instrumentation (probe-session)", () => {
  beforeEach(() => {
    __clearD5RegistryForTesting();
  });

  it("emits exactly one probe.exit with terminal_outcome=ok for a passing feature", async () => {
    // RED (pre-change): runFeature constructed NO CvdiagProbeSession, so an
    // injected VERBOSE emitter received ZERO `probe.exit` rows on the d5/d6
    // path. GREEN: a passing feature emits exactly one `probe.exit` with
    // `terminal_outcome=ok` and no failure classifier.
    registerD5Script(makeScript(["agentic-chat"]));
    const { emitter, writer } = makeD6CvdiagEmitter();

    const driver = createE2eFullDriver({
      launcher: async () => makeBrowser(),
      scriptLoader: noopScriptLoader(),
      cvdiagEmitter: emitter,
    });
    const result = await driver.run(makeCtx(), {
      key: "d6:showcase-test-slug",
      backendUrl: "https://test.example.com",
      features: ["agentic-chat"],
    });
    await emitter.flush();

    expect(result.state).toBe("green");
    const exit = byD6Boundary(writer, "probe.exit");
    expect(exit.length).toBe(1);
    expect(exit[0]!.outcome).toBe("ok");
    expect(exit[0]!.metadata.terminal_outcome).toBe("ok");
    expect(exit[0]!.metadata.failure_classifier).toBeUndefined();
  });

  it("emits a probe.start before navigation for a passing feature", async () => {
    registerD5Script(makeScript(["agentic-chat"]));
    const { emitter, writer } = makeD6CvdiagEmitter();

    const driver = createE2eFullDriver({
      launcher: async () => makeBrowser(),
      scriptLoader: noopScriptLoader(),
      cvdiagEmitter: emitter,
    });
    await driver.run(makeCtx(), {
      key: "d6:showcase-test-slug",
      backendUrl: "https://test.example.com",
      features: ["agentic-chat"],
    });
    await emitter.flush();

    const start = byD6Boundary(writer, "probe.start");
    expect(start.length).toBe(1);
  });

  it("labels a failed feature (goto error) on probe.exit with outcome=err + a failure_classifier", async () => {
    // RED (pre-change): a failing feature emitted no probe.exit at all on the
    // d5/d6 path, so reds were invisible in cvdiag. GREEN: the feature emits a
    // single `probe.exit` with `outcome=err` AND a `failure_classifier`
    // (derived: no SSE observed by the probe-session => `sse-missing`).
    registerD5Script(makeScript(["agentic-chat"]));
    const { emitter, writer } = makeD6CvdiagEmitter();

    const driver = createE2eFullDriver({
      launcher: async () =>
        makeBrowser({ pageScript: { throwOnGoto: new Error("nav boom") } }),
      scriptLoader: noopScriptLoader(),
      cvdiagEmitter: emitter,
    });
    const result = await driver.run(makeCtx(), {
      key: "d6:showcase-test-slug",
      backendUrl: "https://test.example.com",
      features: ["agentic-chat"],
    });
    await emitter.flush();

    expect(result.state).toBe("red");
    const exit = byD6Boundary(writer, "probe.exit");
    expect(exit.length).toBe(1);
    expect(exit[0]!.outcome).toBe("err");
    expect(exit[0]!.metadata.terminal_outcome).toBe("err");
    expect(exit[0]!.metadata.failure_classifier).toBeDefined();
  });

  it("never emits CVDIAG rows when no emitter is injected (instrumentation off)", async () => {
    // Control: a missing emitter is a clean no-op — the probe path is
    // unchanged and still greens.
    registerD5Script(makeScript(["agentic-chat"]));
    const driver = createE2eFullDriver({
      launcher: async () => makeBrowser(),
      scriptLoader: noopScriptLoader(),
    });
    const result = await driver.run(makeCtx(), {
      key: "d6:showcase-test-slug",
      backendUrl: "https://test.example.com",
      features: ["agentic-chat"],
    });
    expect(result.state).toBe("green");
  });

  it("does not throw the cvdiag char-count out of the probe path on a non-string turn input (cvdiag isolation)", async () => {
    // RED (pre-change): the cvdiag message-send char count was computed
    // UNGUARDED in the probe's main path BEFORE `runConversation`, via
    // `turns.reduce((n, t) => n + [...t.input].length, 0)`. A turn whose
    // `input` is null/undefined/non-string makes the spread throw
    // `t.input is not iterable`, which escapes runFeature and REDs the probe
    // with THAT cvdiag error. cvdiag instrumentation must NEVER compute-or-
    // throw into the probe path. GREEN (post-change): the per-turn length
    // coerces a non-string `input` to 0, so the cvdiag spread no longer
    // throws — the probe never fails with the cvdiag `is not iterable`
    // error (the conversation-runner separately rejects a non-string input
    // on its own merits, which is correct probe behavior, NOT a cvdiag
    // concern).
    registerD5Script(
      makeScript(["agentic-chat"], {
        // A malformed turn (e.g. a buggy script producing a non-string input).
        // Typed `string`, so cast to exercise the runtime defect the cvdiag
        // spread would have thrown on.
        turns: [{ input: undefined as unknown as string }],
      }),
    );
    const { emitter } = makeD6CvdiagEmitter();

    const driver = createE2eFullDriver({
      launcher: async () => makeBrowser(),
      scriptLoader: noopScriptLoader(),
      cvdiagEmitter: emitter,
    });
    const result = await driver.run(makeCtx(), {
      key: "d6:showcase-test-slug",
      backendUrl: "https://test.example.com",
      features: ["agentic-chat"],
    });
    await emitter.flush();

    // The cvdiag char-count spread no longer throws into the probe path: the
    // feature's failure (if any) is the conversation-runner's own non-string
    // rejection, never the cvdiag `t.input is not iterable` throw.
    const signal = result.signal as E2eFullAggregateSignal;
    expect(signal.failureSummary ?? "").not.toContain("is not iterable");
  });

  it("computes no char count and emits nothing when the emitter is absent (cvdiag no-op)", async () => {
    // The char-count reduction lives INSIDE the `if (cvdiag)` guard, so with
    // no emitter the reduction is never evaluated and cvdiag is a clean no-op
    // — a normal valid-string feature still greens and (the control already
    // covered) emits zero CVDIAG rows. This pins the guard: the computation
    // must not run on the emitter-absent path.
    registerD5Script(
      makeScript(["agentic-chat"], { turns: [{ input: "hi" }] }),
    );
    const driver = createE2eFullDriver({
      launcher: async () => makeBrowser(),
      scriptLoader: noopScriptLoader(),
    });
    const result = await driver.run(makeCtx(), {
      key: "d6:showcase-test-slug",
      backendUrl: "https://test.example.com",
      features: ["agentic-chat"],
    });
    expect(result.state).toBe("green");
  });

  it("records the cvdiag message-send char count for valid turns (computation intact under the guard)", async () => {
    // Post-change the char count moved INSIDE `if (cvdiag)`. This pins that
    // the normal path still records one `probe.message.send` whose char count
    // is the Unicode code-point total across the (valid string) turns —
    // "hello" (5) + "world!" (6) = 11.
    registerD5Script(
      makeScript(["agentic-chat"], {
        turns: [{ input: "hello" }, { input: "world!" }],
      }),
    );
    const { emitter, writer } = makeD6CvdiagEmitter();

    const driver = createE2eFullDriver({
      launcher: async () => makeBrowser(),
      scriptLoader: noopScriptLoader(),
      cvdiagEmitter: emitter,
    });
    const result = await driver.run(makeCtx(), {
      key: "d6:showcase-test-slug",
      backendUrl: "https://test.example.com",
      features: ["agentic-chat"],
    });
    await emitter.flush();

    expect(result.state).toBe("green");
    const sends = byD6Boundary(writer, "probe.message.send");
    expect(sends.length).toBe(1);
    expect(sends[0]!.metadata.char_count).toBe(11);
  });
});

describe("parseFailureClassifier (conversation-error breadcrumb)", () => {
  it("accepts selector-mismatch (regression: was dropped by a stale 4-member allow-list)", () => {
    // RED before fix: parseFailureClassifier validated against a hardcoded
    // {dom-missing, text-unstable, sse-missing, surface-missing} subset that
    // omitted `selector-mismatch`, so a `reason=selector-mismatch` breadcrumb
    // returned undefined → fell through to the derived `sse-missing` classifier
    // → the cell was mislabeled. The allow-list now derives from the canonical
    // CVDIAG_FAILURE_CLASSIFIERS, so the breadcrumb survives.
    expect(
      parseFailureClassifier(
        "turn 0 failed: reason=selector-mismatch — pill never matched",
      ),
    ).toBe("selector-mismatch");
  });

  it("accepts every canonical CVDIAG_FAILURE_CLASSIFIERS member (no drift)", () => {
    for (const classifier of CVDIAG_FAILURE_CLASSIFIERS) {
      expect(
        parseFailureClassifier(`turn 0 failed: reason=${classifier}`),
      ).toBe(classifier);
    }
  });

  it("strips trailing punctuation from the breadcrumb", () => {
    expect(
      parseFailureClassifier("turn 0 failed: reason=selector-mismatch,"),
    ).toBe("selector-mismatch");
  });

  it("returns undefined for an unrecognized reason or a missing breadcrumb", () => {
    expect(
      parseFailureClassifier("turn 0 failed: reason=bogus"),
    ).toBeUndefined();
    expect(
      parseFailureClassifier("turn 0 failed: no breadcrumb"),
    ).toBeUndefined();
    expect(parseFailureClassifier(undefined)).toBeUndefined();
  });
});
