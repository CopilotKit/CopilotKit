import { describe, it, expect } from "vitest";
import {
  createE2eFullDriver,
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
import type {
  ProbeContext,
  ProbeResult,
  ProbeResultWriter,
  StatusRecord,
} from "../../types/index.js";
import { createStatusWriter } from "../../writers/status-writer.js";
import { createEventBus } from "../../events/event-bus.js";
import type { PbClient } from "../../storage/pb-client.js";
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

/**
 * A `runAndParse` that returns a fixed scripted spec-result set. `exitCode`
 * defaults to 0 (a clean run); pass a non-zero value to exercise the
 * fail-closed exit-code path.
 */
function fakeRunAndParse(
  specResults: SpecFileResult[],
  capture?: { calls: Parameters<D6RunAndParse>[0][] },
  exitCode = 0,
): D6RunAndParse {
  return async (args) => {
    capture?.calls.push(args);
    return { exitCode, specResults };
  };
}

/** A pass row for a spec file. */
function pass(specFile: string): SpecFileResult {
  return {
    specFile,
    cases: [{ title: "t", status: "passed" }],
    fileVerdict: "pass",
  };
}
/** A red row for a spec file. */
function red(specFile: string): SpecFileResult {
  return {
    specFile,
    cases: [{ title: "t", status: "failed" }],
    fileVerdict: "red",
  };
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

    it("Fix 3: does NOT forward a dead abortSignal into runAndParse", async () => {
      // The sync execFileSync path cannot honor an AbortSignal, so the driver
      // must not advertise one by forwarding it. The args carry exactly the
      // fields the contract supports — no `abortSignal`.
      const capture = { calls: [] as Parameters<D6RunAndParse>[0][] };
      const driver = createE2eFullDriver({
        runAndParse: fakeRunAndParse(allPassRows(), capture),
      });
      await driver.run(makeCtx(), {
        key: "d6:langgraph-python",
        backendUrl: "https://lgp.example.com",
      });
      expect(capture.calls).toHaveLength(1);
      // The args carry exactly the contract's fields — no `abortSignal`. This
      // also guards the runtime shape (a defunct signal must not be forwarded).
      expect(Object.keys(capture.calls[0]!).sort()).toEqual([
        "backendUrl",
        "retries",
        "slug",
      ]);
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

      // The aggregate must NOT be green. UNKNOWN projects onto the neutral
      // no-evidence `unknown` ProbeState (the writer's success path overwrites
      // the cell and resets fail_count — never greens, never carries a prior
      // green forward); the precise verdict is on signal.aggregateState.
      expect(result.state).not.toBe("green");
      expect(result.state).toBe("unknown");
      expect((result.signal as E2eFullAggregateSignal).aggregateState).toBe(
        "unknown",
      );

      const aggRow = sideEmits.find((r) => r.key === "d6:langgraph-python");
      expect(aggRow!.state).toBe("unknown");
      expect((aggRow!.signal as E2eFullAggregateSignal).aggregateState).toBe(
        "unknown",
      );

      // Every per-cell side row is unknown — none manufactured green.
      const sideRows = sideEmits.filter((r) =>
        r.key.startsWith("d6:langgraph-python/"),
      );
      expect(sideRows).toHaveLength(MAPPED_FILE_COUNT);
      expect(sideRows.some((r) => r.state === "green")).toBe(false);
      expect(
        sideRows.every(
          (r) =>
            r.state === "unknown" &&
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
      expect(result.state).toBe("unknown");
      expect((result.signal as E2eFullAggregateSignal).aggregateState).toBe(
        "unknown",
      );
      const aggRow = sideEmits.find((r) => r.key === "d6:langgraph-python");
      expect(aggRow!.state).toBe("unknown");
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
      // to the neutral `unknown` ProbeState; aggregateState is "unknown").
      expect(result.state).toBe("unknown");
      const signal = result.signal as E2eFullAggregateSignal;
      expect(signal.aggregateState).toBe("unknown");
      expect(signal.passed).toBe(1);
      expect(signal.failed).toEqual([]);
    });
  });

  // ---- FAIL-CLOSED on non-zero run exit code (Fix 2) ---------------------
  // A Playwright run can exit non-zero for reasons that never render as a
  // per-spec `failed` row (global-setup/webServer/fixture failure, worker
  // crash/SIGSEGV, `--max-failures` abort) while STILL emitting green rows
  // for the specs that ran. Honoring exitCode keeps those pass-rows from
  // manufacturing green cells.
  describe("non-zero exit code (untrustworthy run)", () => {
    it("exitCode!==0 + all-pass rows → cells UNKNOWN, aggregate non-green", async () => {
      const sideEmits: ProbeResult<unknown>[] = [];
      const writer: ProbeResultWriter = {
        write: async (r) => {
          sideEmits.push(r);
        },
      };
      const driver = createE2eFullDriver({
        // All specs reported PASS, but the process exited non-zero — the run
        // is untrustworthy. Pass-rows must NOT green their cells.
        runAndParse: fakeRunAndParse(allPassRows(), undefined, 1),
      });
      const result = await driver.run(makeCtx({ writer }), {
        key: "d6:langgraph-python",
        backendUrl: "https://lgp.example.com",
      });

      // Aggregate is non-green; the precise verdict is "unknown".
      expect(result.state).not.toBe("green");
      expect((result.signal as E2eFullAggregateSignal).aggregateState).toBe(
        "unknown",
      );

      // Every would-be-green cell is now UNKNOWN (projects to "error"); none
      // manufactured green.
      const sideRows = sideEmits.filter((r) =>
        r.key.startsWith("d6:langgraph-python/"),
      );
      expect(sideRows.some((r) => r.state === "green")).toBe(false);
      expect(
        sideRows.every(
          (r) => (r.signal as E2eFullFeatureSignal).cellState === "unknown",
        ),
      ).toBe(true);
    });

    it("exitCode!==0 + a red row → that cell stays RED (a real failure is still a failure)", async () => {
      const sideEmits: ProbeResult<unknown>[] = [];
      const writer: ProbeResultWriter = {
        write: async (r) => {
          sideEmits.push(r);
        },
      };
      const rows = allMappedSpecFiles().map((f) =>
        f === "frontend-tools.spec.ts" ? red(f) : pass(f),
      );
      const driver = createE2eFullDriver({
        runAndParse: fakeRunAndParse(rows, undefined, 1),
      });
      const result = await driver.run(makeCtx({ writer }), {
        key: "d6:langgraph-python",
        backendUrl: "https://lgp.example.com",
      });

      const ftRow = sideEmits.find(
        (r) => r.key === "d6:langgraph-python/frontend-tools",
      );
      // A red row under a non-zero exit stays red — downgrading red→unknown
      // would HIDE a real failure.
      expect(ftRow!.state).toBe("red");
      expect((ftRow!.signal as E2eFullFeatureSignal).cellState).toBe("red");
      // Aggregate is red (a real failure dominates).
      expect(result.state).toBe("red");
    });

    it("exitCode===0 + all-pass → green (unchanged baseline)", async () => {
      const driver = createE2eFullDriver({
        runAndParse: fakeRunAndParse(allPassRows(), undefined, 0),
      });
      const result = await driver.run(makeCtx(), {
        key: "d6:langgraph-python",
        backendUrl: "https://lgp.example.com",
      });
      expect(result.state).toBe("green");
      expect((result.signal as E2eFullAggregateSignal).aggregateState).toBe(
        "green",
      );
    });

    // A seam that DROPS `exitCode` (returns `undefined`) must be treated as
    // untrustworthy, NOT green: `runUntrustworthy = exitCode !== 0` is `true`
    // for `undefined`, so all-pass rows downgrade to `unknown`. This guards
    // the d6-gate-a-validate.mts `strictRunAndParse` regression where the seam
    // returned only `{ specResults }`, dropping `exitCode` and reporting every
    // genuinely-green cell as `unknown`.
    it("exitCode undefined (seam dropped it) + all-pass → cells UNKNOWN, never green", async () => {
      const sideEmits: ProbeResult<unknown>[] = [];
      const writer: ProbeResultWriter = {
        write: async (r) => {
          sideEmits.push(r);
        },
      };
      const driver = createE2eFullDriver({
        // Seam intentionally omits `exitCode` (the bug shape).
        runAndParse: async () =>
          ({
            specResults: allPassRows(),
          }) as unknown as Awaited<ReturnType<D6RunAndParse>>,
      });
      const result = await driver.run(makeCtx({ writer }), {
        key: "d6:langgraph-python",
        backendUrl: "https://lgp.example.com",
      });

      expect(result.state).not.toBe("green");
      expect((result.signal as E2eFullAggregateSignal).aggregateState).toBe(
        "unknown",
      );
      const sideRows = sideEmits.filter((r) =>
        r.key.startsWith("d6:langgraph-python/"),
      );
      expect(sideRows.some((r) => r.state === "green")).toBe(false);
      expect(
        sideRows.every(
          (r) => (r.signal as E2eFullFeatureSignal).cellState === "unknown",
        ),
      ).toBe(true);
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
      // A skip projects to the NON-GREEN neutral `unknown` ProbeState (never
      // a false green — the dashboard's StatusRow.state never reads
      // cellState), but carries the precise `cellState: "skipped"` so it's
      // never confused with a real pass and the dashboard can render a
      // dedicated skip tone off cellState.
      expect(voiceRow!.state).not.toBe("green");
      expect(voiceRow!.state).toBe("unknown");
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
      // Even though voice had a RED row, the declared skip wins: a NON-GREEN
      // neutral `unknown` side-row carrying cellState "skipped" — never red,
      // never a false green.
      expect(voiceRow!.state).not.toBe("green");
      expect(voiceRow!.state).toBe("unknown");
      expect((voiceRow!.signal as E2eFullFeatureSignal).cellState).toBe(
        "skipped",
      );
      // Everything else passes → aggregate green (skip is neutral, not red).
      expect(result.state).toBe("green");
    });

    it("Fix 1: a skipped cell's emitted ProbeResult.state is NEVER green (no false-green channel)", async () => {
      // The dashboard's StatusRow.state is 3-valued (green/red/degraded) and
      // does NOT read signal.cellState. So projecting a skip → ProbeState
      // "green" would render a skipped spec as a real pass. This guard locks
      // the projection to a NON-green neutral state.
      const sideEmits: ProbeResult<unknown>[] = [];
      const writer: ProbeResultWriter = {
        write: async (r) => {
          sideEmits.push(r);
        },
      };
      const rows = allMappedSpecFiles()
        .filter((f) => f !== "voice.spec.ts")
        .map((f) => pass(f));
      const skipColumn = mapSpecFileToCell("voice.spec.ts");
      const driver = createE2eFullDriver({
        runAndParse: fakeRunAndParse(rows),
        declaredSkipsImpl: () => ["voice.spec.ts"],
      });
      await driver.run(makeCtx({ writer }), {
        key: "d6:langgraph-python",
        backendUrl: "https://lgp.example.com",
      });

      const skipRow = sideEmits.find(
        (r) => r.key === `d6:langgraph-python/${skipColumn}`,
      );
      expect(skipRow).toBeDefined();
      // The load-bearing invariant: a skip's emitted ProbeState is never green.
      expect(skipRow!.state).not.toBe("green");
      // cellState audit truth is preserved.
      expect((skipRow!.signal as E2eFullFeatureSignal).cellState).toBe(
        "skipped",
      );
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
      // The aggregate is the neutral `unknown` ("no-evidence") state — the
      // writer's success path overwrites the cell and never carries a prior
      // green forward (pre-fix this emitted "error", which the error branch
      // carried green forward → false-green during a deploy).
      expect(capture.calls).toHaveLength(0);
      expect(result.state).toBe("unknown");
      expect(result.state).not.toBe("green");
      expect(result.state).not.toBe("red");
      expect((result.signal as E2eFullAggregateSignal).aggregateState).toBe(
        "unknown",
      );
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
// END-TO-END: D6 unknown cell → status-writer OVERWRITES a pre-seeded green.
//
// This is the load-bearing regression for the false-green defect. Before the
// fix, a d6 run that produced no trustworthy verdict projected its aggregate
// onto ProbeState "error"; the writer's ERROR branch carried the prior green
// forward + refreshed observed_at, so a previously-green row STAYED green.
// Now the driver emits a neutral `state:"unknown"`, the writer's SUCCESS path
// OVERWRITES `state` to `unknown`, and the green is gone.
// ---------------------------------------------------------------------------
function inMemoryPb(): {
  pb: PbClient;
  rows: Map<string, StatusRecord>;
} {
  const rows = new Map<string, StatusRecord>();
  const history: unknown[] = [];
  const pb: PbClient = {
    async getOne() {
      return null;
    },
    async getFirst<T>(collection: string, filter: string): Promise<T | null> {
      if (collection !== "status") return null;
      const m = filter.match(/key = "(.+)"/);
      if (!m) return null;
      return (rows.get(m[1]!) as unknown as T) ?? null;
    },
    async list() {
      return { page: 1, perPage: 0, totalPages: 0, totalItems: 0, items: [] };
    },
    async create<T>(
      collection: string,
      record: Record<string, unknown>,
    ): Promise<T> {
      if (collection === "status") {
        const r = record as unknown as StatusRecord;
        const id = `r-${rows.size + 1}`;
        rows.set(r.key, { ...r, id });
        return rows.get(r.key) as unknown as T;
      }
      history.push(record);
      return record as unknown as T;
    },
    async update<T>(
      collection: string,
      id: string,
      record: Record<string, unknown>,
    ): Promise<T> {
      if (collection === "status") {
        const existing = [...rows.values()].find((r) => r.id === id);
        if (existing) {
          const merged = { ...existing, ...(record as Partial<StatusRecord>) };
          rows.set(merged.key, merged);
          return merged as unknown as T;
        }
      }
      return record as unknown as T;
    },
    async upsertByField<T>(
      collection: string,
      field: string,
      value: string,
      record: Record<string, unknown>,
    ): Promise<T> {
      const existing = await pb.getFirst<StatusRecord>(
        collection,
        `${field} = ${JSON.stringify(value)}`,
      );
      if (existing?.id) return pb.update<T>(collection, existing.id, record);
      return pb.create<T>(collection, { ...record, [field]: value });
    },
    async delete() {},
    async deleteByFilter() {
      return 0;
    },
    async health() {
      return true;
    },
    async createBackup() {},
    async downloadBackup() {
      return new Uint8Array();
    },
    async deleteBackup() {},
  };
  return { pb, rows };
}

describe("D6 unknown → writer overwrites pre-seeded green (end-to-end)", () => {
  it("a driver run with an unknown aggregate overwrites a green row to unknown (not false-green)", async () => {
    const { pb, rows } = inMemoryPb();
    const writer = createStatusWriter({ pb, bus: createEventBus(), logger });
    const key = "d6:langgraph-python";

    // Pre-seed a GREEN row for the aggregate key (an earlier all-pass run).
    rows.set(key, {
      id: "seed-1",
      key,
      dimension: "d6",
      state: "green",
      signal: {},
      observed_at: "2024-12-31T00:00:00Z",
      transitioned_at: "2024-12-31T00:00:00Z",
      fail_count: 0,
      first_failure_at: null,
    });
    expect(rows.get(key)!.state).toBe("green");

    // Drive a run that produces NO trustworthy verdict (parser returned
    // nothing) → the aggregate ProbeResult.state is the neutral `unknown`.
    const driver = createE2eFullDriver({ runAndParse: fakeRunAndParse([]) });
    const result = await driver.run(makeCtx(), {
      key,
      backendUrl: "https://lgp.example.com",
    });
    expect(result.state).toBe("unknown");

    // Route the driver's primary ProbeResult through the real writer.
    const outcome = await writer.write(result);

    // The persisted row is OVERWRITTEN to `unknown` — the prior green is gone.
    expect(rows.get(key)!.state).toBe("unknown");
    expect(rows.get(key)!.state).not.toBe("green");
    expect(outcome.newState).toBe("unknown");
    // Neutral `cleared` transition (no alert), fail_count reset, observed_at
    // refreshed to the unknown tick.
    expect(outcome.transition).toBe("cleared");
    expect(rows.get(key)!.fail_count).toBe(0);
    // observed_at refreshed to the unknown tick (the run's observedAt),
    // distinct from the seeded row's 2024 timestamp.
    expect(rows.get(key)!.observed_at).toBe(result.observedAt);
    expect(rows.get(key)!.observed_at).not.toBe("2024-12-31T00:00:00Z");
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
