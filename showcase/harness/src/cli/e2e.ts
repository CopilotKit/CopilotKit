/**
 * e2e — `showcase e2e` subcommand.
 *
 * Runs spec-driven D6 verdicts for a single slug (or all flagged slugs)
 * against a live Railway target and reports the results locally. The
 * `runSpecDrivenD6` shared pipeline is the seam imported by the driver
 * verdict-source switch (Task 5.1) — the driver path supplies a writer and
 * will persist rows to PocketBase; the CLI command does NOT (no writer
 * in CLI mode — see note printed at runtime).
 *
 * ## Pipeline (shared — also consumed by the driver verdict-source switch,
 * Task 5.1)
 *
 *   1. Load manifest `not_supported_features` for the slug so NSF cells roll
 *      up as SKIPPED (green) rather than UNKNOWN (red).
 *   2. Resolve specPaths for the slug from the N:M spec-cell mapping.
 *   3. Run `playwright test --reporter=json` with webServer disabled and
 *      BASE_URL=<backendUrl>.
 *   4. Parse the JSON output with pw-json-reporter → per-spec SpecResult[].
 *   5. Rollup verdicts with d6-rollup → Map<D5FeatureType, CellVerdict>.
 *   6. Emit via d6-emit (sideEmit per cell + emitAggregate for the slug)
 *      when a writer is present. CLI mode has no writer; rows are NOT
 *      persisted to the dashboard.
 *
 * The entry point is `registerE2eCommand(program)` which mirrors the idiom
 * used by `registerEvalCommand` in `cli/eval/index.ts`.
 *
 * ## Per-slug environment variable matrix (Task 4.2 config-var audit)
 *
 * Most slugs gate `webServer` on `process.env.CI` and read
 * `BASE_URL` for the remote baseURL. The divergent cases are:
 *
 *   - **built-in-agent**: uses `SKIP_WEB_SERVER` (not `CI`) to null its
 *     webServer. `CI=1` alone does NOT disable its webServer; the runner
 *     MUST also set `SKIP_WEB_SERVER=1`. Its `BASE_URL` construction differs
 *     (resolves `PORT` first) but since we always provide `BASE_URL`, the
 *     fallback is irrelevant.
 *
 *   - **ms-agent-dotnet / ms-agent-harness-dotnet / ms-agent-python**:
 *     standard pattern (`CI`), but the playwright config uses non-default
 *     `retries` and `workers` for concurrency flake tuning. Do NOT override
 *     these via CLI flags — let the per-slug config govern.
 *
 *   - **langgraph-typescript / langgraph-python**: the webServer block
 *     (when active) injects `OPENAI_BASE_URL` and `OPENAI_API_KEY` from
 *     env (defaulting to aimock local). When `CI=1` skips the webServer,
 *     the app code reads `OPENAI_BASE_URL` directly from its process env —
 *     it must therefore be present in the Playwright child's env.
 *     `OPENAI_BASE_URL` is a routing URL (non-secret) and IS passed through
 *     by the filter. `OPENAI_API_KEY` has the `_API_KEY` suffix and IS
 *     dropped (it is a secret). Against Railway the backend already has its
 *     own credentials; the Playwright child needs only `OPENAI_BASE_URL`
 *     to route requests to the correct aimock instance.
 *
 * **Default runner env (set by this module for every slug):**
 *   - `CI=1`            — disables webServer for 19 of 20 slugs.
 *   - `SKIP_WEB_SERVER=1` — disables webServer for built-in-agent (harmless
 *                           for all other slugs that don't read this var).
 *   - `BASE_URL=<backendUrl>` — set from the resolved target URL.
 *   - `PLAYWRIGHT_JSON_OUTPUT_NAME` is explicitly excluded from the
 *     inherited env and set to a fresh run-scoped tmp path by
 *     defaultSpecRunner. Ambient values are never propagated.
 *
 * ## Flag predicate
 *
 * `isSpecDriven(slug)` from spec-driven-slugs.ts is authoritative. In
 * Phase 0 the JSON ships EMPTY, so with no explicit --slug argument the
 * command is a no-op (emits nothing, exits 0). This is intentional: the
 * command is wired up now so the driver slot (Task 5.1) can import
 * `runSpecDrivenD6` without a circular dependency, but nothing runs until
 * a slug is flagged via a reviewed PR.
 *
 * ## Exit codes
 *
 * The CLI exits non-zero (1) when `totalCellsFailed + slugErrors > 0`,
 * where:
 *   - `totalCellsFailed` — count of cells with RED or UNKNOWN verdicts.
 *   - `slugErrors` — count of slug-level errors (missing integration dir,
 *     or `runSpecDrivenD6` threw). These are distinct from per-cell failures
 *     so the JSON summary can report them separately.
 */

import type { Command } from "commander";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";

import { createLogger } from "../logger.js";
import {
  loadDefaultSpecCellMapping,
  loadDefaultResolvedMapping,
} from "../probes/helpers/spec-cell-mapping.js";
import { parsePlaywrightJsonReport } from "../probes/helpers/pw-json-reporter.js";
import type { PlaywrightJsonReport } from "../probes/helpers/pw-json-reporter.js";
import {
  rollupVerdicts,
  rollupDiagnostics,
} from "../probes/helpers/d6-rollup.js";
import type {
  CellVerdict,
  ReporterVerdictMap,
} from "../probes/helpers/d6-rollup.js";
import { loadSkipList, mergeSkipList } from "../probes/helpers/skip-list.js";
import { isSpecDriven } from "../probes/helpers/spec-driven-slugs.js";
import { sideEmit, emitAggregate } from "../probes/helpers/d6-emit.js";
import type { ProbeContext, ProbeResult } from "../types/index.js";
import type {
  E2eFullFeatureSignal,
  E2eFullAggregateSignal,
} from "../probes/drivers/d6-all-pills.js";
import type { D5FeatureType } from "../probes/helpers/d5-registry.js";

