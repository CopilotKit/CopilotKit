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
});
