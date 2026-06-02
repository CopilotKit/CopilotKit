/**
 * GATE A live validation harness (Task 6).
 *
 * Drives the REAL spec-driven D6 path for langgraph-python end-to-end against
 * the locally-running LGP stack. This is NOT a re-implementation of the
 * measurement: it constructs the production `createE2eFullDriver()` and lets it
 * run its real flow (runE2eAndParse -> parsePlaywrightJson -> declaredSkips ->
 * rollupCells -> emit aggregate + side rows). The ONLY injected seam is a
 * `runAndParse` that calls the production `runE2eAndParse` at the STRICT gate
 * retry value (`retries=0`) instead of the driver's internal production
 * `retries=1`, per Task 6 Step 2 ("strict; CI=1; --retries=0; --workers=1").
 * CI=1 is forced inside buildE2eCommand. A 0-test run must NOT green.
 *
 * Captures every emitted ProbeResult (aggregate `d6:<slug>` + per-spec
 * `d6:<slug>/<column>` side rows) into an in-memory writer and prints:
 *   - the raw parsed per-spec verdicts (pass/red/unknown counts),
 *   - the rollup cell tally (green/red/unknown/skipped of 40),
 *   - the aggregate row state,
 * as JSON to stdout under a stable marker for machine extraction.
 *
 * Env knobs:
 *   BACKEND_URL  (default http://localhost:3100)  — BASE_URL the specs hit.
 *   D6_GREP      (optional)  — Playwright -g filter, for a single-spec smoke.
 *   D6_RETRIES   (default 0) — strict gate value.
 *   D6_WORKERS   (optional)  — Playwright worker count. Unset → buildE2eCommand
 *                              resolves a host-scaled parallel default
 *                              (ceil(cpus/2), min 4). Set to pin a count.
 */
import { createE2eFullDriver } from "../src/probes/drivers/d6-all-pills.js";
import type {
  D6RunAndParse,
  D6RunAndParseArgs,
} from "../src/probes/drivers/d6-all-pills.js";
import { runE2eAndParse } from "../src/cli/e2e.js";
import { loadConfig } from "../src/cli/config.js";
import type { ProbeContext, ProbeResult } from "../src/types/index.js";

const SLUG =
  process.env.SLUG ?? process.env.INTEGRATION ?? "langgraph-python";
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3100";
const GREP = process.env.D6_GREP && process.env.D6_GREP.length > 0
  ? process.env.D6_GREP
  : undefined;
const RETRIES = Number(process.env.D6_RETRIES ?? "0");
// Optional explicit worker pin. Unset (or non-positive) → defer to
// buildE2eCommand's D6_WORKERS / host-scaled parallel default.
const WORKERS: number | undefined = (() => {
  const raw = process.env.D6_WORKERS;
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
})();

const config = loadConfig();

// Capture every emitted ProbeResult (primary + side rows).
const emitted: ProbeResult<unknown>[] = [];

// Strict run-and-parse seam: production runE2eAndParse at retries=0 (gate).
// We capture the parsed per-spec verdicts too, so we can diff the rollup
// against the raw Playwright result.
let lastSpecResults: { specFile: string; fileVerdict: string; cases: unknown[] }[] = [];
const strictRunAndParse: D6RunAndParse = async (args: D6RunAndParseArgs) => {
  const { exitCode, specResults } = runE2eAndParse(
    args.slug,
    {
      tier: "d6",
      retries: RETRIES,
      // Parallelize the strict gate: omit an explicit `workers` so
      // buildE2eCommand resolves it from `D6_WORKERS` (or the host-scaled
      // default). Pin via the D6_WORKERS env if a deterministic count is
      // needed. retries stays at the strict gate value (RETRIES, default 0).
      ...(WORKERS !== undefined ? { workers: WORKERS } : {}),
      baseUrlOverride: args.backendUrl,
      ...(GREP ? { grep: GREP } : {}),
    },
    config,
  );
  lastSpecResults = specResults.map((r) => ({
    specFile: r.specFile,
    fileVerdict: r.fileVerdict,
    cases: r.cases,
  }));
  // Propagate `exitCode` — the driver reads `parsed.exitCode` to decide
  // `runUntrustworthy = exitCode !== 0`. Dropping it left `exitCode`
  // `undefined`, downgrading every genuinely-green cell to `unknown`.
  return { exitCode, specResults };
};