const log = createLogger({ component: "e2e" });

// ── Secret filter ─────────────────────────────────────────────────────────────
//
// ONE exported constant shared by both the runner env filter (runSpecDrivenD6)
// and the ctx.env filter (runE2eCommand). Two copies previously drifted apart.
//
// DROPPED (secret-shaped):
//   - PB_*         — PocketBase admin credentials
//   - RAILWAY_*    — Railway platform tokens/config
//   - AWS_*        — AWS credentials/config (all vars, wholesale)
//   - *_TOKEN      — any token suffix
//   - *_KEY        — any key suffix (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.)
//   - *_PASSWORD   — any password suffix
//   - *_PAT        — any personal access token suffix
//   - *SECRET*     — any key containing SECRET as a substring
//
// ALLOWED (routing / non-secret):
//   - OPENAI_BASE_URL, ANTHROPIC_BASE_URL — aimock endpoint URLs (not secrets;
//     they do NOT match _TOKEN, _KEY, _PASSWORD, _PAT, or SECRET patterns).
//   - OPENAI_MODEL, OPENAI_ORG — non-secret provider config
//   - BASE_URL, CI, SKIP_WEB_SERVER, PATH, HOME, TMPDIR, NODE_*, etc.
//
// Note: the `^(OPENAI_|ANTHROPIC_)` prefix drops that previously stripped
// OPENAI_BASE_URL are NOT present — we rely on suffix/substring patterns
// to correctly allow URL-shaped vars while dropping secret-shaped ones.
export const SECRET_KEY_RE =
  /^(PB_|RAILWAY_|AWS_)|(_TOKEN|_KEY|_PASSWORD|_PAT)$|SECRET/i;

// ── shared pipeline ──────────────────────────────────────────────────────────

/**
 * Options for the shared spec-driven D6 pipeline.
 *
 * `specRunner` is an injectable seam for unit testing — callers (test
 * files) provide a stub; the CLI action uses the default (real
 * `playwright test --reporter=json`).
 */
export interface RunSpecDrivenD6Options {
  /** Resolved backend URL (BASE_URL for Playwright). Required. */
  backendUrl: string;
  /** Working directory of the integration (where playwright.config.ts lives). */
  integrationDir: string;
  /**
   * Timeout passed as `--timeout <ms>` to the Playwright CLI.
   * When provided, also set as `PLAYWRIGHT_TIMEOUT` in the runner env
   * (belt-and-suspenders for configs that read it directly).
   */
  timeoutMs?: number;
  /** Probe context — provides writer and logger. Required for emit. */
  ctx: ProbeContext;
  /**
   * Features declared not supported by this slug's manifest
   * (`not_supported_features`). When provided these are merged into the
   * skip-list before verdict rollup so the cells roll up as SKIPPED
   * (green) rather than UNKNOWN (red).
   *
   * This wires the existing `mergeSkipList` helper — previously it had
   * zero production callers.
   */
  notSupportedFeatures?: string[];
  /**
   * Injectable spec runner (default: real playwright invocation).
   * Signature: (integrationDir, specPaths, env) => PlaywrightJsonReport
   *
   * The runner receives the integration directory, the list of spec
   * paths from the mapping, and the env vars to pass to Playwright.
   * It must return a parsed PlaywrightJsonReport (not a JSON string).
   *
   * @internal Overridden in unit tests to avoid live Playwright invocations.
   */
  specRunner?: SpecRunner;
  /**
   * Injectable on-disk spec lister (default: scans
   * `<integrationDir>/tests/e2e/*.spec.ts` and returns `tests/e2e/<file>`
   * relpaths). The resolver restricts the base+delta mapping to the specs a
   * slug actually carries on disk. Overridden in unit tests so a fake
   * integration dir need not contain real files.
   *
   * @internal Overridden in unit tests.
   */
  listPresentSpecs?: (slug: string) => string[];
  /**
   * Test-only injection seams. The production path never sets this field;
   * nesting all test hooks here makes it unrepresentable in normal production
   * option construction — a future production caller cannot accidentally inject
   * a bypass mapping at the top level.
   *
   * @internal Overridden in unit tests ONLY.
   */
  __testSeams?: {
    /**
     * Pre-resolved slug-map (spec-path → cells). When provided, the pipeline
     * uses it verbatim and SKIPS the base+delta resolver entirely — exists so
     * unit tests can pin an exact resolved mapping (including pathological
     * shapes like a spec-path with zero cells) without staging on-disk files
     * or base.json entries.
     */
    resolvedMapping?: Record<string, D5FeatureType[]>;
  };
  /**
   * Abort signal — when signalled, the pipeline exits early without emitting.
   * Optional and safe to omit; provided by the driver agent when threading
   * cancellation.
   */
  signal?: AbortSignal;
}

/**
 * Injectable spec runner type — maps (integrationDir, specPaths, env) →
 * PlaywrightJsonReport.
 */
export type SpecRunner = (
  integrationDir: string,
  specPaths: readonly string[],
  env: Record<string, string>,
) => PlaywrightJsonReport;

/**
 * Result of a `runSpecDrivenD6` call.
 */
