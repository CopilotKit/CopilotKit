import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  BrowserDisconnectedError,
  createE2eFullDriver,
  createPooledE2eFullLauncher,
  DEPLOY_CHURN_GRACE_MS,
  e2eFullDriver,
  FEATURE_CONCURRENCY_D6,
  openGuardedContext,
  parseFailureClassifier,
  Semaphore,
} from "./d6-all-pills.js";
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
import { __overrideSpecDrivenSlugsForTesting } from "../helpers/spec-driven-slugs.js";
import type { CellVerdict } from "../helpers/d6-rollup.js";
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

// ─────────────────────────────────────────────────────────────────────────────
// Spec-driven verdict-source switch (Task 5.1)
//
// RED-GREEN BRANCH PROOF:
//
// (a) NO-OP PROOF: covered by the existing 53-test suite above — with
//     spec-driven-slugs.json empty, every slug returns `isSpecDriven() = false`
//     and the heuristic path is taken, byte-unchanged.
//
// (b) BRANCH PROOF: when `isSpecDriven(slug)` returns true, the driver MUST
//     take the spec-driven path and emit rows from the rollup verdicts, NOT
//     from `countAssistantMessages`. The assertions below can only pass when
//     the spec-driven branch is active:
//       - The `d6:<slug>/<cell>` rows carry `errorClass: "spec-failed"` (RED)
//         and `errorClass: "unknown"` (UNKNOWN) — shapes that the heuristic
//         path never emits.
//       - The aggregate `state` is "red" because `failedCount > 0`.
//       - The launcher (browser) is NEVER called — the heuristic path would
//         open a browser, so `launcherCallCount === 0` proves spec-driven ran.
//
// To verify RED (before the branch exists), temporarily remove the
// `if (isSpecDriven(...))` block from `d6-all-pills.ts` and run this suite —
// the assertions below fail because the heuristic path produces a green result
// from the fake browser (which returns 1 assistant message per turn) and never
// emits the `spec-failed` errorClass.
// ─────────────────────────────────────────────────────────────────────────────
describe("spec-driven verdict-source switch (Task 5.1)", () => {
  beforeEach(() => {
    __clearD5RegistryForTesting();
  });

  afterEach(() => {
    // Restore the file-loaded slug list (always empty in Phase 0).
    __overrideSpecDrivenSlugsForTesting(undefined);
  });

  it("(b) BRANCH PROOF: when slug is spec-driven, rows come from injected rollup, not countAssistantMessages", async () => {
    // ── Setup: flag the stub slug ─────────────────────────────────────────
    __overrideSpecDrivenSlugsForTesting(["spec-driven-stub-slug"]);

    // ── Stub specDrivenRunner returning two known verdicts ────────────────
    // Cell "agentic-chat" → RED (spec failed)
    // Cell "tool-based-generative-ui" → UNKNOWN (no spec / errored)
    const verdicts = new Map<string, string>([
      ["agentic-chat", "RED"],
      ["tool-based-generative-ui", "UNKNOWN"],
    ]);
    let specDrivenRunnerCalled = false;
    const stubSpecDrivenRunner = async (
      slug: string,
      opts: {
        backendUrl: string;
        integrationDir: string;
        timeoutMs?: number;
        ctx: ProbeContext;
      },
    ) => {
      specDrivenRunnerCalled = true;
      // Emit per-cell rows directly (mirrors what runSpecDrivenD6 does).
      for (const [cell, verdict] of verdicts) {
        const state =
          verdict === "RED" || verdict === "UNKNOWN" ? "red" : "green";
        await opts.ctx.writer?.write({
          key: `d6:${slug}/${cell}`,
          state,
          signal: {
            slug,
            featureType: cell,
            backendUrl: opts.backendUrl,
            errorClass: verdict === "RED" ? "spec-failed" : "unknown",
          },
          observedAt: new Date().toISOString(),
        });
      }
      // Emit aggregate row (mirrors emitAggregate in runSpecDrivenD6).
      await opts.ctx.writer?.write({
        key: `d6:${slug}`,
        state: "red",
        signal: {
          shape: "package",
          slug,
          backendUrl: opts.backendUrl,
          total: 2,
          passed: 0,
          failed: ["agentic-chat", "tool-based-generative-ui"],
          skipped: [],
        },
        observedAt: new Date().toISOString(),
      });
      return {
        verdicts: verdicts as Map<
          import("../helpers/d5-registry.js").D5FeatureType,
          CellVerdict
        >,
        greenCount: 0,
        cellsFailed: 2,
        skippedCount: 0,
        unknownCells: [],
        redCells: ["agentic-chat", "tool-based-generative-ui"],
        skipMaskedRed: [],
        inertSkipEntries: [],
      };
    };

    // ── Fake browser that tracks calls (must NOT be called in spec path) ──
    let launcherCallCount = 0;
    const trackingLauncher = async () => {
      launcherCallCount++;
      return makeBrowser();
    };

    // ── Capture emitted rows ──────────────────────────────────────────────
    const emitted: ProbeResult<unknown>[] = [];
    const writer: ProbeResultWriter = {
      write: async (r) => {
        emitted.push(r);
      },
    };

    const driver = createE2eFullDriver({
      launcher: trackingLauncher,
      scriptLoader: noopScriptLoader(),
      specDrivenRunner: stubSpecDrivenRunner,
    });

    const result = await driver.run(makeCtx({ writer }), {
      key: "d6-all-pills-e2e:showcase-spec-driven-stub-slug",
      backendUrl: "https://spec-driven-test.example.com",
      demos: ["agentic-chat"],
    });

    // ── Assertions ────────────────────────────────────────────────────────

    // The specDrivenRunner must have been called.
    expect(
      specDrivenRunnerCalled,
      "specDrivenRunner was not called — branch not taken",
    ).toBe(true);

    // The browser must NOT have been opened (heuristic path was NOT taken).
    expect(
      launcherCallCount,
      "browser was opened — heuristic path was taken instead of spec-driven",
    ).toBe(0);

    // Aggregate result is red (2 failed cells).
    expect(result.state).toBe("red");

    // Per-cell rows carry rollup-derived errorClass values that the heuristic
    // path never emits. This is the definitive proof that the verdict came
    // from the stub rollup, not from countAssistantMessages.
    const agenticChatRow = emitted.find(
      (r) => r.key === "d6:spec-driven-stub-slug/agentic-chat",
    );
    expect(
      agenticChatRow,
      "d6:<slug>/agentic-chat row not emitted",
    ).toBeDefined();
    expect(agenticChatRow!.state).toBe("red");
    expect((agenticChatRow!.signal as { errorClass?: string }).errorClass).toBe(
      "spec-failed",
    );

    const unknownRow = emitted.find(
      (r) => r.key === "d6:spec-driven-stub-slug/tool-based-generative-ui",
    );
    expect(
      unknownRow,
      "d6:<slug>/tool-based-generative-ui row not emitted",
    ).toBeDefined();
    expect(unknownRow!.state).toBe("red");
    expect((unknownRow!.signal as { errorClass?: string }).errorClass).toBe(
      "unknown",
    );

    // Aggregate row emitted with red state.
    const aggRow = emitted.find((r) => r.key === "d6:spec-driven-stub-slug");
    expect(aggRow, "d6:<slug> aggregate row not emitted").toBeDefined();
    expect(aggRow!.state).toBe("red");
  });

  it("(b) NO-OP: with empty flag file, heuristic path runs (browser opened)", async () => {
    // spec-driven-slugs.json is empty in Phase 0.
    // __overrideSpecDrivenSlugsForTesting not called → uses empty file default.
    registerD5Script(makeScript(["agentic-chat"]));

    let launcherCallCount = 0;
    const trackingLauncher = async () => {
      launcherCallCount++;
      return makeBrowser();
    };

    let specDrivenRunnerCalled = false;
    const stubSpecDrivenRunner = async () => {
      specDrivenRunnerCalled = true;
      return {
        verdicts: new Map(),
        greenCount: 0,
        cellsFailed: 0,
        skippedCount: 0,
        unknownCells: [],
        redCells: [],
        skipMaskedRed: [],
        inertSkipEntries: [],
      };
    };

    const driver = createE2eFullDriver({
      launcher: trackingLauncher,
      scriptLoader: noopScriptLoader(),
      specDrivenRunner: stubSpecDrivenRunner,
    });

    const result = await driver.run(makeCtx(), {
      key: "d6-all-pills-e2e:showcase-not-spec-driven-slug",
      backendUrl: "https://heuristic-test.example.com",
      features: ["agentic-chat"],
    });

    // Heuristic ran (browser was used).
    expect(
      launcherCallCount,
      "heuristic path did not run — browser not opened",
    ).toBeGreaterThan(0);
    // Spec-driven runner was NOT called.
    expect(
      specDrivenRunnerCalled,
      "specDrivenRunner called but slug is not flagged",
    ).toBe(false);
    // Result is green (heuristic passed with fake browser).
    expect(result.state).toBe("green");
  });

  it("(b) rowPrefix=d5 always uses heuristic even when slug is spec-driven", async () => {
    // The D5 probe sets rowPrefix="d5"; spec-driven is D6-only.
    __overrideSpecDrivenSlugsForTesting(["spec-driven-stub-slug"]);
    registerD5Script(makeScript(["agentic-chat"]));

    let launcherCallCount = 0;
    const trackingLauncher = async () => {
      launcherCallCount++;
      return makeBrowser();
    };

    let specDrivenRunnerCalled = false;
    const stubSpecDrivenRunner = async () => {
      specDrivenRunnerCalled = true;
      return {
        verdicts: new Map(),
        greenCount: 0,
        cellsFailed: 0,
        skippedCount: 0,
        unknownCells: [],
        redCells: [],
        skipMaskedRed: [],
        inertSkipEntries: [],
      };
    };

    const driver = createE2eFullDriver({
      launcher: trackingLauncher,
      scriptLoader: noopScriptLoader(),
      specDrivenRunner: stubSpecDrivenRunner,
    });

    const result = await driver.run(makeCtx(), {
      key: "d5-single-pill-e2e:showcase-spec-driven-stub-slug",
      backendUrl: "https://d5-test.example.com",
      features: ["agentic-chat"],
      rowPrefix: "d5",
    });

    // Heuristic ran (browser was used) — spec-driven is bypassed for D5.
    expect(
      launcherCallCount,
      "browser not opened — spec-driven path ran for D5 (wrong)",
    ).toBeGreaterThan(0);
    expect(
      specDrivenRunnerCalled,
      "specDrivenRunner called for D5 rowPrefix (wrong)",
    ).toBe(false);
    expect(result.state).toBe("green");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F1-F8: Fail-closed hardening of the spec-driven driver branch (F3 concern)
//
// RED-GREEN PROOF for each item:
//   F1 — emitAggregate on every exit: before fix the import-error and empty-
//        verdict paths returned WITHOUT calling emitAggregate, leaving the
//        d6:<slug> row stale. Tests verify the aggregate IS emitted on those
//        paths.
//   F2+F4 — state and failed[] derive from same exhaustive reduction: before
//        fix, state came from failedCount (an opaque counter the runner owns)
//        and failed[] came from a separate filter pass — they could disagree.
//        UNKNOWN now counts as failed in both state and the array.
//   F3 — empty verdict map is red: before fix, verdicts.size===0 with
//        failedCount===0 returned GREEN. After fix, it returns RED.
//   F5 — timeout guard: before fix, raw input.timeout_ms (including Infinity
//        or NaN) was passed to the runner. After fix it falls back to the
//        default.
//   F6 — wall-clock cap + abort signal: before fix there was no AbortController
//        in the spec-driven branch. After fix, ctx.abortSignal is threaded and
//        the runner receives abortSignal in opts.
//   F7 — dynamic-import failure emits red aggregate: before fix a throw from
//        the import propagated uncaught. After fix it is caught and a red
//        aggregate is emitted.
//   F8 — notSupportedFeatures passed through: before fix the field was never
//        forwarded. After fix the runner opts contains it.
// ─────────────────────────────────────────────────────────────────────────────
describe("spec-driven fail-closed hardening (F1-F8)", () => {
  beforeEach(() => {
    __clearD5RegistryForTesting();
  });

  afterEach(() => {
    __overrideSpecDrivenSlugsForTesting(undefined);
  });

  // Helper: captures all rows written via ctx.writer
  function captureWriter(): {
    emitted: ProbeResult<unknown>[];
    writer: ProbeResultWriter;
  } {
    const emitted: ProbeResult<unknown>[] = [];
    return {
      emitted,
      writer: {
        write: async (r) => {
          emitted.push(r);
        },
      },
    };
  }

  // Helper: a simple spec-driven runner returning fixed verdicts.
  // `capture` is a mutable object updated in place by the runner so
  // callers can destructure a reference to it without losing live updates
  // (JavaScript destructuring calls getters once; a mutable object is safe).
  function makeRunner(
    verdicts: Map<string, string>,
    runnerOpts?: { skippedCount?: number },
  ) {
    const capture = {
      called: false,
      timeoutMs: undefined as number | undefined,
      notSupportedFeatures: undefined as string[] | undefined,
      hasAbortSignal: false,
    };
    const runner = async (
      _slug: string,
      o: {
        backendUrl: string;
        integrationDir: string;
        timeoutMs?: number;
        notSupportedFeatures?: string[];
        signal?: AbortSignal;
        ctx: ProbeContext;
      },
    ) => {
      capture.called = true;
      capture.timeoutMs = o.timeoutMs;
      capture.notSupportedFeatures = o.notSupportedFeatures;
      capture.hasAbortSignal = o.signal !== undefined;
      let green = 0;
      let failed = 0;
      let skipped = 0;
      const redCells: string[] = [];
      for (const [cell, v] of verdicts.entries()) {
        if (v === "GREEN") green++;
        else if (v === "SKIPPED") skipped++;
        else {
          failed++;
          redCells.push(cell);
        }
      }
      return {
        verdicts: verdicts as Map<
          import("../helpers/d5-registry.js").D5FeatureType,
          CellVerdict
        >,
        greenCount: green,
        cellsFailed: failed,
        skippedCount: runnerOpts?.skippedCount ?? skipped,
        unknownCells: [],
        redCells,
        skipMaskedRed: [],
        inertSkipEntries: [],
      };
    };
    return { runner, capture };
  }

  // F1 — emitAggregate on every branch exit (runner-CALL error path)
  // NOTE: this test exercises the runner-CALL catch (~runnerCallErr), NOT the
  // dynamic-import catch (~importErr). The runner is injected directly via
  // specDrivenRunner (skipping the import path entirely), so it throws on
  // CALL rather than on import. See "R2.4: real import-failure" below for
  // the import-catch coverage test.
  it("F1: runner-call error emits red aggregate with spec-driven-runner-error (no stale dashboard row)", async () => {
    __overrideSpecDrivenSlugsForTesting(["sd-test-slug"]);
    const { emitted, writer } = captureWriter();

    const driver = createE2eFullDriver({
      scriptLoader: noopScriptLoader(),
      // Inject a runner that throws on CALL — exercises runner-call catch, not import catch.
      specDrivenRunner: async () => {
        throw new Error("module not found");
      },
    });

    const result = await driver.run(makeCtx({ writer }), {
      key: "d6-all-pills-e2e:showcase-sd-test-slug",
      backendUrl: "https://sd-test.example.com",
      demos: [],
    });

    // RED result returned
    expect(result.state, "F1: runner-call-error result must be red").toBe(
      "red",
    );
    // Aggregate row emitted with d6:<slug> key
    const aggRow = emitted.find((r) => r.key === "d6:sd-test-slug");
    expect(
      aggRow,
      "F1: aggregate row must be emitted on runner-call-error path",
    ).toBeDefined();
    expect(aggRow!.state, "F1: aggregate row must be red").toBe("red");
    expect(
      (aggRow!.signal as { errorDesc?: string }).errorDesc,
      "F1: errorDesc must be spec-driven-runner-error (runner threw on call, NOT import failure)",
    ).toBe("spec-driven-runner-error");
  });

  // R2.4 — real import-failure test: forces the dynamic-import path to throw
  // via the injectable specDrivenImportResolver, giving the import-catch block
  // (~importErr, errorDesc "spec-driven-import-error") earned coverage.
  it("R2.4: import-module failure (via injectable resolver) emits red aggregate with spec-driven-import-error", async () => {
    __overrideSpecDrivenSlugsForTesting(["sd-test-slug"]);
    const { emitted, writer } = captureWriter();

    const driver = createE2eFullDriver({
      scriptLoader: noopScriptLoader(),
      // Do NOT inject specDrivenRunner — leave it undefined so the import
      // resolver path is consulted.
      // Inject a resolver that throws, simulating a real dynamic-import failure
      // (e.g. missing or malformed module) without needing a file on disk.
      specDrivenImportResolver: async () => {
        throw new Error("Cannot find module '../../cli/e2e.js'");
      },
    });

    const result = await driver.run(makeCtx({ writer }), {
      key: "d6-all-pills-e2e:showcase-sd-test-slug",
      backendUrl: "https://sd-test.example.com",
      demos: [],
    });

    // RED result returned
    expect(result.state, "R2.4: import-failure result must be red").toBe("red");
    // Aggregate row emitted with d6:<slug> key
    const aggRow = emitted.find((r) => r.key === "d6:sd-test-slug");
    expect(
      aggRow,
      "R2.4: aggregate row must be emitted on import-failure path",
    ).toBeDefined();
    expect(aggRow!.state, "R2.4: aggregate row must be red").toBe("red");
    // errorDesc must be spec-driven-IMPORT-error (not runner-error)
    expect(
      (aggRow!.signal as { errorDesc?: string }).errorDesc,
      "R2.4: errorDesc must be spec-driven-import-error (import path threw, not runner call)",
    ).toBe("spec-driven-import-error");
    // failureSummary carries the import error message
    expect(
      (aggRow!.signal as { failureSummary?: string }).failureSummary,
      "R2.4: failureSummary must contain the import error message",
    ).toContain("Cannot find module");
  });

  // F1 — emitAggregate on empty-verdict path
  it("F1+F3: empty verdict map emits red aggregate (not green/missing)", async () => {
    __overrideSpecDrivenSlugsForTesting(["sd-test-slug"]);
    const { emitted, writer } = captureWriter();
    const { runner } = makeRunner(new Map());

    const driver = createE2eFullDriver({
      scriptLoader: noopScriptLoader(),
      specDrivenRunner: runner,
    });

    const result = await driver.run(makeCtx({ writer }), {
      key: "d6-all-pills-e2e:showcase-sd-test-slug",
      backendUrl: "https://sd-test.example.com",
      demos: [],
    });

    // F3: empty verdicts → red (not green)
    expect(result.state, "F3: empty verdict map must be red").toBe("red");
    // F1: aggregate row emitted
    const aggRow = emitted.find((r) => r.key === "d6:sd-test-slug");
    expect(
      aggRow,
      "F1: aggregate row must be emitted on empty-verdict path",
    ).toBeDefined();
    expect(aggRow!.state, "F1+F3: aggregate row must be red").toBe("red");
  });

  // F2+F4 — UNKNOWN counts as failed in BOTH state and failed[]
  it("F2+F4: UNKNOWN verdict counts as failed in both state and failed[] (no disagree)", async () => {
    __overrideSpecDrivenSlugsForTesting(["sd-test-slug"]);
    const { emitted, writer } = captureWriter();
    // One GREEN, one UNKNOWN — failedCount=0 on the old path would have given GREEN
    const { runner } = makeRunner(
      new Map([
        ["agentic-chat", "GREEN"],
        ["tool-based-generative-ui", "UNKNOWN"],
      ]),
    );

    const driver = createE2eFullDriver({
      scriptLoader: noopScriptLoader(),
      specDrivenRunner: runner,
    });

    const result = await driver.run(makeCtx({ writer }), {
      key: "d6-all-pills-e2e:showcase-sd-test-slug",
      backendUrl: "https://sd-test.example.com",
      demos: [],
    });

    // F2: state is red because UNKNOWN counted as failed
    expect(result.state, "F2: state must be red when UNKNOWN present").toBe(
      "red",
    );
    // F4: failed[] contains the UNKNOWN cell
    expect(
      result.signal.failed,
      "F4: failed[] must include UNKNOWN cell",
    ).toContain("tool-based-generative-ui");
    // passed count is 1 (only GREEN)
    expect(result.signal.passed, "F2: passed count must be 1").toBe(1);
    // Aggregate row matches
    const aggRow = emitted.find((r) => r.key === "d6:sd-test-slug");
    expect(aggRow?.state, "F2: aggregate row must be red").toBe("red");
  });

  // F4 — unrecognized verdict value → fail-closed (counts as failed)
  it("F4: unrecognized verdict value is fail-closed (treated as failed, not dropped)", async () => {
    __overrideSpecDrivenSlugsForTesting(["sd-test-slug"]);
    const { writer } = captureWriter();
    const { runner } = makeRunner(
      new Map([["agentic-chat", "SOME_NEW_VERDICT_WE_DONT_KNOW"]]),
    );

    const driver = createE2eFullDriver({
      scriptLoader: noopScriptLoader(),
      specDrivenRunner: runner,
    });

    const result = await driver.run(makeCtx({ writer }), {
      key: "d6-all-pills-e2e:showcase-sd-test-slug",
      backendUrl: "https://sd-test.example.com",
      demos: [],
    });

    // Unrecognized verdict → fail-closed → state red, cell in failed[]
    expect(
      result.state,
      "F4: unrecognized verdict must be fail-closed (red)",
    ).toBe("red");
    expect(
      result.signal.failed,
      "F4: unrecognized verdict cell must be in failed[]",
    ).toContain("agentic-chat");
    expect(
      result.signal.passed,
      "F4: passed must be 0 with unrecognized verdict",
    ).toBe(0);
  });

  // F5 — invalid/missing timeout_ms falls back to DEFAULT_TIMEOUT_MS
  it("F5: invalid timeout_ms (Infinity) does not reach the runner raw — falls back to driver default", async () => {
    __overrideSpecDrivenSlugsForTesting(["sd-test-slug"]);
    const { writer } = captureWriter();
    const { runner, capture } = makeRunner(
      new Map([["agentic-chat", "GREEN"]]),
    );

    const driver = createE2eFullDriver({
      scriptLoader: noopScriptLoader(),
      specDrivenRunner: runner,
      timeoutMs: 99_999, // dep-level default
    });

    await driver.run(makeCtx({ writer }), {
      key: "d6-all-pills-e2e:showcase-sd-test-slug",
      backendUrl: "https://sd-test.example.com",
      demos: [],
      timeout_ms: Infinity as unknown as number,
    });

    // Infinity is not finite → should fall back to dep default (99999)
    expect(
      capture.timeoutMs,
      "F5: Infinity timeout_ms must fall back to dep default (99999)",
    ).toBe(99_999);
  });

  it("F5: missing timeout_ms falls back to DEFAULT_TIMEOUT_MS", async () => {
    __overrideSpecDrivenSlugsForTesting(["sd-test-slug"]);
    const { writer } = captureWriter();
    const { runner, capture } = makeRunner(
      new Map([["agentic-chat", "GREEN"]]),
    );

    // No dep-level override → should use DEFAULT_TIMEOUT_MS (10 min = 600000)
    const driver = createE2eFullDriver({
      scriptLoader: noopScriptLoader(),
      specDrivenRunner: runner,
    });

    await driver.run(makeCtx({ writer }), {
      key: "d6-all-pills-e2e:showcase-sd-test-slug",
      backendUrl: "https://sd-test.example.com",
      demos: [],
      // timeout_ms omitted
    });

    // Should use 10 * 60 * 1000 = 600000
    expect(
      capture.timeoutMs,
      "F5: missing timeout_ms must use DEFAULT_TIMEOUT_MS (600000)",
    ).toBe(600_000);
  });

  // F6 — runner receives abort signal
  it("F6: ctx.abortSignal is threaded into runner opts as signal", async () => {
    __overrideSpecDrivenSlugsForTesting(["sd-test-slug"]);
    const { writer } = captureWriter();
    const { runner, capture } = makeRunner(
      new Map([["agentic-chat", "GREEN"]]),
    );

    const externalAbort = new AbortController();
    const driver = createE2eFullDriver({
      scriptLoader: noopScriptLoader(),
      specDrivenRunner: runner,
    });

    await driver.run(makeCtx({ writer, abortSignal: externalAbort.signal }), {
      key: "d6-all-pills-e2e:showcase-sd-test-slug",
      backendUrl: "https://sd-test.example.com",
      demos: [],
    });

    expect(
      capture.hasAbortSignal,
      "F6: runner opts must receive signal (abort signal)",
    ).toBe(true);
  });

  // F6-wire-proof — opts.signal is defined AND fires when the wall-clock trips.
  //
  // RED proof (before R5-K2 + K1 rename): the driver passed the key `abortSignal:`
  // to the runner opts, but `runSpecDrivenD6` reads `opts.signal` — so the runner
  // received `opts.signal === undefined` and no abort ever fired. Injected runners
  // that waited on `opts.signal` hung until the outer timeout, masking the dead wire.
  //
  // GREEN (post-fix): the driver uses `signal:` matching RunSpecDrivenD6Options,
  // so the runner receives a live AbortSignal that fires when the wall-clock trips.
  it("F6-wire-proof: opts.signal is defined (not undefined) and fires abort when wall-clock trips", async () => {
    __overrideSpecDrivenSlugsForTesting(["sd-wire-proof-slug"]);
    const { writer } = captureWriter();

    let capturedSignal: AbortSignal | undefined;
    let signalFired = false;

    const driver = createE2eFullDriver({
      scriptLoader: noopScriptLoader(),
      specDrivenRunner: async (_slug, opts) => {
        // Capture the signal reference to assert it is defined.
        capturedSignal = opts.signal;
        // Register an abort listener so we can confirm it fires.
        if (opts.signal) {
          opts.signal.addEventListener(
            "abort",
            () => {
              signalFired = true;
            },
            { once: true },
          );
        }
        // Block until the signal fires (wall-clock abort) or 5s safety timeout.
        await new Promise<void>((resolve) => {
          if (opts.signal?.aborted) {
            resolve();
            return;
          }
          opts.signal?.addEventListener("abort", () => resolve(), {
            once: true,
          });
          // Safety: resolve after 5s so the test doesn't hang if the signal is dead.
          setTimeout(resolve, 5_000);
        });
        return {
          verdicts: new Map() as Map<
            import("../helpers/d5-registry.js").D5FeatureType,
            CellVerdict
          >,
          greenCount: 0,
          cellsFailed: 0,
          skippedCount: 0,
          unknownCells: [],
          redCells: [],
          skipMaskedRed: [],
          inertSkipEntries: [],
        };
      },
      timeoutMs: 20, // very short wall-clock so the timer fires quickly
    });

    await driver.run(makeCtx({ writer }), {
      key: "d6-all-pills-e2e:showcase-sd-wire-proof-slug",
      backendUrl: "https://sd-wire-proof.example.com",
      demos: [],
    });

    // RED before fix: capturedSignal would be undefined (wrong key `abortSignal:`)
    // and signalFired would be false (no listener registered because signal was absent).
    // GREEN after fix: signal is defined and fires.
    expect(
      capturedSignal,
      "F6-wire-proof: opts.signal must be defined (not undefined) — dead wire if undefined",
    ).toBeDefined();
    expect(
      signalFired,
      "F6-wire-proof: opts.signal must fire abort when wall-clock trips (wire is live)",
    ).toBe(true);
  }, 10_000);

  // F8 — notSupportedFeatures forwarded to runner
  it("F8: input.notSupportedFeatures is forwarded to runner opts", async () => {
    __overrideSpecDrivenSlugsForTesting(["sd-test-slug"]);
    const { writer } = captureWriter();
    const { runner, capture } = makeRunner(
      new Map([["agentic-chat", "GREEN"]]),
    );

    const driver = createE2eFullDriver({
      scriptLoader: noopScriptLoader(),
      specDrivenRunner: runner,
    });

    await driver.run(makeCtx({ writer }), {
      key: "d6-all-pills-e2e:showcase-sd-test-slug",
      backendUrl: "https://sd-test.example.com",
      demos: [],
      notSupportedFeatures: ["some-feature", "another-feature"],
    });

    expect(
      capture.notSupportedFeatures,
      "F8: notSupportedFeatures must be forwarded to runner",
    ).toEqual(["some-feature", "another-feature"]);
  });

  // F8 — absent notSupportedFeatures passes undefined (not an empty array)
  it("F8: absent notSupportedFeatures passes undefined to runner (not empty array)", async () => {
    __overrideSpecDrivenSlugsForTesting(["sd-test-slug"]);
    const { writer } = captureWriter();
    const { runner, capture } = makeRunner(
      new Map([["agentic-chat", "GREEN"]]),
    );

    const driver = createE2eFullDriver({
      scriptLoader: noopScriptLoader(),
      specDrivenRunner: runner,
    });

    await driver.run(makeCtx({ writer }), {
      key: "d6-all-pills-e2e:showcase-sd-test-slug",
      backendUrl: "https://sd-test.example.com",
      demos: [],
      // notSupportedFeatures omitted
    });

    expect(
      capture.notSupportedFeatures,
      "F8: absent notSupportedFeatures must be undefined in runner opts",
    ).toBeUndefined();
  });

  // ── R2.1: Wall-clock timeout forces red regardless of returned verdicts ───

  // RED proof: before fix, sdTimedOut was void-referenced and the runner's
  // all-green verdicts would be returned as GREEN. After fix, sdTimedOut=true
  // forces the aggregate to red with errorDesc="timeout".
  it("R2.1: wall-clock timeout forces red aggregate even when runner returns all-green verdicts", async () => {
    __overrideSpecDrivenSlugsForTesting(["sd-test-slug"]);
    const { emitted, writer } = captureWriter();

    // Runner resolves immediately with all-green verdicts AFTER the timeout
    // has fired. We simulate this by injecting a runner that (1) signals that
    // the timeout elapsed and (2) still returns GREEN — the driver must NOT
    // pass that GREEN aggregate back.
    let resolveRunner!: () => void;
    const runnerGate = new Promise<void>((r) => {
      resolveRunner = r;
    });
    const { runner } = makeRunner(new Map([["agentic-chat", "GREEN"]]));

    // Use a tiny timeout so the AbortController fires almost immediately.
    const driver = createE2eFullDriver({
      scriptLoader: noopScriptLoader(),
      specDrivenRunner: async (slug, opts) => {
        // Wait for the abort signal to fire (timeout elapsed), then return green.
        await new Promise<void>((resolve) => {
          if (opts.signal?.aborted) {
            resolve();
            return;
          }
          opts.signal?.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
        resolveRunner();
        return runner(slug, opts);
      },
      timeoutMs: 10, // 10 ms — fires almost immediately in test
    });

    const result = await driver.run(makeCtx({ writer }), {
      key: "d6-all-pills-e2e:showcase-sd-test-slug",
      backendUrl: "https://sd-test.example.com",
      demos: [],
    });

    // Wait for the runner gate so the test is deterministic.
    await runnerGate;

    // R2.1: aggregate MUST be red (timeout overrides partial-green verdicts)
    expect(result.state, "R2.1: timeout must force red aggregate").toBe("red");
    expect(
      (result.signal as { errorDesc?: string }).errorDesc,
      "R2.1: errorDesc must be 'timeout'",
    ).toBe("timeout");
    const aggRow = emitted.find((r) => r.key === "d6:sd-test-slug");
    expect(aggRow?.state, "R2.1: emitted aggregate row must be red").toBe(
      "red",
    );
    expect(
      (aggRow?.signal as { errorDesc?: string }).errorDesc,
      "R2.1: emitted aggregate errorDesc must be 'timeout'",
    ).toBe("timeout");
  });

  // ── R2.2: Empty-verdict aggregate total derives from runner counters ───────

  it("R2.2: empty verdict map aggregate uses runner-counter total (not hard-coded 0)", async () => {
    __overrideSpecDrivenSlugsForTesting(["sd-test-slug"]);
    const { emitted, writer } = captureWriter();

    // Runner returns empty verdicts but non-zero counters (e.g. 3 cells
    // were scanned but all filtered out before verdict assignment).
    const driver = createE2eFullDriver({
      scriptLoader: noopScriptLoader(),
      specDrivenRunner: async () => ({
        verdicts: new Map(),
        greenCount: 1,
        cellsFailed: 1,
        skippedCount: 1, // total = 3
        unknownCells: [],
        redCells: [],
        skipMaskedRed: [],
        inertSkipEntries: [],
      }),
    });

    const result = await driver.run(makeCtx({ writer }), {
      key: "d6-all-pills-e2e:showcase-sd-test-slug",
      backendUrl: "https://sd-test.example.com",
      demos: [],
    });

    // R2.2: total must be 3 (derived from runner counters), not 0.
    expect(result.state, "R2.2: empty-verdict aggregate must be red").toBe(
      "red",
    );
    expect(
      result.signal.total,
      "R2.2: total must derive from runner counters (3)",
    ).toBe(3);
    const aggRow = emitted.find((r) => r.key === "d6:sd-test-slug");
    expect(
      (aggRow?.signal as { total?: number })?.total,
      "R2.2: emitted aggregate total must be 3",
    ).toBe(3);
  });

  it("R2.2: empty verdict map with zero runner counters keeps total=0 (no cells registered)", async () => {
    __overrideSpecDrivenSlugsForTesting(["sd-test-slug"]);
    const { emitted, writer } = captureWriter();

    const driver = createE2eFullDriver({
      scriptLoader: noopScriptLoader(),
      specDrivenRunner: async () => ({
        verdicts: new Map(),
        greenCount: 0,
        cellsFailed: 0,
        skippedCount: 0,
        unknownCells: [],
        redCells: [],
        skipMaskedRed: [],
        inertSkipEntries: [],
      }),
    });

    const result = await driver.run(makeCtx({ writer }), {
      key: "d6-all-pills-e2e:showcase-sd-test-slug",
      backendUrl: "https://sd-test.example.com",
      demos: [],
    });

    // When counters are all 0 the total genuinely is 0.
    expect(
      result.signal.total,
      "R2.2: total must be 0 when counters are all zero",
    ).toBe(0);
    const aggRow = emitted.find((r) => r.key === "d6:sd-test-slug");
    expect(
      (aggRow?.signal as { total?: number })?.total,
      "R2.2: emitted aggregate total must be 0 with zero counters",
    ).toBe(0);
  });

  // ── R2.3: Partial-verdict runner (counter mismatch) → fail-closed red ─────

  it("R2.3: runner counter mismatch (partial verdict map) yields fail-closed red with diagnostic", async () => {
    __overrideSpecDrivenSlugsForTesting(["sd-test-slug"]);
    const { emitted, writer } = captureWriter();

    // Runner returns 1 verdict (GREEN for agentic-chat) but claims 3 total cells
    // via its counters — simulates a runner that dropped 2 cells silently.
    const driver = createE2eFullDriver({
      scriptLoader: noopScriptLoader(),
      specDrivenRunner: async () => ({
        verdicts: new Map([["agentic-chat", "GREEN"]]) as Map<
          import("../helpers/d5-registry.js").D5FeatureType,
          CellVerdict
        >,
        greenCount: 3, // claims 3 green
        cellsFailed: 0,
        skippedCount: 0, // total runner = 3, but verdicts.size = 1
        unknownCells: [],
        redCells: [],
        skipMaskedRed: [],
        inertSkipEntries: [],
      }),
    });

    const result = await driver.run(makeCtx({ writer }), {
      key: "d6-all-pills-e2e:showcase-sd-test-slug",
      backendUrl: "https://sd-test.example.com",
      demos: [],
    });

    // R2.3: must be red (fail-closed), not green
    expect(
      result.state,
      "R2.3: counter mismatch must force red (fail-closed)",
    ).toBe("red");
    expect(
      (result.signal as { errorDesc?: string }).errorDesc,
      "R2.3: errorDesc must be spec-driven-count-mismatch",
    ).toBe("spec-driven-count-mismatch");
    // SUM INVARIANT (Fix 3): total must be the verdict-reduction total (1),
    // NOT the runner's claimed total (3), so passed+failed+skipped===total holds.
    // The runner's claimed total is preserved in the note for diagnostics.
    expect(
      result.signal.total,
      "R2.3: total must be verdict-reduction total (1) for sum invariant",
    ).toBe(1);
    // Sum invariant: passed + failed.length + skipped.length must === total
    const {
      total: r23total,
      passed: r23passed,
      failed: r23failed,
      skipped: r23skipped,
    } = result.signal;
    expect(
      r23passed + r23failed.length + r23skipped.length,
      `R2.3 SUM-INV: sum must === total(${r23total})`,
    ).toBe(r23total);
    const aggRow = emitted.find((r) => r.key === "d6:sd-test-slug");
    expect(aggRow?.state, "R2.3: emitted aggregate must be red").toBe("red");
  });

  it("R2.3: matching runner counters and verdict reduction yields normal aggregate (no false mismatch)", async () => {
    __overrideSpecDrivenSlugsForTesting(["sd-test-slug"]);
    const { emitted, writer } = captureWriter();

    // Runner counters match the verdicts exactly — should produce a normal green.
    const driver = createE2eFullDriver({
      scriptLoader: noopScriptLoader(),
      specDrivenRunner: async () => ({
        verdicts: new Map([["agentic-chat", "GREEN"]]) as Map<
          import("../helpers/d5-registry.js").D5FeatureType,
          CellVerdict
        >,
        greenCount: 1,
        cellsFailed: 0,
        skippedCount: 0,
        unknownCells: [],
        redCells: [],
        skipMaskedRed: [],
        inertSkipEntries: [],
      }),
    });

    const result = await driver.run(makeCtx({ writer }), {
      key: "d6-all-pills-e2e:showcase-sd-test-slug",
      backendUrl: "https://sd-test.example.com",
      demos: [],
    });

    // Counters agree → normal aggregate (green)
    expect(
      result.state,
      "R2.3: matching counters must produce green aggregate",
    ).toBe("green");
    expect(
      (result.signal as { errorDesc?: string }).errorDesc,
      "R2.3: no errorDesc on normal green aggregate",
    ).toBeUndefined();
  });

  it("R2.3: zero runner counters with non-empty verdicts does not trigger mismatch (counter=0 exempt)", async () => {
    __overrideSpecDrivenSlugsForTesting(["sd-test-slug"]);
    const { writer } = captureWriter();

    // Runner returns 0 counters (legacy runner that doesn't populate them)
    // but has verdicts — should NOT be treated as mismatch.
    const driver = createE2eFullDriver({
      scriptLoader: noopScriptLoader(),
      specDrivenRunner: async () => ({
        verdicts: new Map([["agentic-chat", "GREEN"]]) as Map<
          import("../helpers/d5-registry.js").D5FeatureType,
          CellVerdict
        >,
        greenCount: 0,
        cellsFailed: 0,
        skippedCount: 0,
        unknownCells: [],
        redCells: [],
        skipMaskedRed: [],
        inertSkipEntries: [],
      }),
    });

    const result = await driver.run(makeCtx({ writer }), {
      key: "d6-all-pills-e2e:showcase-sd-test-slug",
      backendUrl: "https://sd-test.example.com",
      demos: [],
    });

    // When runner total is 0, the reconcile guard is exempt — no false mismatch.
    expect(
      (result.signal as { errorDesc?: string }).errorDesc,
      "R2.3: zero runner total must not trigger mismatch",
    ).toBeUndefined();
    expect(
      result.state,
      "R2.3: zero runner total — normal aggregate produced",
    ).toBe("green");
  });

  // NO-OP invariant: with empty flag file, the existing suite is unaffected
  it("NO-OP: with empty flag file, heuristic path still runs (spec-driven branch not entered)", async () => {
    // Flag file is empty by default (Phase 0). No __overrideSpecDrivenSlugsForTesting call.
    registerD5Script(makeScript(["agentic-chat"]));
    let specDrivenRunnerCalled = false;
    const stubRunner = async () => {
      specDrivenRunnerCalled = true;
      return {
        verdicts: new Map(),
        greenCount: 0,
        cellsFailed: 0,
        skippedCount: 0,
        unknownCells: [],
        redCells: [],
        skipMaskedRed: [],
        inertSkipEntries: [],
      };
    };
    let launcherCalled = 0;
    const driver = createE2eFullDriver({
      launcher: async () => {
        launcherCalled++;
        return makeBrowser();
      },
      scriptLoader: noopScriptLoader(),
      specDrivenRunner: stubRunner,
    });

    const result = await driver.run(makeCtx(), {
      key: "d6-all-pills-e2e:showcase-some-regular-slug",
      backendUrl: "https://regular.example.com",
      features: ["agentic-chat"],
    });

    expect(
      specDrivenRunnerCalled,
      "NO-OP: spec-driven runner must NOT be called",
    ).toBe(false);
    expect(
      launcherCalled,
      "NO-OP: browser launcher must be called (heuristic path ran)",
    ).toBeGreaterThan(0);
    expect(
      result.state,
      "NO-OP: heuristic result must be green with fake browser",
    ).toBe("green");
  });

  // ── H1: External drain abort must NOT produce green aggregate ─────────────
  //
  // RED proof: before fix, an external ctx.abortSignal (drain/redeploy) caused
  // sdAbort to fire, the runner returned partial all-green verdicts, and those
  // flowed through to a GREEN aggregate. The sdTimedOut guard only fired for
  // the INTERNAL wall-clock timer, so a drain abort bypassed it entirely.
  //
  // GREEN (post-fix): when ctx.abortSignal fires and sdTimedOut is false, the
  // spec-driven branch detects `sdExternalDrained` and emits a red "drain"
  // aggregate regardless of the runner's returned verdicts.
  it("H1: external abort (drain) fires → aggregate is NOT green, errorDesc='drain'", async () => {
    // RED before fix: the external signal fires, runner returns all-GREEN,
    // aggregate was green. After fix: aggregate must be red with errorDesc="drain".
    __overrideSpecDrivenSlugsForTesting(["sd-drain-slug"]);
    const { emitted, writer } = captureWriter();

    // Runner that waits for the external abort signal, then returns all-green.
    // This simulates: drain fires → runner partially completes → returns green.
    const { runner } = makeRunner(new Map([["agentic-chat", "GREEN"]]));
    const externalAbort = new AbortController();

    const driver = createE2eFullDriver({
      scriptLoader: noopScriptLoader(),
      specDrivenRunner: async (slug, opts) => {
        // Wait for the abort to fire (the drain), then return green verdicts.
        await new Promise<void>((resolve) => {
          if (opts.signal?.aborted) {
            resolve();
            return;
          }
          opts.signal?.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
        return runner(slug, opts);
      },
    });

    // Fire the external abort AFTER the driver starts (to simulate a real drain).
    setTimeout(() => externalAbort.abort(), 10);

    const result = await driver.run(
      makeCtx({ writer, abortSignal: externalAbort.signal }),
      {
        key: "d6-all-pills-e2e:showcase-sd-drain-slug",
        backendUrl: "https://sd-drain.example.com",
        demos: [],
        // Large wall-clock cap so the INTERNAL timer does NOT fire first.
        timeout_ms: 60_000,
      },
    );

    // H1: aggregate must NOT be green when the external signal fired.
    expect(
      result.state,
      "H1: external drain abort must produce non-green aggregate",
    ).not.toBe("green");
    expect(
      (result.signal as { errorDesc?: string }).errorDesc,
      "H1: errorDesc must be 'drain'",
    ).toBe("drain");
    // The emitted aggregate row must also be non-green.
    const aggRow = emitted.find((r) => r.key === "d6:sd-drain-slug");
    expect(aggRow, "H1: aggregate row must be emitted").toBeDefined();
    expect(
      aggRow!.state,
      "H1: emitted aggregate row must not be green",
    ).not.toBe("green");
  }, 10_000);

  it("H1 (contrast): internal wall-clock timeout with NO external abort → uses 'timeout' errorDesc (not 'drain')", async () => {
    // When only the internal wall-clock fires (ctx.abortSignal never aborted),
    // sdTimedOut=true takes the existing R2.1 path with errorDesc='timeout',
    // not the new H1 drain path. This pins the two paths are mutually exclusive.
    __overrideSpecDrivenSlugsForTesting(["sd-timeout-only-slug"]);
    const { emitted, writer } = captureWriter();

    const { runner } = makeRunner(new Map([["agentic-chat", "GREEN"]]));

    const driver = createE2eFullDriver({
      scriptLoader: noopScriptLoader(),
      specDrivenRunner: async (slug, opts) => {
        // Hang until the internal timer fires.
        await new Promise<void>((resolve) => {
          if (opts.signal?.aborted) {
            resolve();
            return;
          }
          opts.signal?.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
        return runner(slug, opts);
      },
      timeoutMs: 10, // very short internal cap
    });

    // External signal exists but NEVER fires.
    const externalAbort = new AbortController();

    const result = await driver.run(
      makeCtx({ writer, abortSignal: externalAbort.signal }),
      {
        key: "d6-all-pills-e2e:showcase-sd-timeout-only-slug",
        backendUrl: "https://sd-timeout-only.example.com",
        demos: [],
        // timeout_ms omitted — uses construction-time timeoutMs: 10
      },
    );

    expect(result.state, "contrast: timeout-only must still be red").toBe(
      "red",
    );
    expect(
      (result.signal as { errorDesc?: string }).errorDesc,
      "contrast: internal timeout must use errorDesc='timeout', not 'drain'",
    ).toBe("timeout");
    const aggRow = emitted.find((r) => r.key === "d6:sd-timeout-only-slug");
    expect(aggRow?.state, "contrast: emitted aggregate must be red").toBe(
      "red",
    );
  }, 10_000);

  // ── R3: Per-category count mismatch → fail-closed red ─────────────────────
  //
  // RED proof: before fix, the reconcile only compared totals. A runner that
  // returns 1 GREEN verdict but claims greenCount=0, failedCount=1 (same total
  // of 1) would NOT trigger the mismatch check and would produce a GREEN
  // aggregate — a false green for a silently misclassified cell.
  //
  // GREEN (post-fix): per-category comparison catches any category-level drift
  // even when totals agree.
  it("R3: per-category mismatch (same total, different categories) → fail-closed red", async () => {
    // Runner returns 1 GREEN verdict but claims greenCount=0, failedCount=1.
    // Pre-fix: total matches (1===1) → no mismatch → GREEN (false green!).
    // Post-fix: per-category: greenCount(0) !== reduced green(1) → mismatch → RED.
    __overrideSpecDrivenSlugsForTesting(["sd-cat-mismatch-slug"]);
    const { emitted, writer } = captureWriter();

    const driver = createE2eFullDriver({
      scriptLoader: noopScriptLoader(),
      specDrivenRunner: async () => ({
        verdicts: new Map([["agentic-chat", "GREEN"]]) as Map<
          import("../helpers/d5-registry.js").D5FeatureType,
          CellVerdict
        >,
        // Category-level drift: runner says 0 green, 1 failed, but verdict says 1 green.
        greenCount: 0,
        cellsFailed: 1,
        skippedCount: 0,
        unknownCells: [],
        redCells: [],
        skipMaskedRed: [],
        inertSkipEntries: [],
      }),
    });

    const result = await driver.run(makeCtx({ writer }), {
      key: "d6-all-pills-e2e:showcase-sd-cat-mismatch-slug",
      backendUrl: "https://sd-cat-mismatch.example.com",
      demos: [],
    });

    // R3: must be fail-closed red (NOT green)
    expect(
      result.state,
      "R3: per-category mismatch must force fail-closed red (not green)",
    ).toBe("red");
    expect(
      (result.signal as { errorDesc?: string }).errorDesc,
      "R3: errorDesc must be spec-driven-count-mismatch",
    ).toBe("spec-driven-count-mismatch");
    const aggRow = emitted.find((r) => r.key === "d6:sd-cat-mismatch-slug");
    expect(aggRow?.state, "R3: emitted aggregate must be red").toBe("red");
  });

  it("R3: skipped-category mismatch (runner inflates skippedCount) → fail-closed red", async () => {
    // Runner returns 1 GREEN verdict but claims skippedCount=1 (total mismatch).
    // This also exercises a total-level mismatch, but the category check fires
    // first — asserting the right error message.
    __overrideSpecDrivenSlugsForTesting(["sd-skip-mismatch-slug"]);
    const { emitted, writer } = captureWriter();

    const driver = createE2eFullDriver({
      scriptLoader: noopScriptLoader(),
      specDrivenRunner: async () => ({
        verdicts: new Map([["agentic-chat", "GREEN"]]) as Map<
          import("../helpers/d5-registry.js").D5FeatureType,
          CellVerdict
        >,
        greenCount: 1,
        cellsFailed: 0,
        skippedCount: 1, // inflated: verdict says 0 skipped
        unknownCells: [],
        redCells: [],
        skipMaskedRed: [],
        inertSkipEntries: [],
      }),
    });

    const result = await driver.run(makeCtx({ writer }), {
      key: "d6-all-pills-e2e:showcase-sd-skip-mismatch-slug",
      backendUrl: "https://sd-skip-mismatch.example.com",
      demos: [],
    });

    expect(result.state, "R3: skipped-category mismatch must force red").toBe(
      "red",
    );
    expect((result.signal as { errorDesc?: string }).errorDesc).toBe(
      "spec-driven-count-mismatch",
    );
    const aggRow = emitted.find((r) => r.key === "d6:sd-skip-mismatch-slug");
    expect(aggRow?.state).toBe("red");
  });

  // ── Sum invariant assertions on timeout and mismatch exits ────────────────
  //
  // passed + failed.length + skipped.length must === total on every exit.
  // R5-K2 fix: the timeout exit now carries actual known counts from the
  // partial verdict map (total = completedCount, passed/failed[]/skipped[]
  // derived from sdResult.verdicts). Before fix, total was hard-coded 0.
  // The mismatch exit emitted total:sdRunnerTotal (runner's count) but used
  // verdict-reduction counts for passed/failed/skipped — sum might not match
  // total (violated when runner dropped cells).

  it("SUM-INV: timeout exit satisfies passed+failed+skipped===total AND total is machine-readable", async () => {
    // Verify the sum invariant on the timeout exit path and that total reflects
    // the actual number of cells (completed + sentinel for un-run cells).
    //
    // R5-K2 RED proof: before fix, total was 0 regardless of how many verdicts
    // the runner returned. The sum invariant technically held (0+0+0===0) but
    // the total was machine-unreadable (completedCount was buried in the note).
    // GREEN (post-fix, R5-K2): total reflects known cells (machine-readable), sum holds.
    //
    // R7-M1 adjustment: when all completed cells are GREEN, the R7-M1 fix injects
    // a "<unrun-by-timeout>" sentinel into failed[] and increments total by 1.
    // So total = completedCount (1) + 1 sentinel = 2. The INTENT of this test
    // (total is machine-readable, not 0) is preserved — the exact value reflects
    // the R7-M1 guarantee that failed[] is non-empty on every red exit.
    __overrideSpecDrivenSlugsForTesting(["sd-sum-timeout-slug"]);
    const { emitted, writer } = captureWriter();

    const driver = createE2eFullDriver({
      scriptLoader: noopScriptLoader(),
      specDrivenRunner: async (_slug, opts) => {
        // Hang until the internal abort fires, then return non-empty verdicts.
        await new Promise<void>((resolve) => {
          if (opts.signal?.aborted) {
            resolve();
            return;
          }
          opts.signal?.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
        return {
          verdicts: new Map([["agentic-chat", "GREEN"]]) as Map<
            import("../helpers/d5-registry.js").D5FeatureType,
            CellVerdict
          >,
          greenCount: 1,
          cellsFailed: 0,
          skippedCount: 0,
          unknownCells: [],
          redCells: [],
          skipMaskedRed: [],
          inertSkipEntries: [],
        };
      },
      timeoutMs: 10,
    });

    const result = await driver.run(makeCtx({ writer }), {
      key: "d6-all-pills-e2e:showcase-sd-sum-timeout-slug",
      backendUrl: "https://sd-sum-timeout.example.com",
      demos: [],
    });

    // Verify the aggregate is red (timeout)
    expect(result.state).toBe("red");
    expect((result.signal as { errorDesc?: string }).errorDesc).toBe("timeout");

    // R5-K2 + R7-M1: total must be machine-readable (not 0).
    // With 1 completed GREEN + 1 "<unrun-by-timeout>" sentinel → total = 2.
    expect(
      result.signal.total,
      "SUM-INV timeout: total must be machine-readable (completedCount + sentinel), not 0",
    ).toBe(2);

    // SUM INVARIANT: passed + failed.length + skipped.length === total
    const { total, passed, failed, skipped } = result.signal;
    expect(
      passed + failed.length + skipped.length,
      `SUM-INV timeout: passed(${passed})+failed(${failed.length})+skipped(${skipped.length}) must === total(${total})`,
    ).toBe(total);

    // Same check on the emitted aggregate row
    const aggRow = emitted.find((r) => r.key === "d6:sd-sum-timeout-slug");
    expect(aggRow).toBeDefined();
    const sig = aggRow!.signal as E2eFullAggregateSignal;
    expect(
      sig.total,
      "SUM-INV timeout emitted: total must be machine-readable (completedCount + sentinel = 2)",
    ).toBe(2);
    expect(
      sig.passed + sig.failed.length + sig.skipped.length,
      `SUM-INV timeout emitted: sum must === total(${sig.total})`,
    ).toBe(sig.total);
  }, 10_000);

  it("SUM-INV: count-mismatch exit satisfies passed+failed+skipped===total", async () => {
    // Verify the sum invariant on the count-mismatch exit path.
    // Runner drops 2 cells silently (total 3 claimed, but only 1 verdict).
    __overrideSpecDrivenSlugsForTesting(["sd-sum-mismatch-slug"]);
    const { emitted, writer } = captureWriter();

    const driver = createE2eFullDriver({
      scriptLoader: noopScriptLoader(),
      specDrivenRunner: async () => ({
        verdicts: new Map([["agentic-chat", "GREEN"]]) as Map<
          import("../helpers/d5-registry.js").D5FeatureType,
          CellVerdict
        >,
        greenCount: 3, // claims 3 green but only 1 verdict
        cellsFailed: 0,
        skippedCount: 0,
        unknownCells: [],
        redCells: [],
        skipMaskedRed: [],
        inertSkipEntries: [],
      }),
    });

    const result = await driver.run(makeCtx({ writer }), {
      key: "d6-all-pills-e2e:showcase-sd-sum-mismatch-slug",
      backendUrl: "https://sd-sum-mismatch.example.com",
      demos: [],
    });

    expect(result.state).toBe("red");
    expect((result.signal as { errorDesc?: string }).errorDesc).toBe(
      "spec-driven-count-mismatch",
    );

    // SUM INVARIANT: passed + failed.length + skipped.length === total
    const { total, passed, failed, skipped } = result.signal;
    expect(
      passed + failed.length + skipped.length,
      `SUM-INV mismatch: passed(${passed})+failed(${failed.length})+skipped(${skipped.length}) must === total(${total})`,
    ).toBe(total);

    // Same check on the emitted aggregate row
    const aggRow = emitted.find((r) => r.key === "d6:sd-sum-mismatch-slug");
    expect(aggRow).toBeDefined();
    const sig = aggRow!.signal as E2eFullAggregateSignal;
    expect(
      sig.passed + sig.failed.length + sig.skipped.length,
      `SUM-INV mismatch emitted: sum must === total(${sig.total})`,
    ).toBe(sig.total);
  });

  // ── J2-fix-1: spec-driven aggregates populate incapable[] for NSF-SKIPPED ──
  //
  // RED proof: before fix, when the runner returns SKIPPED verdicts for cells
  // whose featureType is in input.notSupportedFeatures, the normal aggregate
  // path does NOT set incapable[]. The heuristic path (~line 1985-88) does.
  // After fix, the spec-driven normal path mirrors the heuristic: cells in
  // sdSkipped whose key is in the NSF set appear in incapable[].
  it("J2-fix-1 (RED before fix): spec-driven SKIPPED verdicts for NSF features populate incapable[]", async () => {
    __overrideSpecDrivenSlugsForTesting(["sd-nsf-slug"]);
    const { emitted, writer } = captureWriter();

    // Runner returns one GREEN and one SKIPPED (the NSF feature).
    const { runner } = makeRunner(
      new Map([
        ["agentic-chat", "GREEN"],
        ["gen-ui-interrupt", "SKIPPED"],
      ]),
    );

    const driver = createE2eFullDriver({
      scriptLoader: noopScriptLoader(),
      specDrivenRunner: runner,
    });

    const result = await driver.run(makeCtx({ writer }), {
      key: "d6-all-pills-e2e:showcase-sd-nsf-slug",
      backendUrl: "https://sd-nsf.example.com",
      demos: [],
      notSupportedFeatures: ["gen-ui-interrupt"],
    });

    // State must be green (only one failure-class: NSF skip is not a failure).
    expect(
      result.state,
      "J2-fix-1: aggregate must be green (SKIPPED is not red)",
    ).toBe("green");

    // incapable[] must be populated with the NSF feature.
    expect(
      result.signal.incapable,
      "J2-fix-1: incapable[] must contain the NSF SKIPPED cell",
    ).toEqual(["gen-ui-interrupt"]);

    // skipped[] must contain the NSF feature (incapable is a subset of skipped).
    expect(
      result.signal.skipped,
      "J2-fix-1: skipped[] must contain the NSF SKIPPED cell",
    ).toContain("gen-ui-interrupt");

    // incapable[] must NOT contain the GREEN cell.
    expect(
      result.signal.incapable,
      "J2-fix-1: incapable[] must not contain GREEN cells",
    ).not.toContain("agentic-chat");

    // Emitted aggregate row must also carry incapable[].
    const aggRow = emitted.find((r) => r.key === "d6:sd-nsf-slug");
    expect(aggRow, "J2-fix-1: aggregate row must be emitted").toBeDefined();
    expect(
      (aggRow!.signal as E2eFullAggregateSignal).incapable,
      "J2-fix-1: emitted aggregate must carry incapable[]",
    ).toEqual(["gen-ui-interrupt"]);
  });

  it("J2-fix-1 (contrast): SKIPPED cells NOT in notSupportedFeatures do NOT appear in incapable[]", async () => {
    __overrideSpecDrivenSlugsForTesting(["sd-nsf-contrast-slug"]);
    const { writer } = captureWriter();

    // Runner returns SKIPPED for a cell that is NOT in notSupportedFeatures
    // (e.g. an operational skip decided by the runner's own skip-list).
    const { runner } = makeRunner(
      new Map([
        ["agentic-chat", "GREEN"],
        ["gen-ui-interrupt", "SKIPPED"],
      ]),
    );

    const driver = createE2eFullDriver({
      scriptLoader: noopScriptLoader(),
      specDrivenRunner: runner,
    });

    const result = await driver.run(makeCtx({ writer }), {
      key: "d6-all-pills-e2e:showcase-sd-nsf-contrast-slug",
      backendUrl: "https://sd-nsf-contrast.example.com",
      demos: [],
      // notSupportedFeatures omitted — SKIPPED is an operational skip
    });

    // incapable[] must be absent (no NSF context).
    expect(
      result.signal.incapable,
      "J2-fix-1 contrast: incapable[] must be absent when notSupportedFeatures not set",
    ).toBeUndefined();

    // skipped[] still contains the SKIPPED cell (operational skip is fine).
    expect(result.signal.skipped).toContain("gen-ui-interrupt");
  });

  // ── J2-fix-2: empty-verdict red exit satisfies sum invariant + errorDesc ───
  //
  // RED proof (sum invariant): before fix, when verdicts.size===0 but
  // runner counters are non-zero (e.g. greenCount=1, failedCount=1,
  // skippedCount=1 → total=3), the aggregate has total=3, passed=0,
  // failed=[], skipped=[] — sum is 0 ≠ total (violated).
  // After fix: failed[] is populated so that passed + failed.length +
  // skipped.length === total.
  //
  // RED proof (errorDesc): before fix, the emptyAggregate has no errorDesc
  // field. Sibling exits (import-error, runner-error, timeout, drain,
  // mismatch) all stamp a greppable errorDesc. After fix: errorDesc is set
  // to "spec-driven-empty-verdicts".
  it("J2-fix-2 (RED before fix, sum invariant): empty-verdict exit with non-zero total satisfies passed+failed+skipped===total", async () => {
    __overrideSpecDrivenSlugsForTesting(["sd-empty-inv-slug"]);
    const { emitted, writer } = captureWriter();

    // Runner returns empty verdicts but non-zero counters (e.g. all cells
    // were filtered out at the runner level before verdict assignment).
    const driver = createE2eFullDriver({
      scriptLoader: noopScriptLoader(),
      specDrivenRunner: async () => ({
        verdicts: new Map(),
        greenCount: 1,
        cellsFailed: 1,
        skippedCount: 1, // total = 3
        unknownCells: [],
        redCells: [],
        skipMaskedRed: [],
        inertSkipEntries: [],
      }),
    });

    const result = await driver.run(makeCtx({ writer }), {
      key: "d6-all-pills-e2e:showcase-sd-empty-inv-slug",
      backendUrl: "https://sd-empty-inv.example.com",
      demos: [],
    });

    // State must remain red (empty verdicts → UNKNOWN → red).
    expect(result.state, "J2-fix-2: empty-verdict exit must be red").toBe(
      "red",
    );

    // SUM INVARIANT: passed + failed.length + skipped.length must === total.
    const { total, passed, failed, skipped } = result.signal;
    expect(
      passed + failed.length + skipped.length,
      `J2-fix-2 SUM-INV: sum(${passed}+${failed.length}+${skipped.length}) must === total(${total})`,
    ).toBe(total);

    // Emitted row must also satisfy the invariant.
    const aggRow = emitted.find((r) => r.key === "d6:sd-empty-inv-slug");
    expect(aggRow, "J2-fix-2: aggregate row must be emitted").toBeDefined();
    const sig = aggRow!.signal as E2eFullAggregateSignal;
    expect(
      sig.passed + sig.failed.length + sig.skipped.length,
      `J2-fix-2 SUM-INV emitted: sum must === total(${sig.total})`,
    ).toBe(sig.total);
  });

  it("J2-fix-2 (RED before fix, errorDesc): empty-verdict exit stamps greppable errorDesc='spec-driven-empty-verdicts'", async () => {
    __overrideSpecDrivenSlugsForTesting(["sd-empty-desc-slug"]);
    const { emitted, writer } = captureWriter();

    const driver = createE2eFullDriver({
      scriptLoader: noopScriptLoader(),
      specDrivenRunner: async () => ({
        verdicts: new Map(),
        greenCount: 0,
        cellsFailed: 0,
        skippedCount: 0,
        unknownCells: [],
        redCells: [],
        skipMaskedRed: [],
        inertSkipEntries: [],
      }),
    });

    const result = await driver.run(makeCtx({ writer }), {
      key: "d6-all-pills-e2e:showcase-sd-empty-desc-slug",
      backendUrl: "https://sd-empty-desc.example.com",
      demos: [],
    });

    // errorDesc must be stamped so log-scrapers can grep it.
    expect(
      (result.signal as { errorDesc?: string }).errorDesc,
      "J2-fix-2: empty-verdict exit must stamp errorDesc='spec-driven-empty-verdicts'",
    ).toBe("spec-driven-empty-verdicts");

    // Emitted row must carry the same errorDesc.
    const aggRow = emitted.find((r) => r.key === "d6:sd-empty-desc-slug");
    expect(aggRow, "J2-fix-2: aggregate row must be emitted").toBeDefined();
    expect(
      (aggRow!.signal as { errorDesc?: string }).errorDesc,
      "J2-fix-2: emitted aggregate must carry errorDesc='spec-driven-empty-verdicts'",
    ).toBe("spec-driven-empty-verdicts");
  });

  // ── L-C: incapable[] consistency across ALL spec-driven exits ────────────
  //
  // RED proof: before this fix, the timeout / drain / empty-verdict /
  // count-mismatch exits omit incapable[] even when NSF cells appear in
  // skipped[], breaking the "incapable ⊆ skipped" contract on interrupted
  // runs. Only the normal exit (J2-fix-1) populated it.
  //
  // GREEN (post-fix): computeSdIncapable() is called at every spec-driven
  // exit that carries skipped[], so incapable[] is populated whenever a
  // skipped cell is also in notSupportedFeatures.

  it("L-C timeout exit: incapable[] populated when NSF cell is in partial SKIPPED verdicts", async () => {
    __overrideSpecDrivenSlugsForTesting(["sd-lc-timeout-slug"]);
    const { emitted, writer } = captureWriter();

    let resolveRunner!: () => void;
    const runnerGate = new Promise<void>((r) => {
      resolveRunner = r;
    });

    // Runner returns one SKIPPED verdict (the NSF cell) after the abort fires.
    const driver = createE2eFullDriver({
      scriptLoader: noopScriptLoader(),
      specDrivenRunner: async (_slug, opts) => {
        // Wait for the internal wall-clock abort, then return partial verdicts.
        await new Promise<void>((resolve) => {
          if (opts.signal?.aborted) {
            resolve();
            return;
          }
          opts.signal?.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
        resolveRunner();
        return {
          verdicts: new Map([["gen-ui-interrupt", "SKIPPED"]]) as Map<
            import("../helpers/d5-registry.js").D5FeatureType,
            CellVerdict
          >,
          greenCount: 0,
          cellsFailed: 0,
          skippedCount: 1,
          unknownCells: [],
          redCells: [],
          skipMaskedRed: [],
          inertSkipEntries: [],
        };
      },
      timeoutMs: 10, // fires quickly in test
    });

    const result = await driver.run(makeCtx({ writer }), {
      key: "d6-all-pills-e2e:showcase-sd-lc-timeout-slug",
      backendUrl: "https://sd-lc-timeout.example.com",
      demos: [],
      notSupportedFeatures: ["gen-ui-interrupt"],
    });

    await runnerGate;

    // Timeout path must be red.
    expect(result.state, "L-C timeout: aggregate must be red").toBe("red");
    expect(
      (result.signal as { errorDesc?: string }).errorDesc,
      "L-C timeout: errorDesc must be 'timeout'",
    ).toBe("timeout");

    // incapable[] must be populated from the SKIPPED∩NSF intersection.
    expect(
      result.signal.incapable,
      "L-C timeout: incapable[] must contain NSF SKIPPED cell",
    ).toEqual(["gen-ui-interrupt"]);

    // skipped[] must contain the SKIPPED cell (incapable ⊆ skipped).
    expect(
      result.signal.skipped,
      "L-C timeout: skipped[] must contain NSF SKIPPED cell",
    ).toContain("gen-ui-interrupt");

    // Emitted aggregate must also carry incapable[].
    const aggRow = emitted.find((r) => r.key === "d6:sd-lc-timeout-slug");
    expect(aggRow, "L-C timeout: aggregate row must be emitted").toBeDefined();
    expect(
      (aggRow!.signal as E2eFullAggregateSignal).incapable,
      "L-C timeout: emitted aggregate must carry incapable[]",
    ).toEqual(["gen-ui-interrupt"]);
  }, 10_000);

  it("L-C drain exit: incapable[] populated when NSF cell is in partial SKIPPED verdicts", async () => {
    __overrideSpecDrivenSlugsForTesting(["sd-lc-drain-slug"]);
    const { emitted, writer } = captureWriter();

    const externalAbort = new AbortController();

    // Runner returns one SKIPPED verdict (the NSF cell) after the external abort fires.
    const driver = createE2eFullDriver({
      scriptLoader: noopScriptLoader(),
      specDrivenRunner: async (_slug, opts) => {
        await new Promise<void>((resolve) => {
          if (opts.signal?.aborted) {
            resolve();
            return;
          }
          opts.signal?.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
        return {
          verdicts: new Map([["gen-ui-interrupt", "SKIPPED"]]) as Map<
            import("../helpers/d5-registry.js").D5FeatureType,
            CellVerdict
          >,
          greenCount: 0,
          cellsFailed: 0,
          skippedCount: 1,
          unknownCells: [],
          redCells: [],
          skipMaskedRed: [],
          inertSkipEntries: [],
        };
      },
    });

    // Fire external drain after a short delay.
    setTimeout(() => externalAbort.abort(), 10);

    const result = await driver.run(
      makeCtx({ writer, abortSignal: externalAbort.signal }),
      {
        key: "d6-all-pills-e2e:showcase-sd-lc-drain-slug",
        backendUrl: "https://sd-lc-drain.example.com",
        demos: [],
        notSupportedFeatures: ["gen-ui-interrupt"],
        timeout_ms: 60_000, // internal timer must NOT fire
      },
    );

    // Drain path must be red.
    expect(result.state, "L-C drain: aggregate must be red").toBe("red");
    expect(
      (result.signal as { errorDesc?: string }).errorDesc,
      "L-C drain: errorDesc must be 'drain'",
    ).toBe("drain");

    // incapable[] must be populated from the SKIPPED∩NSF intersection.
    expect(
      result.signal.incapable,
      "L-C drain: incapable[] must contain NSF SKIPPED cell",
    ).toEqual(["gen-ui-interrupt"]);

    // skipped[] must contain the SKIPPED cell.
    expect(
      result.signal.skipped,
      "L-C drain: skipped[] must contain NSF SKIPPED cell",
    ).toContain("gen-ui-interrupt");

    // Emitted aggregate must also carry incapable[].
    const aggRow = emitted.find((r) => r.key === "d6:sd-lc-drain-slug");
    expect(aggRow, "L-C drain: aggregate row must be emitted").toBeDefined();
    expect(
      (aggRow!.signal as E2eFullAggregateSignal).incapable,
      "L-C drain: emitted aggregate must carry incapable[]",
    ).toEqual(["gen-ui-interrupt"]);
  }, 10_000);

  it("L-C empty-verdict exit: incapable[] absent (no skipped[] cells to intersect)", async () => {
    // The empty-verdict exit uses skipped: [] by construction (no verdicts
    // means no SKIPPED cells). Even with notSupportedFeatures set, the
    // intersection is empty → incapable must be undefined (not []).
    __overrideSpecDrivenSlugsForTesting(["sd-lc-empty-slug"]);
    const { writer } = captureWriter();

    const driver = createE2eFullDriver({
      scriptLoader: noopScriptLoader(),
      specDrivenRunner: async () => ({
        verdicts: new Map(),
        greenCount: 0,
        cellsFailed: 0,
        skippedCount: 0,
        unknownCells: [],
        redCells: [],
        skipMaskedRed: [],
        inertSkipEntries: [],
      }),
    });

    const result = await driver.run(makeCtx({ writer }), {
      key: "d6-all-pills-e2e:showcase-sd-lc-empty-slug",
      backendUrl: "https://sd-lc-empty.example.com",
      demos: [],
      notSupportedFeatures: ["gen-ui-interrupt"],
    });

    // Empty-verdict is red.
    expect(result.state, "L-C empty-verdict: aggregate must be red").toBe(
      "red",
    );
    expect(
      (result.signal as { errorDesc?: string }).errorDesc,
      "L-C empty-verdict: errorDesc must be 'spec-driven-empty-verdicts'",
    ).toBe("spec-driven-empty-verdicts");

    // With no verdicts there are no SKIPPED cells, so incapable must be absent.
    expect(
      result.signal.incapable,
      "L-C empty-verdict: incapable[] must be absent when skipped[] is empty",
    ).toBeUndefined();
  });

  it("L-C count-mismatch exit: incapable[] populated when NSF cell is in skipped[] at mismatch", async () => {
    __overrideSpecDrivenSlugsForTesting(["sd-lc-mismatch-slug"]);
    const { emitted, writer } = captureWriter();

    // Runner returns one SKIPPED verdict for an NSF cell but claims
    // greenCount=1 (category mismatch) — triggers the count-mismatch exit.
    const driver = createE2eFullDriver({
      scriptLoader: noopScriptLoader(),
      specDrivenRunner: async () => ({
        verdicts: new Map([["gen-ui-interrupt", "SKIPPED"]]) as Map<
          import("../helpers/d5-registry.js").D5FeatureType,
          CellVerdict
        >,
        greenCount: 1, // claims 1 green — disagrees (verdict is SKIPPED, not GREEN)
        cellsFailed: 0,
        skippedCount: 0, // claims 0 skipped — disagrees (verdict is SKIPPED)
        unknownCells: [],
        redCells: [],
        skipMaskedRed: [],
        inertSkipEntries: [],
      }),
    });

    const result = await driver.run(makeCtx({ writer }), {
      key: "d6-all-pills-e2e:showcase-sd-lc-mismatch-slug",
      backendUrl: "https://sd-lc-mismatch.example.com",
      demos: [],
      notSupportedFeatures: ["gen-ui-interrupt"],
    });

    // Count-mismatch path must be red (fail-closed).
    expect(result.state, "L-C mismatch: aggregate must be red").toBe("red");
    expect(
      (result.signal as { errorDesc?: string }).errorDesc,
      "L-C mismatch: errorDesc must be 'spec-driven-count-mismatch'",
    ).toBe("spec-driven-count-mismatch");

    // The verdict reduction puts gen-ui-interrupt in skipped[]. With NSF set,
    // incapable[] must reflect the intersection.
    expect(
      result.signal.incapable,
      "L-C mismatch: incapable[] must contain NSF SKIPPED cell from verdict reduction",
    ).toEqual(["gen-ui-interrupt"]);

    // skipped[] must also contain the cell.
    expect(
      result.signal.skipped,
      "L-C mismatch: skipped[] must contain NSF SKIPPED cell",
    ).toContain("gen-ui-interrupt");

    // Emitted aggregate must also carry incapable[].
    const aggRow = emitted.find((r) => r.key === "d6:sd-lc-mismatch-slug");
    expect(aggRow, "L-C mismatch: aggregate row must be emitted").toBeDefined();
    expect(
      (aggRow!.signal as E2eFullAggregateSignal).incapable,
      "L-C mismatch: emitted aggregate must carry incapable[]",
    ).toEqual(["gen-ui-interrupt"]);
  });

  // ── R5-K1: driver↔runner result contract — NaN-disabled guard proof ─────
  //
  // RED (before fix): the driver dep type declared `failedCount` but
  // `RunSpecDrivenD6Result` uses `cellsFailed`.  On the production
  // dynamic-import path `sdResult.failedCount` was undefined, so
  //   sdRunnerTotal = greenCount + undefined + skippedCount → NaN
  //   sdRunnerTotal > 0  → false  → reconcile guard SILENTLY DISABLED.
  // A runner that claims greenCount=0,cellsFailed=1 but returns a GREEN
  // verdict would have produced a false-GREEN aggregate.
  //
  // GREEN (after fix): driver reads `cellsFailed`, sdRunnerTotal is
  // finite, sdRunnerTotal > 0 is true, per-category mismatch fires,
  // aggregate is red (fail-closed).
  it("R5-K1 (GREEN post-fix): reconcile guard fires when runner cellsFailed disagrees with reduction — NaN-disabled guard is gone", async () => {
    __overrideSpecDrivenSlugsForTesting(["sd-r5k1-slug"]);
    const { emitted, writer } = captureWriter();

    // Runner returns ONE GREEN verdict but claims cellsFailed=1 (category drift).
    // Pre-fix: sdResult.failedCount was undefined → sdRunnerTotal=NaN → guard
    //          disabled → aggregate would be GREEN (false positive).
    // Post-fix: sdResult.cellsFailed=1 → sdRunnerTotal=2 > 0 → per-category
    //           check: runner says 0 green but reduction says 1 green → mismatch
    //           → aggregate is RED (fail-closed, correct).
    const driver = createE2eFullDriver({
      scriptLoader: noopScriptLoader(),
      specDrivenRunner: async () => ({
        verdicts: new Map([["agentic-chat", "GREEN"]]) as Map<
          import("../helpers/d5-registry.js").D5FeatureType,
          CellVerdict
        >,
        greenCount: 0, // claims 0 green — disagrees with verdict (1 green)
        cellsFailed: 1, // claims 1 failed — disagrees with verdict (0 failed)
        skippedCount: 0,
        unknownCells: [],
        redCells: [],
        skipMaskedRed: [],
        inertSkipEntries: [],
      }),
    });

    const result = await driver.run(makeCtx({ writer }), {
      key: "d6-all-pills-e2e:showcase-sd-r5k1-slug",
      backendUrl: "https://sd-r5k1.example.com",
      demos: [],
    });

    // Must be RED (mismatch detected) — NOT green.
    // Pre-fix this was green because sdRunnerTotal was NaN (guard disabled).
    expect(
      result.state,
      "R5-K1: reconcile guard must fire → red (not NaN-disabled green)",
    ).toBe("red");
    expect(
      (result.signal as { errorDesc?: string }).errorDesc,
      "R5-K1: errorDesc must be spec-driven-count-mismatch",
    ).toBe("spec-driven-count-mismatch");

    // Also verify derivedTotal in the empty-verdicts path is finite (not NaN):
    // a separate driver invocation with verdicts.size===0 must produce finite total.
    const { emitted: emitted2, writer: writer2 } = captureWriter();
    const driver2 = createE2eFullDriver({
      scriptLoader: noopScriptLoader(),
      specDrivenRunner: async () => ({
        verdicts: new Map() as Map<
          import("../helpers/d5-registry.js").D5FeatureType,
          CellVerdict
        >,
        greenCount: 2,
        cellsFailed: 1, // pre-fix: undefined → derivedTotal NaN
        skippedCount: 0,
        unknownCells: [],
        redCells: [],
        skipMaskedRed: [],
        inertSkipEntries: [],
      }),
    });
    const result2 = await driver2.run(makeCtx({ writer: writer2 }), {
      key: "d6-all-pills-e2e:showcase-sd-r5k1-slug",
      backendUrl: "https://sd-r5k1.example.com",
      demos: [],
    });
    const total2 = (result2.signal as { total?: number }).total ?? NaN;
    expect(
      Number.isFinite(total2),
      "R5-K1: empty-verdict derivedTotal must be finite (not NaN)",
    ).toBe(true);
    expect(
      total2,
      "R5-K1: empty-verdict derivedTotal must equal greenCount+cellsFailed+skippedCount=3",
    ).toBe(3);
    expect(
      result2.state,
      "R5-K1: empty-verdict with real counters must be red",
    ).toBe("red");
    void emitted2;
  });

  // ── R7-M1: state/failed[]-same-reduction invariant on timeout + drain exits ──
  //
  // BUG (pre-fix): timeout and drain exits emit `state:"red"` but derive
  // passed/failed[]/skipped[] from the PARTIAL completed verdicts only.
  // When all completed cells are GREEN, the aggregate becomes:
  //   state:red, failed:[], passed===total
  // This violates the R2 mandatory F2+F4 invariant: state=red MUST imply
  // failed.length > 0 (the same reduction that yields state also populates
  // failed[]). Any consumer that checks `failed.length === 0` would see a
  // "passing" run despite the red state — a false-green.
  //
  // FIX: on timeout/drain exits, treat un-run cells as failed. When no real
  // cell names are derivable (the runner returned only partial verdicts),
  // inject a sentinel `"<unrun-by-timeout>"` / `"<unrun-by-drain>"` entry
  // into failed[] and account for it in total, so:
  //   (a) failed[] is non-empty whenever state is red
  //   (b) passed+failed+skipped===total (sum invariant) holds
  //   (c) completed GREEN cells remain in passed (unchanged)
  //   (d) errorDesc "timeout"/"drain" is unchanged

  it("R7-M1 (RED before fix): timeout exit with all-green partial verdicts must have failed[] non-empty", async () => {
    // Runner returns one GREEN verdict for the cell it completed before abort.
    // After timeout: state=red, but pre-fix failed=[] (violates F2+F4).
    __overrideSpecDrivenSlugsForTesting(["sd-r7-timeout-slug"]);
    const { emitted, writer } = captureWriter();

    const driver = createE2eFullDriver({
      scriptLoader: noopScriptLoader(),
      specDrivenRunner: async (_slug, opts) => {
        // Complete one cell as GREEN, then hang until abort (simulating
        // the runner being aborted mid-run with more cells remaining).
        await new Promise<void>((resolve) => {
          if (opts.signal?.aborted) {
            resolve();
            return;
          }
          opts.signal?.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
        return {
          verdicts: new Map([["agentic-chat", "GREEN"]]) as Map<
            import("../helpers/d5-registry.js").D5FeatureType,
            CellVerdict
          >,
          greenCount: 1,
          cellsFailed: 0,
          skippedCount: 0,
          unknownCells: [],
          redCells: [],
          skipMaskedRed: [],
          inertSkipEntries: [],
        };
      },
      timeoutMs: 10,
    });

    const result = await driver.run(makeCtx({ writer }), {
      key: "d6-all-pills-e2e:showcase-sd-r7-timeout-slug",
      backendUrl: "https://sd-r7-timeout.example.com",
      demos: [],
    });

    // State must be red (timeout).
    expect(result.state, "R7-M1 timeout: state must be red").toBe("red");
    expect(
      (result.signal as { errorDesc?: string }).errorDesc,
      "R7-M1 timeout: errorDesc must be 'timeout'",
    ).toBe("timeout");

    // R7-M1 CORE INVARIANT: failed[] must be non-empty when state is red.
    // Pre-fix this was [] because only partial verdicts (1 GREEN) were used.
    expect(
      result.signal.failed.length,
      "R7-M1 timeout: failed[] must be non-empty when state=red (state/failed[]-same-reduction invariant)",
    ).toBeGreaterThan(0);

    // SUM INVARIANT must hold.
    const { total, passed, failed, skipped } = result.signal;
    expect(
      passed + failed.length + skipped.length,
      `R7-M1 timeout: sum invariant must hold: passed(${passed})+failed(${failed.length})+skipped(${skipped.length})===${total}`,
    ).toBe(total);

    // Completed GREEN cell must still be in passed.
    expect(
      result.signal.passed,
      "R7-M1 timeout: completed GREEN cell must remain in passed",
    ).toBe(1);

    // Emitted aggregate row must also satisfy the invariant.
    const aggRow = emitted.find((r) => r.key === "d6:sd-r7-timeout-slug");
    expect(
      aggRow,
      "R7-M1 timeout: aggregate row must be emitted",
    ).toBeDefined();
    const sig = aggRow!.signal as E2eFullAggregateSignal;
    expect(
      sig.failed.length,
      "R7-M1 timeout emitted: failed[] must be non-empty",
    ).toBeGreaterThan(0);
    expect(
      sig.passed + sig.failed.length + sig.skipped.length,
      `R7-M1 timeout emitted: sum invariant must hold`,
    ).toBe(sig.total);
  }, 10_000);

  it("R7-M1 (RED before fix): drain exit with all-green partial verdicts must have failed[] non-empty", async () => {
    // Runner receives an external abort (drain) and returns all-green partial
    // verdicts. Pre-fix: state=red, failed=[] (violates F2+F4).
    __overrideSpecDrivenSlugsForTesting(["sd-r7-drain-slug"]);
    const { emitted, writer } = captureWriter();
    const externalAbortCtrl = new AbortController();

    const driver = createE2eFullDriver({
      scriptLoader: noopScriptLoader(),
      // Use a very long timeout so only the external drain fires.
      timeoutMs: 60_000,
      specDrivenRunner: async (_slug, opts) => {
        // Hang until the external abort fires (simulating drain mid-run).
        await new Promise<void>((resolve) => {
          if (opts.signal?.aborted) {
            resolve();
            return;
          }
          opts.signal?.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
        return {
          verdicts: new Map([["agentic-chat", "GREEN"]]) as Map<
            import("../helpers/d5-registry.js").D5FeatureType,
            CellVerdict
          >,
          greenCount: 1,
          cellsFailed: 0,
          skippedCount: 0,
          unknownCells: [],
          redCells: [],
          skipMaskedRed: [],
          inertSkipEntries: [],
        };
      },
    });

    // Fire the external abort after a short delay (simulating a drain signal).
    const drainTimer = setTimeout(() => externalAbortCtrl.abort(), 20);
    try {
      const result = await driver.run(
        makeCtx({ writer, abortSignal: externalAbortCtrl.signal }),
        {
          key: "d6-all-pills-e2e:showcase-sd-r7-drain-slug",
          backendUrl: "https://sd-r7-drain.example.com",
          demos: [],
        },
      );

      // State must be red (drain).
      expect(result.state, "R7-M1 drain: state must be red").toBe("red");
      expect(
        (result.signal as { errorDesc?: string }).errorDesc,
        "R7-M1 drain: errorDesc must be 'drain'",
      ).toBe("drain");

      // R7-M1 CORE INVARIANT: failed[] must be non-empty when state is red.
      expect(
        result.signal.failed.length,
        "R7-M1 drain: failed[] must be non-empty when state=red (state/failed[]-same-reduction invariant)",
      ).toBeGreaterThan(0);

      // SUM INVARIANT must hold.
      const { total, passed, failed, skipped } = result.signal;
      expect(
        passed + failed.length + skipped.length,
        `R7-M1 drain: sum invariant must hold: passed(${passed})+failed(${failed.length})+skipped(${skipped.length})===${total}`,
      ).toBe(total);

      // Completed GREEN cell must still be in passed.
      expect(
        result.signal.passed,
        "R7-M1 drain: completed GREEN cell must remain in passed",
      ).toBe(1);

      // Emitted aggregate row must also satisfy the invariant.
      const aggRow = emitted.find((r) => r.key === "d6:sd-r7-drain-slug");
      expect(
        aggRow,
        "R7-M1 drain: aggregate row must be emitted",
      ).toBeDefined();
      const sig = aggRow!.signal as E2eFullAggregateSignal;
      expect(
        sig.failed.length,
        "R7-M1 drain emitted: failed[] must be non-empty",
      ).toBeGreaterThan(0);
      expect(
        sig.passed + sig.failed.length + sig.skipped.length,
        "R7-M1 drain emitted: sum invariant must hold",
      ).toBe(sig.total);
    } finally {
      clearTimeout(drainTimer);
    }
  }, 10_000);
});
