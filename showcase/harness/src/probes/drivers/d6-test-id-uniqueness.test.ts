import { describe, it, expect, beforeEach } from "vitest";
import { buildE2eTestId, createE2eFullDriver } from "./d6-all-pills.js";
import type {
  E2eFullBrowser,
  E2eFullBrowserContext,
  E2eFullPage,
} from "./d6-all-pills.js";
import {
  __clearD5RegistryForTesting,
  registerD5Script,
} from "../helpers/d5-registry.js";
import type { D5Script } from "../helpers/d5-registry.js";
import { logger } from "../../logger.js";
import type { ProbeContext } from "../../types/index.js";

// Per-run-unique X-Test-Id (FIX 1).
//
// ROOT CAUSE this guards against: the X-Test-Id was a per-slug CONSTANT
// (`d6-<slug>`). aimock keys its fixture-match counters by (testId → fixture)
// (router.ts sequenceIndex/turnIndex gates vs `getFixtureMatchCountsForTest`).
// A constant per-slug testId meant consecutive runs of the same slug shared one
// counter, so a second run started mid-sequence and strict-mode 503'd on
// fixtures the first run had already consumed — the staging dashboard
// red↔green flap. Folding the per-`run()` `runId` into the testId
// (`d6-<slug>-<runId>`) gives every run a fresh counter while staying stable
// across the run's feature-cells (so multi-turn sequenced fixtures within one
// cell still align). D5 runs THIS driver (take-one), so it is covered too.

// A counter idFactory so the per-run id is deterministic and assertable
// (mintRunId is crypto.randomUUID — not seedable; the driver exposes
// `idFactory` exactly so tests can inject a deterministic source).
function makeCounterIdFactory(): () => string {
  let n = 0;
  return () => `run${++n}`;
}