export interface RunSpecDrivenD6Result {
  /** Per-cell verdict map (same keys as the mapping for this slug). */
  verdicts: Map<D5FeatureType, CellVerdict>;
  /** Number of cells emitted as green (verdict GREEN). */
  greenCount: number;
  /**
   * Number of cells emitted as red or unknown (RED or UNKNOWN).
   * Does NOT include slug-level runner errors — those are surfaced
   * as thrown exceptions from `runSpecDrivenD6`.
   */
  cellsFailed: number;
  /** Number of cells emitted as skipped (verdict SKIPPED — renders green). */
  skippedCount: number;
  /**
   * Subset of failed cells that were UNKNOWN (fail-closed: spec produced
   * zero tests or was not found in the report). Both UNKNOWN and RED cells
   * are counted in `cellsFailed`; this annotation preserves the distinction.
   */
  unknownCells: string[];
  /** Cells with explicit spec failure (verdict RED). */
  redCells: string[];
  /**
   * Skip-list cells whose underlying spec produced a FAIL verdict — i.e.
   * the skip is masking an active regression. A WARN is emitted per cell
   * during the run; this array surfaces them in the result for callers.
   */
  skipMaskedRed: string[];
  /**
   * Skip-list cells for this slug that have no backing spec entry in the
   * mapping (inert skip entries). A stale skip-list or missing mapping entry.
   */
  inertSkipEntries: string[];
}

/**
 * Run the spec-driven D6 verdict pipeline for a single slug.
 *
 * This is the **shared pipeline** function reused by both the CLI
 * subcommand (Task 4.1) and the driver verdict-source switch (Task 5.1).
 * Both code paths must traverse this SAME function so the emit shape is
 * byte-identical regardless of how the run is triggered.
 *
 * @param slug    Integration slug (e.g. "langgraph-python").
 * @param opts    Pipeline options (backendUrl, integrationDir, ctx, ...).
 * @returns       Per-cell verdicts + summary counts.
 */
