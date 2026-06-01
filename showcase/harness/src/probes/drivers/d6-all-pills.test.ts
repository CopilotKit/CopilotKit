import { describe, it, expect } from "vitest";
import {
  createE2eFullDriver,
  createPooledE2eFullLauncher,
  DEPLOY_CHURN_GRACE_MS,
  e2eFullDriver,
  FEATURE_CONCURRENCY_D6,
  Semaphore,
} from "./d6-all-pills.js";
import type {
  D6RunAndParse,
  E2eFullAggregateSignal,
  E2eFullFeatureSignal,
} from "./d6-all-pills.js";
import { logger } from "../../logger.js";
import type { Browser } from "playwright";
import type { BrowserPool } from "../helpers/browser-pool.js";
import type {
  ProbeContext,
  ProbeResult,
  ProbeResultWriter,
} from "../../types/index.js";
import type { SpecFileResult } from "../helpers/pw-json-reporter.js";
import {
  allMappedSpecFiles,
  mapSpecFileToCell,
} from "../helpers/spec-cell-mapping.js";

// ---------------------------------------------------------------------------
// Driver tests for the SPEC-DRIVEN e2e-full (D6) ProbeDriver.
//
// The driver no longer counts DOM nodes via the conversation-runner. It now
// invokes the integration's OWN Playwright e2e suite (the LGP gold suite),
// parses the JSON report into per-spec-file verdicts, runs the FAIL-CLOSED
// rollup, and emits one `d6:<slug>/<column>` side row per cell plus the
// aggregate `d6:<slug>`. These tests inject a mocked `runAndParse` so they
// never spawn Playwright or touch a live stack (that's Task 6).
// ---------------------------------------------------------------------------

const MAPPED_FILE_COUNT = allMappedSpecFiles().length;

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

/** A `runAndParse` that returns a fixed scripted spec-result set. */
function fakeRunAndParse(
  specResults: SpecFileResult[],
  capture?: { calls: Parameters<D6RunAndParse>[0][] },
): D6RunAndParse {
  return async (args) => {
    capture?.calls.push(args);
    return { specResults };
  };
}

/** A pass row for a spec file. */
function pass(specFile: string): SpecFileResult {
  return { specFile, cases: [{ title: "t", status: "passed" }], fileVerdict: "pass" };
}
/** A red row for a spec file. */
function red(specFile: string): SpecFileResult {
  return { specFile, cases: [{ title: "t", status: "failed" }], fileVerdict: "red" };
}

/** All 38 mapped gold specs as PASS rows — the LGP all-green shape. */
function allPassRows(): SpecFileResult[] {
  return allMappedSpecFiles().map((f) => pass(f));
}

// ===========================================================================