function makePage(): E2eFullPage {
  let messageCount = 0;
  return {
    async goto() {},
    async waitForSelector() {},
    async fill() {},
    async press() {
      messageCount++;
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

/**
 * Launcher whose `newContext` records the `X-Test-Id` value of every context
 * opened during a run. The header is set at context construction (before any
 * navigation), so a run need not fully succeed for the assertion to hold.
 */
function makeCapturingBrowser(capture: string[]): E2eFullBrowser {
  return {
    newContext: async (contextOpts?: {
      extraHTTPHeaders?: Record<string, string>;
    }): Promise<E2eFullBrowserContext> => {
      const testId = contextOpts?.extraHTTPHeaders?.["X-Test-Id"];
      if (typeof testId === "string") capture.push(testId);
      return {
        newPage: async () => makePage(),
        close: async () => {},
      };
    },
    close: async () => {},
  };
}

function makeCtx(): ProbeContext {
  return {
    now: () => new Date("2025-01-01T00:00:00Z"),
    logger,
    env: {},
  };
}

function makeScript(featureTypes: string[]): D5Script {
  return {
    featureTypes: featureTypes as D5Script["featureTypes"],
    fixtureFile: "test-fixture.json",
    buildTurns: () => [{ input: "hello" }],
    preNavigateRoute: undefined,
  };
}

describe("d6 per-run-unique X-Test-Id", () => {
  describe("buildE2eTestId (pure helper)", () => {
    it("is prefixed `d6-<slug>-` and folds in the runId", () => {
      expect(buildE2eTestId("langgraph-python", "abc123")).toBe(
        "d6-langgraph-python-abc123",
      );
      expect(buildE2eTestId("langgraph-python", "abc123")).toMatch(
        /^d6-langgraph-python-/,
      );
    });

    it("is stable for one runId and distinct across runIds", () => {
      const a = buildE2eTestId("slug", "run1");
      const b = buildE2eTestId("slug", "run1");
      const c = buildE2eTestId("slug", "run2");
      expect(a).toBe(b);
      expect(a).not.toBe(c);
    });
  });

  describe("driver wiring (injected idFactory)", () => {
    beforeEach(() => {
      __clearD5RegistryForTesting();
    });

    it("emits one stable X-Test-Id across all feature-cells of a run, unique across runs", async () => {
      registerD5Script(makeScript(["agentic-chat"]));
      registerD5Script(makeScript(["tool-rendering"]));

      const idFactory = makeCounterIdFactory();

      const run1Ids: string[] = [];
      const driver1 = createE2eFullDriver({
        launcher: async () => makeCapturingBrowser(run1Ids),
        scriptLoader: async () => {},
        idFactory,
      });
      await driver1.run(makeCtx(), {
        key: "e2e_d6:byoc",
        backendUrl: "https://byoc.example.com",
        features: ["agentic-chat", "tool-rendering"],
      });

      const run2Ids: string[] = [];
      const driver2 = createE2eFullDriver({
        launcher: async () => makeCapturingBrowser(run2Ids),
        scriptLoader: async () => {},
        idFactory,
      });
      await driver2.run(makeCtx(), {
        key: "e2e_d6:byoc",
        backendUrl: "https://byoc.example.com",
        features: ["agentic-chat", "tool-rendering"],
      });

      // Every cell of a single run shares ONE testId (the run's runId).
      expect(run1Ids.length).toBeGreaterThanOrEqual(2);
      expect(new Set(run1Ids).size).toBe(1);
      expect(run2Ids.length).toBeGreaterThanOrEqual(2);
      expect(new Set(run2Ids).size).toBe(1);

      const id1 = run1Ids[0];
      const id2 = run2Ids[0];

      // (a) prefixed `d6-byoc-`
      expect(id1).toMatch(/^d6-byoc-/);
      expect(id2).toMatch(/^d6-byoc-/);
      // (b) DISTINCT across runs (the flap fix)
      expect(id1).not.toBe(id2);
      // matches the injected deterministic counter
      expect(id1).toBe("d6-byoc-run1");
      expect(id2).toBe("d6-byoc-run2");
    });

    // Production runs ONE long-lived driver instance (the singleton
    // `e2eFullDriver`) whose `run()` is invoked repeatedly. The two-driver
    // test above would still pass if the runId mint regressed to
    // `createE2eFullDriver()` construction time (each fresh instance would
    // mint its own id), so this test pins the production shape: the SAME
    // instance must mint a FRESH runId on every `run()` call.
    it("mints a fresh X-Test-Id per run() on a single long-lived driver instance", async () => {
      registerD5Script(makeScript(["agentic-chat"]));
      registerD5Script(makeScript(["tool-rendering"]));

      const allIds: string[] = [];
      const driver = createE2eFullDriver({
        launcher: async () => makeCapturingBrowser(allIds),
        scriptLoader: async () => {},
        idFactory: makeCounterIdFactory(),
      });

      const input = {
        key: "e2e_d6:byoc",
        backendUrl: "https://byoc.example.com",
        features: ["agentic-chat", "tool-rendering"],
      };

      await driver.run(makeCtx(), input);
      const run1Count = allIds.length;
      await driver.run(makeCtx(), input);

      const run1Ids = allIds.slice(0, run1Count);
      const run2Ids = allIds.slice(run1Count);

      // Internally consistent within each run: every cell shares ONE testId.
      expect(run1Ids.length).toBeGreaterThanOrEqual(2);
      expect(new Set(run1Ids).size).toBe(1);
      expect(run2Ids.length).toBeGreaterThanOrEqual(2);
      expect(new Set(run2Ids).size).toBe(1);

      // DISTINCT across the two run() calls of the SAME instance (the flap
      // fix): a construction-time mint would yield "d6-byoc-run1" for BOTH.
      expect(run1Ids[0]).toBe("d6-byoc-run1");
      expect(run2Ids[0]).toBe("d6-byoc-run2");
      expect(run1Ids[0]).not.toBe(run2Ids[0]);
    });
  });
});