export async function runSpecDrivenD6(
  slug: string,
  opts: RunSpecDrivenD6Options,
): Promise<RunSpecDrivenD6Result> {
  const { backendUrl, integrationDir, timeoutMs, ctx, signal } = opts;
  const runner = opts.specRunner ?? defaultSpecRunner;

  // 1. Resolve the slug-map ONCE + build skip-list ─────────────────────────
  //
  // Under the base+delta model we RESOLVE the slug's mapping once here
  // (base ⊕ override ⊖ auto-omit, restricted to on-disk specs) and feed the
  // SAME resolved slug-map to every consumer below (specPaths, rollupVerdicts,
  // rollupDiagnostics) so they cannot diverge. The old "slug absent from the
  // single-slug JSON → e2e.no-mapping bail" reason no longer exists — every
  // slug with specs on disk resolves to a non-empty map. The empty-verdicts
  // guard is RETAINED below as a genuine-failure backstop (zero specs on disk /
  // runner error).
  const listPresentSpecs =
    opts.listPresentSpecs ?? defaultListPresentSpecs(integrationDir);
  const slugMapping =
    opts.__testSeams?.resolvedMapping ??
    (await loadDefaultResolvedMapping(slug, {
      listPresentSpecs,
      notSupportedFeatures: opts.notSupportedFeatures,
    }));

  // Merge notSupportedFeatures from the manifest into the skip-list so NSF
  // cells roll up as SKIPPED (green) rather than UNKNOWN (red).
  // mergeSkipList is pure; it returns a new map without mutating base.
  let skipList = loadSkipList();
  if (opts.notSupportedFeatures && opts.notSupportedFeatures.length > 0) {
    skipList = mergeSkipList(skipList, slug, opts.notSupportedFeatures);
  }

  if (Object.keys(slugMapping).length === 0) {
    // Genuine-failure backstop: zero specs on disk (or all unmapped/quarantined).
    // NOT the old "unmapped slug" case — that reason is gone. F3 still reds.
    log.warn("e2e.no-mapping", { slug });
    // Return empty — no cells to emit.
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
  }

  const specPaths = Object.keys(slugMapping);

  // Check abort before the expensive playwright run.
  if (signal?.aborted) {
    throw new Error(`runSpecDrivenD6: aborted before running ${slug}`);
  }

  // 2. Build runner env ──────────────────────────────────────────────────
  // We inherit only shell/runtime essentials from process.env so Playwright
  // can locate binaries and user-level config. Secret-shaped keys are
  // explicitly dropped and must NOT reach child processes. We also exclude
  // PLAYWRIGHT_JSON_OUTPUT_NAME: inheriting an ambient (stale) value would
  // redirect JSON output to a wrong path, silently breaking verdict parsing.
  // The defaultSpecRunner always sets a fresh run-scoped tmp path.
  //
  // ## Filter rule — see module-level SECRET_KEY_RE constant for the authoritative
  // drop/allow list. Both the runner env and ctx.env use the same exported constant.
  const runnerEnv: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([k, v]) =>
          v !== undefined &&
          k !== "PLAYWRIGHT_JSON_OUTPUT_NAME" &&
          !SECRET_KEY_RE.test(k),
      ) as [string, string][],
    ),
    // Run-scoped overrides (always applied last, never overrideable by ambient):
    CI: "1",
    SKIP_WEB_SERVER: "1",
    BASE_URL: backendUrl,
  };
  // Belt-and-suspenders: also set PLAYWRIGHT_TIMEOUT for configs that read
  // it directly (e.g. playwright.config.ts using process.env.PLAYWRIGHT_TIMEOUT).
  if (timeoutMs !== undefined) {
    runnerEnv["PLAYWRIGHT_TIMEOUT"] = String(timeoutMs);
  }

  // 3. Run playwright (or stub) ──────────────────────────────────────────
  log.info("e2e.run-start", { slug, specCount: specPaths.length, backendUrl });
  const report = runner(integrationDir, specPaths, runnerEnv);

  // Re-check abort AFTER the run returns and BEFORE parse/rollup/emit.
  // Per contract: aborted runs must not emit any rows. The pre-run check
  // guards the common case (already-signalled); this post-run check handles
  // mid-run cancellation (signal fired while playwright was executing).
  if (signal?.aborted) {
    throw new Error(
      `runSpecDrivenD6: aborted after run of ${slug} — no rows emitted`,
    );
  }

  // Set observedAt now (after the run) so the timestamp reflects when the
  // results were actually collected, not when the pipeline was constructed.
  const now = ctx.now().toISOString();

  // 4. Parse → per-spec verdict map ─────────────────────────────────────
  const specResults = parsePlaywrightJsonReport(report, specPaths);
  const verdictMap: ReporterVerdictMap = {};
  for (const r of specResults) {
    verdictMap[r.specPath] = { specPath: r.specPath, status: r.status };
  }

  // 5. Rollup → per-cell CellVerdict ────────────────────────────────────
  // Consumer 2: rollupVerdicts consumes the ONE resolved slug-map.
  const verdicts = rollupVerdicts(slug, slugMapping, verdictMap, skipList);

  // Fail-closed zero-cells seam: guard on MAPPED (spec-derived) cells only.
  //
  // rollupVerdicts pre-seeds SKIPPED for unmapped skip entries (G1 fix).
  // If we guard on `verdicts.size === 0`, a slug with zero spec-mapped cells
  // but a non-empty skip-list evades the guard (verdicts.size > 0 from the
  // pre-seeded SKIPPED entries) → false green.
  //
  // Fix: count the unique cells that appear in any spec's cell array
  // (spec-derived cells). Pre-seeded SKIPPED from unmapped skip entries are
  // NOT in this set. Guard fires when there are specPaths but zero spec-derived cells.
  const specMappedCellCount: number = (() => {
    const mapped = new Set<string>();
    for (const cells of Object.values(slugMapping)) {
      for (const c of cells) {
        mapped.add(c);
      }
    }
    return mapped.size;
  })();

  if (specMappedCellCount === 0 && specPaths.length > 0) {
    throw new Error(
      `runSpecDrivenD6: zero cells (spec-mapped) for ${slug} ` +
        `despite ${specPaths.length} spec path(s) — treating as slug error (fail-closed)`,
    );
  }

  // 5b. Diagnostics — wire rollupDiagnostics after rollup ─────────────────
  // rollupDiagnostics surfaces data-model inconsistencies without altering
  // the verdict contract. Previously dead code (never called). Now wired in.
  // Consumer 3: rollupDiagnostics consumes the SAME resolved slug-map (not raw
  // mapping) — otherwise a newly-flipped slug silently drops skip-mask /
  // inert-skip diagnostics.
  const diagnostics = rollupDiagnostics(
    slug,
    slugMapping,
    skipList,
    verdictMap,
  );

  // Emit WARNs for each skip-masked-red cell (skip hiding active regression).
  for (const maskedCell of diagnostics.skipMaskedRed) {
    log.warn("e2e.skip-masked-red", {
      slug,
      cell: maskedCell,
      note: "skip-list entry is masking a real FAIL verdict — active regression hidden",
    });
  }
  // Emit WARNs for inert skip entries (stale skip-list or missing mapping).
  for (const inertCell of diagnostics.inertSkipEntries) {
    log.warn("e2e.inert-skip-entry", {
      slug,
      cell: inertCell,
      note: "skip-list entry has no backing spec in the mapping — likely stale",
    });
  }

  // Fix 5: Detect location-less errors from the report. When present, specs
  // that would otherwise PASS are promoted to ERRORED by pw-json-reporter
  // (fail-closed: globally unreliable run). UNKNOWN cells in such a run are
  // NOT just "missing spec output" — they reflect a global runner failure.
  // We annotate them with errorClass "global-error-promotion" so the blast
  // radius is visible rather than silent. One WARN summarizes the blast.
  //
  // Tradeoff documented here: we do NOT change the fail-closed promotion
  // (false-green risk stays zero). We only ADD an annotation + WARN so
  // operators can distinguish "spec didn't run" from "global crash silenced tests".
  const errors = report.errors ?? [];
  const hasLocationlessError = errors.some(
    (err) =>
      err.location?.file === undefined ||
      err.location?.file === null ||
      err.location.file.trim() === "",
  );

  // 6. Emit per-cell side rows (d6:<slug>/<cell>) ───────────────────────
  let greenCount = 0;
  let cellsFailed = 0;
  let skippedCount = 0;
  const failedCells: string[] = []; // union of RED + UNKNOWN for aggregate signal
  const unknownCells: string[] = []; // UNKNOWN subset (fail-closed)
  const redCells: string[] = []; // RED subset (explicit spec failure)
  const skippedCells: string[] = [];
  // Cells that are UNKNOWN due to global-error promotion (location-less error).
  const globalErrorPromotedCells: string[] = [];

  // Fix 7: when writer is intentionally absent (CLI mode), a single upfront
  // notice is printed by runE2eCommand. Suppress per-cell writer-missing warns
  // from sideEmit/emitAggregate — they create a warn wall (N cells = N warns)
  // with no additional diagnostic value beyond the single upfront notice.
  // We gate the entire emit loop when no writer is present.
  const hasWriter = ctx.writer !== undefined;

  for (const [cell, verdict] of verdicts) {
    const state =
      verdict === "GREEN"
        ? "green"
        : verdict === "SKIPPED"
          ? "green" // SKIPPED renders green (feature explicitly not supported)
          : "red";

    // Fix 5: annotate UNKNOWN cells with "global-error-promotion" when the
    // report had a location-less error. This distinguishes "spec didn't produce
    // output" from "global runner crash promoted all PASS specs to ERRORED/UNKNOWN".
    const effectiveErrorClass: string | undefined =
      verdict === "UNKNOWN"
        ? hasLocationlessError
          ? "global-error-promotion"
          : "unknown"
        : verdict === "RED"
          ? "spec-failed"
          : undefined;

    if (verdict === "UNKNOWN" && hasLocationlessError) {
      globalErrorPromotedCells.push(cell);
    }

    const featureResult: ProbeResult<E2eFullFeatureSignal> = {
      key: `d6:${slug}/${cell}`,
      state,
      signal: {
        slug,
        featureType: cell,
        backendUrl,
        note: verdict === "SKIPPED" ? "skipped-incapable" : undefined,
        errorClass: effectiveErrorClass,
      },
      observedAt: now,
    };

    if (hasWriter) {
      await sideEmit(ctx, featureResult);
    }

    if (verdict === "GREEN") {
      greenCount++;
    } else if (verdict === "SKIPPED") {
      skippedCount++;
      skippedCells.push(cell);
    } else {
      cellsFailed++;
      failedCells.push(cell);
      if (verdict === "UNKNOWN") {
        unknownCells.push(cell);
      } else {
        // verdict === "RED"
        redCells.push(cell);
      }
    }
  }

  // Fix 5: emit a single WARN summarizing the global-error blast radius.
  // Do NOT emit per-cell (that would be N warns). One summary is enough.
  if (hasLocationlessError && globalErrorPromotedCells.length > 0) {
    log.warn("e2e.global-error-promotion", {
      slug,
      blastRadius: globalErrorPromotedCells.length,
      note: "location-less error in Playwright report promoted PASS→ERRORED/UNKNOWN for all affected specs (fail-closed); blast radius cells annotated with errorClass:global-error-promotion",
    });
  }

  // 7. Emit aggregate row (d6:<slug>) ────────────────────────────────────
  // The `total` partition is exhaustive: greenCount + cellsFailed + skippedCount === total.
  // `passed` counts GREEN only. SKIPPED cells are separately listed in `skipped` —
  // they render green on the dashboard but are not "passing tests".
  const total = verdicts.size;
  const aggregateState = cellsFailed === 0 ? "green" : "red";
  const aggregateSignal: E2eFullAggregateSignal = {
    shape: "package",
    slug,
    backendUrl,
    total,
    passed: greenCount,
    // `failed` is the union of RED and UNKNOWN cells (both render red on
    // the dashboard). Per-verdict distinction is preserved in RunSpecDrivenD6Result.
    failed: failedCells,
    skipped: skippedCells,
  };
  // emitAggregate always writes with key `d6:<slug>` (the rowPrefix arg),
  // superseding aggregateResult.key. We set the correct key here anyway so
  // the ProbeResult is self-consistent if inspected directly.
  const aggregateResult: ProbeResult<E2eFullAggregateSignal> = {
    key: `d6:${slug}`,
    state: aggregateState,
    signal: aggregateSignal,
    observedAt: now,
  };

  if (hasWriter) {
    await emitAggregate(ctx, slug, aggregateResult, "d6");
  }

  log.info("e2e.run-done", {
    slug,
    total,
    greenCount,
    cellsFailed,
    skippedCount,
    unknownCount: unknownCells.length,
    redCount: redCells.length,
  });

  return {
    verdicts,
    greenCount,
    cellsFailed,
    skippedCount,
    unknownCells,
    redCells,
    skipMaskedRed: [...diagnostics.skipMaskedRed],
    inertSkipEntries: [...diagnostics.inertSkipEntries],
  };
}