describe("e2e-full driver (spec-driven)", () => {
  describe("exports preserved", () => {
    it("exports createE2eFullDriver factory", () => {
      expect(typeof createE2eFullDriver).toBe("function");
    });
    it("exports createPooledE2eFullLauncher factory", () => {
      expect(typeof createPooledE2eFullLauncher).toBe("function");
    });
    it("exports FEATURE_CONCURRENCY_D6 = 4", () => {
      expect(FEATURE_CONCURRENCY_D6).toBe(4);
    });
    it("exports DEPLOY_CHURN_GRACE_MS", () => {
      expect(DEPLOY_CHURN_GRACE_MS).toBe(120_000);
    });
    it("exports e2eFullDriver default instance with kind e2e_d6", () => {
      expect(e2eFullDriver).toBeDefined();
      expect(e2eFullDriver.kind).toBe("e2e_d6");
    });
    it("exports Semaphore class", () => {
      const sem = new Semaphore(1);
      expect(sem).toBeInstanceOf(Semaphore);
    });
  });

  describe("kind", () => {
    it("driver kind is e2e_d6", () => {
      const driver = createE2eFullDriver({
        runAndParse: fakeRunAndParse([]),
      });
      expect(driver.kind).toBe("e2e_d6");
    });
  });

  // The driver runs the e2e suite once per integration, parses, rolls up.
  describe("run → parse → rollup → write", () => {
    it("invokes runAndParse once with retries:1 (PRODUCTION probe path)", async () => {
      const capture = { calls: [] as Parameters<D6RunAndParse>[0][] };
      const driver = createE2eFullDriver({
        runAndParse: fakeRunAndParse(allPassRows(), capture),
      });
      await driver.run(makeCtx(), {
        key: "d6:langgraph-python",
        backendUrl: "https://lgp.example.com",
      });
      expect(capture.calls).toHaveLength(1);
      expect(capture.calls[0]!.slug).toBe("langgraph-python");
      expect(capture.calls[0]!.backendUrl).toBe("https://lgp.example.com");
      expect(capture.calls[0]!.retries).toBe(1);
    });

    it("all-pass JSON → all cells green and aggregate green", async () => {
      const sideEmits: ProbeResult<unknown>[] = [];
      const writer: ProbeResultWriter = {
        write: async (r) => {
          sideEmits.push(r);
        },
      };
      const driver = createE2eFullDriver({
        runAndParse: fakeRunAndParse(allPassRows()),
      });
      const result = await driver.run(makeCtx({ writer }), {
        key: "d6:langgraph-python",
        backendUrl: "https://lgp.example.com",
      });

      expect(result.state).toBe("green");
      const signal = result.signal as E2eFullAggregateSignal;
      expect(signal.slug).toBe("langgraph-python");
      expect(signal.total).toBe(MAPPED_FILE_COUNT);
      expect(signal.passed).toBe(MAPPED_FILE_COUNT);
      expect(signal.failed).toEqual([]);

      // Aggregate side row d6:<slug> is emitted green (dashboard read contract).
      const aggRow = sideEmits.find((r) => r.key === "d6:langgraph-python");
      expect(aggRow).toBeDefined();
      expect(aggRow!.state).toBe("green");

      // One side row per cell, keyed d6:<slug>/<column>, all green.
      const sideRows = sideEmits.filter((r) =>
        r.key.startsWith("d6:langgraph-python/"),
      );
      expect(sideRows).toHaveLength(MAPPED_FILE_COUNT);
      expect(sideRows.every((r) => r.state === "green")).toBe(true);
      // Spot-check a known column from the mapping.
      const hitl = sideEmits.find(
        (r) => r.key === "d6:langgraph-python/hitl-in-chat",
      );
      expect(hitl?.state).toBe("green");
    });

    it("a failed spec → that cell RED and aggregate RED (never green)", async () => {
      const sideEmits: ProbeResult<unknown>[] = [];
      const writer: ProbeResultWriter = {
        write: async (r) => {
          sideEmits.push(r);
        },
      };
      // Every spec passes EXCEPT frontend-tools, which is red.
      const rows = allMappedSpecFiles().map((f) =>
        f === "frontend-tools.spec.ts" ? red(f) : pass(f),
      );
      const driver = createE2eFullDriver({
        runAndParse: fakeRunAndParse(rows),
      });
      const result = await driver.run(makeCtx({ writer }), {
        key: "d6:langgraph-python",
        backendUrl: "https://lgp.example.com",
      });

      expect(result.state).toBe("red");
      const signal = result.signal as E2eFullAggregateSignal;
      expect(signal.failed).toContain("frontend-tools");

      const ftRow = sideEmits.find(
        (r) => r.key === "d6:langgraph-python/frontend-tools",
      );
      expect(ftRow!.state).toBe("red");
    });
  });

  // ---- FAIL-CLOSED THROUGH THE DRIVER (the original-sin guard) -----------
  describe("fail-closed through the driver", () => {
    it("empty specResults (run errored / no JSON) → all cells UNKNOWN, aggregate UNKNOWN, NEVER green", async () => {
      const sideEmits: ProbeResult<unknown>[] = [];
      const writer: ProbeResultWriter = {
        write: async (r) => {
          sideEmits.push(r);
        },
      };
      const driver = createE2eFullDriver({
        runAndParse: fakeRunAndParse([]), // parser produced nothing
      });
      const result = await driver.run(makeCtx({ writer }), {
        key: "d6:langgraph-python",
        backendUrl: "https://lgp.example.com",
      });

      // The aggregate must NOT be green. UNKNOWN projects onto the
      // fail-closed `error` ProbeState (the writer's error branch never
      // greens and never resets fail_count); the precise verdict is on
      // signal.aggregateState.
      expect(result.state).not.toBe("green");
      expect(result.state).toBe("error");
      expect(
        (result.signal as E2eFullAggregateSignal).aggregateState,
      ).toBe("unknown");

      const aggRow = sideEmits.find((r) => r.key === "d6:langgraph-python");
      expect(aggRow!.state).toBe("error");
      expect(
        (aggRow!.signal as E2eFullAggregateSignal).aggregateState,
      ).toBe("unknown");

      // Every per-cell side row is unknown — none manufactured green.
      const sideRows = sideEmits.filter((r) =>
        r.key.startsWith("d6:langgraph-python/"),
      );
      expect(sideRows).toHaveLength(MAPPED_FILE_COUNT);
      expect(sideRows.some((r) => r.state === "green")).toBe(false);
      expect(
        sideRows.every(
          (r) =>
            r.state === "error" &&
            (r.signal as E2eFullFeatureSignal).cellState === "unknown",
        ),
      ).toBe(true);
    });

    it("runAndParse throwing → fail-closed UNKNOWN aggregate, never green", async () => {
      const sideEmits: ProbeResult<unknown>[] = [];
      const writer: ProbeResultWriter = {
        write: async (r) => {
          sideEmits.push(r);
        },
      };
      const driver = createE2eFullDriver({
        runAndParse: async () => {
          throw new Error("playwright spawn failed");
        },
      });
      const result = await driver.run(makeCtx({ writer }), {
        key: "d6:langgraph-python",
        backendUrl: "https://lgp.example.com",
      });

      expect(result.state).not.toBe("green");
      expect(result.state).toBe("error");
      expect(
        (result.signal as E2eFullAggregateSignal).aggregateState,
      ).toBe("unknown");
      const aggRow = sideEmits.find((r) => r.key === "d6:langgraph-python");
      expect(aggRow!.state).toBe("error");
    });

    it("a partial result (only some specs ran) → ran cells green, the rest UNKNOWN, aggregate UNKNOWN", async () => {
      const driver = createE2eFullDriver({
        runAndParse: fakeRunAndParse([pass("hitl-in-chat.spec.ts")]),
      });
      const result = await driver.run(makeCtx(), {
        key: "d6:langgraph-python",
        backendUrl: "https://lgp.example.com",
      });
      // One green cell, the rest unknown → aggregate is NOT green (projects
      // to the fail-closed `error` ProbeState; aggregateState is "unknown").
      expect(result.state).toBe("error");
      const signal = result.signal as E2eFullAggregateSignal;
      expect(signal.aggregateState).toBe("unknown");
      expect(signal.passed).toBe(1);
      expect(signal.failed).toEqual([]);
    });
  });

  // ---- SKIPPED specs -----------------------------------------------------
  describe("declared skips", () => {
    it("a declared-skipped spec → skipped cell (neutral), aggregate green if everything else passes", async () => {
      const sideEmits: ProbeResult<unknown>[] = [];
      const writer: ProbeResultWriter = {
        write: async (r) => {
          sideEmits.push(r);
        },
      };
      // All pass EXCEPT voice, which has no row but is declared-skipped.
      const rows = allMappedSpecFiles()
        .filter((f) => f !== "voice.spec.ts")
        .map((f) => pass(f));
      const skipColumn = mapSpecFileToCell("voice.spec.ts");
      const driver = createE2eFullDriver({
        runAndParse: fakeRunAndParse(rows),
        // Inject the skip resolver so the test controls the declared skips
        // without touching the checked-in skip-list.json.
        declaredSkipsImpl: (slug) =>
          slug === "langgraph-python" ? ["voice.spec.ts"] : [],
      });
      const result = await driver.run(makeCtx({ writer }), {
        key: "d6:langgraph-python",
        backendUrl: "https://lgp.example.com",
      });

      // Aggregate green: skipped cells are neutral, every other cell is green.
      expect(result.state).toBe("green");

      const voiceRow = sideEmits.find(
        (r) => r.key === `d6:langgraph-python/${skipColumn}`,
      );
      // A skip projects to a NEUTRAL green-side-row, but carries the precise
      // `cellState: "skipped"` so it's never confused with a real pass.
      expect(voiceRow!.state).toBe("green");
      expect((voiceRow!.signal as E2eFullFeatureSignal).cellState).toBe(
        "skipped",
      );

      const signal = result.signal as E2eFullAggregateSignal;
      expect(signal.skipped).toContain(skipColumn);
    });

    it("passes declaredSkips(slug) into the rollup so a skip is never red", async () => {
      // voice has a RED row, but it's declared-skipped → must be `skipped`.
      const sideEmits: ProbeResult<unknown>[] = [];
      const writer: ProbeResultWriter = {
        write: async (r) => {
          sideEmits.push(r);
        },
      };
      const rows = allMappedSpecFiles().map((f) =>
        f === "voice.spec.ts" ? red(f) : pass(f),
      );
      const skipColumn = mapSpecFileToCell("voice.spec.ts");
      const driver = createE2eFullDriver({
        runAndParse: fakeRunAndParse(rows),
        declaredSkipsImpl: () => ["voice.spec.ts"],
      });
      const result = await driver.run(makeCtx({ writer }), {
        key: "d6:langgraph-python",
        backendUrl: "https://lgp.example.com",
      });

      const voiceRow = sideEmits.find(
        (r) => r.key === `d6:langgraph-python/${skipColumn}`,
      );
      // Even though voice had a RED row, the declared skip wins: neutral
      // green-side-row carrying cellState "skipped" — never red.
      expect(voiceRow!.state).toBe("green");
      expect((voiceRow!.signal as E2eFullFeatureSignal).cellState).toBe(
        "skipped",
      );
      // Everything else passes → aggregate green (skip is neutral, not red).
      expect(result.state).toBe("green");
    });
  });

  // ---- deploy-churn grace window (preserved behaviour) -------------------
  describe("deploy-churn grace window", () => {
    it("skips the e2e run with an unknown (non-green, non-red) aggregate when deploy is recent", async () => {
      const capture = { calls: [] as Parameters<D6RunAndParse>[0][] };
      const driver = createE2eFullDriver({
        runAndParse: fakeRunAndParse(allPassRows(), capture),
      });
      const deployedAt = new Date(
        new Date("2025-01-01T00:00:00Z").getTime() - 30_000,
      ).toISOString();
      const result = await driver.run(makeCtx(), {
        key: "d6:langgraph-python",
        backendUrl: "https://lgp.example.com",
        deployedAt,
      });
      // During the grace window we do NOT run the suite and do NOT green/red.
      expect(capture.calls).toHaveLength(0);
      expect(result.state).not.toBe("green");
      expect(result.state).not.toBe("red");
      expect(result.signal.note).toContain("deploy");
    });
  });

  // ---- slug derivation across key shapes ---------------------------------
  describe("slug derivation", () => {
    it("derives slug from the cron-shape key d6-all-pills-e2e:<name>", async () => {
      const capture = { calls: [] as Parameters<D6RunAndParse>[0][] };
      const driver = createE2eFullDriver({
        runAndParse: fakeRunAndParse(allPassRows(), capture),
      });
      const result = await driver.run(makeCtx(), {
        key: "d6-all-pills-e2e:showcase-langgraph-python",
        backendUrl: "https://lgp.example.com",
      });
      expect(capture.calls[0]!.slug).toBe("langgraph-python");
      const signal = result.signal as E2eFullAggregateSignal;
      expect(signal.slug).toBe("langgraph-python");
    });
  });
});