const driver = createE2eFullDriver({
  runAndParse: strictRunAndParse,
  // LGP declares no skips for the gate; force empty regardless of skip-list.
  declaredSkipsImpl: () => [],
});

const log = (event: string, meta?: Record<string, unknown>): void => {
  // Mirror the harness structured-logger surface the driver expects.
  // eslint-disable-next-line no-console
  console.error(`[log] ${event}`, meta ? JSON.stringify(meta) : "");
};

const ctx: ProbeContext = {
  now: () => new Date(),
  logger: {
    debug: log,
    info: log,
    warn: log,
    error: log,
  } as unknown as ProbeContext["logger"],
  env: process.env,
  writer: {
    async write(result: ProbeResult<unknown>) {
      emitted.push(result);
      return undefined;
    },
  },
};

async function main(): Promise<void> {
  const result = await driver.run(ctx, {
    key: `d6:${SLUG}`,
    backendUrl: BACKEND_URL,
  });

  // Separate aggregate vs side rows.
  const aggregateKey = `d6:${SLUG}`;
  const sideRows = emitted.filter((e) => e.key.startsWith(`${aggregateKey}/`));
  const aggregateRows = emitted.filter((e) => e.key === aggregateKey);

  // Tally cell states from the side rows' precise cellState (source of truth).
  const tally: Record<string, number> = {
    green: 0,
    red: 0,
    unknown: 0,
    skipped: 0,
  };
  const cellStates: { column: string; cellState: string; projected: string }[] = [];
  for (const row of sideRows) {
    const sig = row.signal as { featureType?: string; cellState?: string };
    const cellState = sig.cellState ?? "unknown";
    tally[cellState] = (tally[cellState] ?? 0) + 1;
    cellStates.push({
      column: sig.featureType ?? row.key,
      cellState,
      projected: String(row.state),
    });
  }

  // Raw parsed verdict counts (the Playwright truth before rollup).
  const rawCounts: Record<string, number> = { pass: 0, red: 0, unknown: 0 };
  for (const r of lastSpecResults) {
    rawCounts[r.fileVerdict] = (rawCounts[r.fileVerdict] ?? 0) + 1;
  }
  // Per-case totals across all spec files (for the 186/0/2-style summary).
  let caseTotal = 0;
  let casePassed = 0;
  let caseFailed = 0;
  let caseSkipped = 0;
  let caseOther = 0;
  for (const r of lastSpecResults) {
    for (const c of r.cases as { status?: string }[]) {
      caseTotal++;
      if (c.status === "passed") casePassed++;
      else if (c.status === "failed" || c.status === "timedOut") caseFailed++;
      else if (c.status === "skipped") caseSkipped++;
      else caseOther++;
    }
  }

  const aggSig = (aggregateRows[0]?.signal ?? {}) as Record<string, unknown>;

  const report = {
    marker: "D6_GATE_A_REPORT",
    slug: SLUG,
    backendUrl: BACKEND_URL,
    grep: GREP ?? null,
    retries: RETRIES,
    specFilesParsed: lastSpecResults.length,
    rawFileVerdictCounts: rawCounts,
    caseTotals: {
      total: caseTotal,
      passed: casePassed,
      failed: caseFailed,
      skipped: caseSkipped,
      other: caseOther,
    },
    cellTally: tally,
    cellCount: sideRows.length,
    aggregate: {
      key: aggregateRows[0]?.key,
      projectedState: aggregateRows[0]?.state,
      aggregateState: aggSig.aggregateState,
      passed: aggSig.passed,
      failed: aggSig.failed,
      unknown: aggSig.unknown,
      skipped: aggSig.skipped,
    },
    primaryReturnState: result.state,
    // Full per-cell detail for diffing against the Playwright summary.
    cells: cellStates,
    redCells: cellStates.filter((c) => c.cellState === "red"),
    unknownCells: cellStates.filter((c) => c.cellState === "unknown"),
    skippedCells: cellStates.filter((c) => c.cellState === "skipped"),
    rawSpecVerdicts: lastSpecResults.map((r) => ({
      specFile: r.specFile,
      fileVerdict: r.fileVerdict,
      caseCount: (r.cases as unknown[]).length,
    })),
  };

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("D6_GATE_A_FATAL", err);
  process.exit(2);
});