// ── default on-disk spec lister ──────────────────────────────────────────────

/**
 * Build the default present-spec lister for a slug rooted at `integrationDir`.
 * Scans `<integrationDir>/tests/e2e/*.spec.ts` and returns `tests/e2e/<file>`
 * relpaths (matching the mapping key shape and Playwright's report grouping).
 * A missing dir yields an empty list (the empty-verdicts backstop then fires).
 */
export function defaultListPresentSpecs(
  integrationDir: string,
): (slug: string) => string[] {
  return () => {
    const e2eDir = path.join(integrationDir, "tests", "e2e");
    let entries: string[];
    try {
      entries = fs.readdirSync(e2eDir);
    } catch {
      return [];
    }
    return entries
      .filter((f) => f.endsWith(".spec.ts"))
      .map((f) => `tests/e2e/${f}`)
      .sort();
  };
}

// ── default spec runner (real playwright invocation) ─────────────────────────

/**
 * Default spec runner: invokes `playwright test --reporter=json
 * --timeout <ms>` with a run-scoped temp file for the JSON output and
 * returns the parsed report.
 *
 * - Sets `PLAYWRIGHT_JSON_OUTPUT_NAME` to a tmp path so parallel runs
 *   don't collide.
 * - Passes `CI=1` and `SKIP_WEB_SERVER=1` via env so webServer is always
 *   disabled (see doc-comment on RunSpecDrivenD6Options).
 * - Passes `--timeout <ms>` as a real CLI arg when `PLAYWRIGHT_TIMEOUT`
 *   is set in the env (belt-and-suspenders: env is also set for configs
 *   that read it directly).
 * - Surfaces `spawnSync` errors (ENOENT, spawn failure) so a missing
 *   playwright binary does not silently become "no JSON output -> empty
 *   report -> all UNKNOWN" — instead it throws with a clear message.
 * - Validates the minimal shape of the parsed JSON; malformed output is
 *   classified as an error (fail-closed) rather than silently treated as
 *   an empty report.
 * - Ignores non-zero exit codes that Playwright uses to signal test
 *   failures (exit 1) — we read the JSON to determine verdicts.
 */