// ---------------------------------------------------------------------------
// Semaphore — unchanged primitive, retained for the pooled launcher.
// ---------------------------------------------------------------------------
describe("Semaphore", () => {
  it("rejects limit < 1", () => {
    expect(() => new Semaphore(0)).toThrow();
    expect(() => new Semaphore(-1)).toThrow();
  });

  it("allows up to limit concurrent acquires", async () => {
    const sem = new Semaphore(2);
    await sem.acquire();
    await sem.acquire();
    let acquired = false;
    const p = sem.acquire().then(() => {
      acquired = true;
    });
    await Promise.resolve();
    expect(acquired).toBe(false);
    sem.release();
    await p;
    expect(acquired).toBe(true);
    sem.release();
    sem.release();
  });

  it("throws on release without acquire", () => {
    const sem = new Semaphore(1);
    expect(() => sem.release()).toThrow();
  });
});

// ---------------------------------------------------------------------------
// createPooledE2eFullLauncher — retained pooling primitive (NOT used by the
// spec-driven run path, but still exported for other consumers / future use).
// ---------------------------------------------------------------------------
describe("createPooledE2eFullLauncher", () => {
  it("checks out a pooled context per newContext() and moves inUse by 1", async () => {
    const pool = makeFakeContextPool(4);
    const launcher = createPooledE2eFullLauncher(pool as unknown as BrowserPool);
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
    const launcher = createPooledE2eFullLauncher(pool as unknown as BrowserPool);
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
    const launcher = createPooledE2eFullLauncher(pool as unknown as BrowserPool);
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
    const launcher = createPooledE2eFullLauncher(pool as unknown as BrowserPool);
    const browser = await launcher();
    const ctx = await browser.newContext();
    await ctx.close();
    await browser.close(); // no-op
    expect(pool._releaseLog).toHaveLength(1);
  });
});

// Module-scoped fake context-pool for the createPooledE2eFullLauncher tests.
function makeFakeContextPool(maxContexts: number) {
  let nextCtxId = 0;
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