export const defaultSpecRunner: SpecRunner = (
  integrationDir: string,
  specPaths: readonly string[],
  env: Record<string, string>,
): PlaywrightJsonReport => {
  // Use mkdtempSync for collision-free tmp naming (replaces Math.random).
  // mkdtempSync creates the directory; we want a file path inside os.tmpdir().
  // We create a tmp dir and place the JSON file inside it so cleanup is easy.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-json-"));
  const tmpFile = path.join(tmpDir, "report.json");

  try {
    // Validate PLAYWRIGHT_TIMEOUT in env before passing it as --timeout.
    // Callers that bypass the CLI gate (e.g. the driver path) may inject
    // arbitrary values; a garbage --timeout arg causes playwright to fail
    // with a confusing error rather than a clear "invalid timeout" message.
    const rawTimeout = env["PLAYWRIGHT_TIMEOUT"];
    if (rawTimeout !== undefined && !/^\d+$/.test(rawTimeout)) {
      throw new Error(
        `PLAYWRIGHT_TIMEOUT must be a positive integer (ms), got: ${rawTimeout}`,
      );
    }

    const runnerEnv = {
      ...env,
      PLAYWRIGHT_JSON_OUTPUT_NAME: tmpFile,
    };

    // Resolve npx/playwright from the integration's node_modules if available.
    const playwrightBin = path.join(
      integrationDir,
      "node_modules",
      ".bin",
      "playwright",
    );
    const bin = fs.existsSync(playwrightBin) ? playwrightBin : "npx";

    // Build args. Pass --timeout as a real CLI argument so Playwright
    // respects it regardless of the per-config timeout settings.
    // PLAYWRIGHT_TIMEOUT in env is belt-and-suspenders only.
    const timeoutFlag =
      rawTimeout !== undefined ? ["--timeout", rawTimeout] : [];

    const args =
      bin === "npx"
        ? [
            "playwright",
            "test",
            "--reporter=json",
            ...timeoutFlag,
            ...specPaths,
          ]
        : ["test", "--reporter=json", ...timeoutFlag, ...specPaths];

    // Derive spawnSync timeout from PLAYWRIGHT_TIMEOUT × spec count.
    //
    // Formula: perTestMs × specPaths.length × RETRY_HEADROOM + 5_000 ms
    //   - specPaths.length: ONE spawnSync call runs ALL specs (not one per spec),
    //     so healthy multi-spec slugs (LGP=37+) need the full width, not just
    //     "2× a single test". Old formula (perTestMs × 2) SIGKILL'd them.
    //   - RETRY_HEADROOM=2: ms-agent slugs configure Playwright retries; each
    //     spec can run twice before failing, so the budget must cover the retry.
    //   - 5_000 ms fixed overhead for browser launch and process setup.
    //   - Clamped to Int32 max (2147483647): spawnSync takes a signed 32-bit
    //     integer; an unclamped budget overflows to a negative/tiny value and
    //     causes immediate SIGKILL on large slugs with high timeouts.
    //
    // When PLAYWRIGHT_TIMEOUT is unset, fall back to a 30-minute ceiling.
    //
    // maxBuffer is set to 64 MB so large JSON reports don't trigger ENOBUFS.
    const NODE_INT32_MAX = 2_147_483_647;
    const RETRY_HEADROOM = 2;
    const perTestMs = rawTimeout !== undefined ? Number(rawTimeout) : 0;
    const spawnTimeoutMs =
      perTestMs > 0
        ? Math.min(
            perTestMs * specPaths.length * RETRY_HEADROOM + 5_000,
            NODE_INT32_MAX,
          )
        : 30 * 60 * 1000; // 30-minute ceiling when no timeout configured

    const result = spawnSync(bin, args, {
      cwd: integrationDir,
      env: runnerEnv,
      encoding: "utf-8",
      // Do not throw on non-zero exit — Playwright exits 1 when tests fail.
      stdio: "pipe",
      timeout: spawnTimeoutMs,
      maxBuffer: 64 * 1024 * 1024, // 64 MB
    });

    // Surface spawn-level errors with classified messages so the caller can
    // distinguish timeout/buffer-overflow from missing-binary failures.
    // These must not silently become "no JSON output -> empty report -> all UNKNOWN".
    //
    // spawnSync error/signal semantics:
    //   result.error  — set when the spawn itself failed (ENOENT, ENOBUFS, ETIMEDOUT).
    //                   ETIMEDOUT is the spawnSync-internal timeout code.
    //   result.signal — set when the child was killed by a signal (e.g. SIGKILL from
    //                   the OS timeout on the child process itself). Mutually
    //                   exclusive with result.error in practice.
    if (result.error) {
      const errCode = (result.error as NodeJS.ErrnoException).code;
      if (errCode === "ETIMEDOUT") {
        // spawnSync's own wall-clock timeout fired — process was killed.
        throw new Error(
          `playwright timed out after ${spawnTimeoutMs}ms (slug runner exceeded wall-clock limit)` +
            (result.stderr ? `\nstderr: ${result.stderr.slice(0, 500)}` : ""),
        );
      }
      if (errCode === "ENOBUFS") {
        throw new Error(
          `playwright output exceeded maxBuffer (64 MB) — slug run produced too much output` +
            (result.stderr ? `\nstderr: ${result.stderr.slice(0, 500)}` : ""),
        );
      }
      throw new Error(
        `playwright spawn failed (${result.error.message})` +
          (result.stderr ? `\nstderr: ${result.stderr}` : ""),
      );
    }
    // spawnSync sets result.signal when the child was killed by an OS signal.
    // Report the actual signal name rather than hardcoding "SIGKILL".
    if (result.signal) {
      throw new Error(
        `playwright killed by signal ${result.signal} after ${spawnTimeoutMs}ms budget` +
          (result.stderr ? `\nstderr: ${result.stderr.slice(0, 500)}` : ""),
      );
    }

    // A non-zero status that is NOT a test-failure (Playwright uses exit 1
    // for test failures but >=2 for config/launch errors) is worth logging.
    if (result.status !== null && result.status !== 0 && result.status !== 1) {
      log.warn("e2e.playwright-exit-nonzero", {
        integrationDir,
        status: result.status,
        stderr: result.stderr?.slice(0, 500),
      });
    }

    if (!fs.existsSync(tmpFile)) {
      // Playwright did not write JSON output. Surface stderr for diagnostics
      // rather than silently returning an empty report (which would make all
      // cells UNKNOWN with no indication of why).
      const stderrSnippet = result.stderr?.slice(0, 500) ?? "(none)";
      throw new Error(
        `playwright produced no JSON output (PLAYWRIGHT_JSON_OUTPUT_NAME=${tmpFile})` +
          `\nstderr: ${stderrSnippet}`,
      );
    }

    const raw = fs.readFileSync(tmpFile, "utf-8");

    // Validate minimal shape before returning. Malformed JSON or a wrong
    // shape is classified as an error (fail-closed) rather than silently
    // producing an empty report that masks the root cause.
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `playwright JSON output is not valid JSON: ${err instanceof Error ? err.message : String(err)}` +
          `\nfirst 200 chars: ${raw.slice(0, 200)}`,
      );
    }

    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      !Array.isArray((parsed as Record<string, unknown>)["suites"])
    ) {
      throw new Error(
        `playwright JSON output has unexpected shape (missing top-level "suites" array)` +
          `\nfirst 200 chars: ${raw.slice(0, 200)}`,
      );
    }

    return parsed as PlaywrightJsonReport;
  } finally {
    // Clean up the tmp dir (and the JSON file inside it) regardless of outcome.
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
};

// ── CLI command registration ─────────────────────────────────────────────────

interface E2eCommandOptions {
  slug?: string;
  backendUrl?: string;
  publicUrl?: string;
  timeout?: string;
  json?: boolean;
}

/**
 * Register the `showcase e2e` subcommand on the Commander program.
 *
 * Mirrors the `registerEvalCommand` idiom in `cli/eval/index.ts`.
 */
export function registerE2eCommand(program: Command): void {
  program
    .command("e2e")
    .description(
      "Run spec-driven D6 verdicts against a live target and emit dashboard rows",
    )
    .option(
      "--slug <slug>",
      "integration slug to run (default: all flagged slugs)",
    )
    .option("--backend-url <url>", "live backend URL (BASE_URL for Playwright)")
    .option(
      "--public-url <url>",
      "fallback public URL when --backend-url is absent",
    )
    .option(
      "--timeout <ms>",
      "per-test timeout passed as --timeout to playwright (ms)",
      "120000",
    )
    .option("--json", "emit JSON summary to stdout instead of human output")
    .action(async (opts: E2eCommandOptions) => {
      await runE2eCommand(opts);
    });
}

// ── CLI action ────────────────────────────────────────────────────────────────

export async function runE2eCommand(opts: E2eCommandOptions): Promise<void> {
  const backendUrl = opts.backendUrl ?? opts.publicUrl;
  if (!backendUrl) {
    console.error(
      "\x1b[31m[showcase e2e]\x1b[0m --backend-url or --public-url is required",
    );
    process.exit(1);
    return; // match siblings — prevents downstream code running in test harnesses that stub process.exit
  }

  // Strict timeout validation: require a bare decimal integer string (no
  // leading/trailing whitespace, no suffix like "s" or ".9", no hex).
  // parseInt("120000abc", 10) === 120000 (silently ignores trailing garbage),
  // so we validate the full string with a strict regex before parsing.
  let timeoutMs: number;
  if (opts.timeout === undefined || opts.timeout === "") {
    timeoutMs = 120_000;
  } else if (!/^\d+$/.test(opts.timeout)) {
    console.error(
      `\x1b[31m[showcase e2e]\x1b[0m --timeout must be a positive integer (ms, no suffix), got: ${opts.timeout}`,
    );
    process.exit(1);
    return; // unreachable; quiets TS control-flow
  } else {
    const parsed = Number(opts.timeout);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      console.error(
        `\x1b[31m[showcase e2e]\x1b[0m --timeout must be a positive integer (ms), got: ${opts.timeout}`,
      );
      process.exit(1);
      return;
    }
    timeoutMs = parsed;
  }

  // Collect slugs to run ──────────────────────────────────────────────────
  let slugsToRun: string[];

  // Always load mapping — needed for both explicit-slug validation and
  // the no-slug discovery path.
  const mapping = await loadDefaultSpecCellMapping();

  if (opts.slug) {
    // Explicit slug: validate it has a mapping entry before proceeding.
    // An unknown slug returns all-zero counts and exits 0 — that is a
    // false-green that hides operator typos. Instead, fail immediately.
    if (
      mapping[opts.slug] == null ||
      Object.keys(mapping[opts.slug]!).length === 0
    ) {
      const knownSlugs = Object.keys(mapping).sort().join(", ");
      console.error(
        `\x1b[31m[showcase e2e]\x1b[0m unknown slug "${opts.slug}" — not found in spec-cell-mapping.\n` +
          `  Known slugs: ${knownSlugs || "(none)"}`,
      );
      process.exit(1);
      return;
    }
    slugsToRun = [opts.slug];
  } else {
    // No explicit slug: discover all slugs via spec-cell-mapping (public API)
    // and filter by isSpecDriven. This avoids the test-only
    // __getSpecDrivenSlugsForTesting() accessor in production code.
    // In Phase 0 isSpecDriven always returns false (empty JSON), so this
    // is a no-op — intentional; wired for Task 5.1.
    slugsToRun = Object.keys(mapping).filter(isSpecDriven);
  }

  if (slugsToRun.length === 0) {
    if (!opts.json) {
      console.log(
        "\n  [showcase e2e] No spec-driven slugs flagged — nothing to run.\n",
      );
    } else {
      // ok: true — zero slugs ran → zero failures → exit 0 is correct.
      // slugErrors: 0 — no slugs attempted, no errors.
      // skipped: 0 — must be present to match the main-path JSON shape
      //              so consumers can parse both paths uniformly.
      // total: 0 — cells only (green + cellsFailed + skipped); slugErrors separate.
      console.log(
        JSON.stringify({
          slugs: [],
          total: 0,
          green: 0,
          cellsFailed: 0,
          skipped: 0,
          slugErrors: 0,
          ok: true,
        }),
      );
    }
    return;
  }

  // Build a minimal ctx for emit. The CLI runs without a PB writer — live
  // emit requires the full PocketBase writer chain from the fleet control
  // plane, which is only available in the cron driver path. Dashboard rows
  // are NOT written by this command; it is a local verdict reporter only.
  if (!opts.json) {
    console.log(
      "  \x1b[33m[e2e]\x1b[0m NOTE: dashboard rows NOT written (no writer configured — CLI mode only)",
    );
  }
  // Build a filtered env for ctx — same secret-filter rule used by the
  // runner env inside runSpecDrivenD6. Passing unfiltered process.env
  // (a) includes undefined-valued keys (unsound cast) and (b) leaks
  // secret-shaped keys into the ProbeContext where driver code can read them.
  // ctx.env is Readonly<Record<string, string | undefined>> per the type, but
  // consumers that treat it as a string map (most drivers) should never see
  // secret values even in CLI mode. Filter using the same rule.
  const filteredEnv: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => v !== undefined && !SECRET_KEY_RE.test(k),
    ) as [string, string][],
  );
  const ctx: ProbeContext = {
    now: () => new Date(),
    logger: log,
    env: filteredEnv,
    writer: undefined,
  };

  // Run each slug ────────────────────────────────────────────────────────
  // Separate slug-level errors (missing dir, thrown exception) from
  // per-cell failures so the JSON totals are coherent.
  let totalGreen = 0;
  let totalCellsFailed = 0;
  let totalSkipped = 0;
  let slugErrors = 0;

  for (const slug of slugsToRun) {
    if (!opts.json) {
      console.log(
        `\n  \x1b[36m[e2e]\x1b[0m running ${slug} against ${backendUrl}`,
      );
    }

    // Resolve integrationDir: showcase/integrations/<slug>
    const showcaseDir =
      process.env["SHOWCASE_DIR"] ?? path.join(process.cwd(), "showcase");
    const integrationDir = path.join(showcaseDir, "integrations", slug);

    if (!fs.existsSync(integrationDir)) {
      log.warn("e2e.integration-dir-missing", { slug, integrationDir });
      console.error(
        `  \x1b[33m[e2e]\x1b[0m integration directory not found: ${integrationDir}`,
      );
      slugErrors++;
      continue;
    }

    // Load the manifest's not_supported_features so NSF cells roll up as
    // SKIPPED (green) rather than UNKNOWN (red). Best-effort: if the
    // manifest is missing or unparseable, we warn and proceed without NSF.
    let notSupportedFeatures: string[] = [];
    const manifestPath = path.join(integrationDir, "manifest.yaml");
    try {
      const raw = fs.readFileSync(manifestPath, "utf-8");
      const parsed = yaml.load(raw, { schema: yaml.JSON_SCHEMA });
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const m = parsed as Record<string, unknown>;
        if (Array.isArray(m["not_supported_features"])) {
          notSupportedFeatures = (
            m["not_supported_features"] as unknown[]
          ).filter((f): f is string => typeof f === "string");
        }
      }
    } catch (manifestErr) {
      log.warn("e2e.manifest-read-failed", {
        slug,
        manifestPath,
        err:
          manifestErr instanceof Error
            ? manifestErr.message
            : String(manifestErr),
      });
    }

    try {
      const result = await runSpecDrivenD6(slug, {
        backendUrl,
        integrationDir,
        timeoutMs,
        notSupportedFeatures,
        ctx,
      });

      totalGreen += result.greenCount;
      totalCellsFailed += result.cellsFailed;
      totalSkipped += result.skippedCount;

      if (!opts.json) {
        const icon =
          result.cellsFailed === 0 ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
        console.log(
          `  ${icon} ${slug}: green=${result.greenCount} failed=${result.cellsFailed} skipped=${result.skippedCount}`,
        );
      }
    } catch (err) {
      log.error("e2e.slug-run-failed", {
        slug,
        err: err instanceof Error ? err.message : String(err),
      });
      console.error(
        `  \x1b[31m[e2e]\x1b[0m ${slug} run failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      slugErrors++;
    }
  }

  // JSON summary uses coherent field names that distinguish slug-level
  // errors from per-cell failures.
  //
  // Fields:
  //   ok          — true iff the exit code would be 0 (cellsFailed === 0 && slugErrors === 0).
  //                 Provides a single machine-readable boolean for CI consumers.
  //   total       — total cells evaluated (greenCount + cellsFailed + skippedCount across all slugs).
  //                 Does NOT include slugErrors (slug-level failures don't produce cells).
  //   slugErrors  — count of slug-level failures (missing dir, runSpecDrivenD6 threw).
  //                 Distinct from per-cell failures; both affect ok/exit-code.
  const ok = totalCellsFailed === 0 && slugErrors === 0;
  if (opts.json) {
    console.log(
      JSON.stringify({
        slugs: slugsToRun,
        total: totalGreen + totalCellsFailed + totalSkipped,
        green: totalGreen,
        cellsFailed: totalCellsFailed,
        skipped: totalSkipped,
        slugErrors,
        ok,
      }),
    );
  } else {
    const totalFailed = totalCellsFailed + slugErrors;
    const overall =
      totalFailed === 0 ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
    console.log(
      `\n  ${overall} — green=${totalGreen} cellsFailed=${totalCellsFailed} skipped=${totalSkipped} slugErrors=${slugErrors}\n`,
    );
  }

  if (totalCellsFailed > 0 || slugErrors > 0) {
    process.exit(1);
  }
}
