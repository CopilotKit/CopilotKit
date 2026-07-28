import type { D5FeatureType } from "./helpers/d5-registry.js";
import type {
  FrontendMatrixCell,
  RunnableFrontend,
} from "./frontend-matrix.js";

export type FrontendProbeStatus = "passed" | "failed";

export interface FrontendProbeResult {
  featureType: D5FeatureType;
  status: FrontendProbeStatus;
  durationMs: number;
  testId: string;
  errorClass?: string;
  error?: string;
  diagnostics?: Record<string, unknown>;
}

export interface FrontendCellExecutionResult {
  status: FrontendProbeStatus;
  durationMs: number;
  probes: FrontendProbeResult[];
  url?: string;
  backendUrl?: string;
  errorClass?: string;
  error?: string;
  diagnostics?: Record<string, unknown>;
}

export interface FrontendCellResult extends FrontendCellExecutionResult {
  cell: FrontendMatrixCell;
}

export type FrontendCellExecutor = (
  cell: FrontendMatrixCell,
) => Promise<FrontendCellExecutionResult>;

export interface MeasuredShard {
  index: number;
  estimatedDurationMs: number;
  cellIds: string[];
}

export interface MeasuredShardPlan {
  schemaVersion: 1;
  targetDurationMs: number;
  estimatedTotalDurationMs: number;
  measuredCellCount: number;
  defaultedCellCount: number;
  shards: MeasuredShard[];
}

export interface MeasuredShardPlanOptions {
  targetDurationMs: number;
  minimumShardCount: number;
  maximumShardCount: number;
  defaultProbeDurationMs: number;
  measuredCellDurationsMs: Readonly<Record<string, number>>;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function estimatedCellDurationMs(
  cell: FrontendMatrixCell,
  options: MeasuredShardPlanOptions,
): { durationMs: number; measured: boolean } {
  const measured = options.measuredCellDurationsMs[cell.id];
  if (Number.isFinite(measured) && measured !== undefined && measured > 0) {
    return { durationMs: Math.ceil(measured), measured: true };
  }
  return {
    durationMs: cell.featureTypes.length * options.defaultProbeDurationMs,
    measured: false,
  };
}

/**
 * Build a deterministic least-loaded shard plan from recorded cell timings.
 * Unmeasured cells use a conservative per-probe estimate so new catalog cells
 * participate immediately instead of disappearing from the merge gate.
 */
export function buildMeasuredShardPlan(
  cells: readonly FrontendMatrixCell[],
  options: MeasuredShardPlanOptions,
): MeasuredShardPlan {
  const targetDurationMs = positiveInteger(
    options.targetDurationMs,
    "targetDurationMs",
  );
  const minimumShardCount = positiveInteger(
    options.minimumShardCount,
    "minimumShardCount",
  );
  const maximumShardCount = positiveInteger(
    options.maximumShardCount,
    "maximumShardCount",
  );
  const defaultProbeDurationMs = positiveInteger(
    options.defaultProbeDurationMs,
    "defaultProbeDurationMs",
  );
  if (minimumShardCount > maximumShardCount) {
    throw new Error("minimumShardCount cannot exceed maximumShardCount");
  }

  const weighted = cells.map((cell) => ({
    cell,
    ...estimatedCellDurationMs(cell, {
      ...options,
      targetDurationMs,
      minimumShardCount,
      maximumShardCount,
      defaultProbeDurationMs,
    }),
  }));
  const estimatedTotalDurationMs = weighted.reduce(
    (total, item) => total + item.durationMs,
    0,
  );
  const desiredShardCount = Math.max(
    minimumShardCount,
    Math.ceil(estimatedTotalDurationMs / targetDurationMs),
  );
  const shardCount =
    cells.length === 0
      ? 0
      : Math.min(cells.length, maximumShardCount, desiredShardCount);
  const shards = Array.from(
    { length: shardCount },
    (_, index): MeasuredShard => ({
      index,
      estimatedDurationMs: 0,
      cellIds: [],
    }),
  );

  weighted
    .sort(
      (left, right) =>
        right.durationMs - left.durationMs ||
        left.cell.id.localeCompare(right.cell.id),
    )
    .forEach(({ cell, durationMs }) => {
      const target = [...shards].sort(
        (left, right) =>
          left.estimatedDurationMs - right.estimatedDurationMs ||
          left.index - right.index,
      )[0];
      if (!target) throw new Error("cannot assign a cell without a shard");
      target.cellIds.push(cell.id);
      target.estimatedDurationMs += durationMs;
    });

  for (const shard of shards) shard.cellIds.sort();
  return {
    schemaVersion: 1,
    targetDurationMs,
    estimatedTotalDurationMs,
    measuredCellCount: weighted.filter((item) => item.measured).length,
    defaultedCellCount: weighted.filter((item) => !item.measured).length,
    shards,
  };
}

/** Execute a shard with bounded concurrency and no deterministic retries. */
export async function executeFrontendMatrixShard(
  cells: readonly FrontendMatrixCell[],
  options: {
    concurrency: number;
    execute: FrontendCellExecutor;
    onResult?: (result: FrontendCellResult) => void;
  },
): Promise<FrontendCellResult[]> {
  const concurrency = positiveInteger(options.concurrency, "concurrency");
  const results: Array<FrontendCellResult | undefined> = Array.from(
    { length: cells.length },
    () => undefined,
  );
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const cell = cells[index];
      if (!cell) return;
      try {
        results[index] = { cell, ...(await options.execute(cell)) };
      } catch (error) {
        results[index] = {
          cell,
          status: "failed",
          durationMs: 0,
          probes: [],
          errorClass: "executor-error",
          error: error instanceof Error ? error.message : String(error),
        };
      }
      options.onResult?.(results[index]);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, cells.length) }, worker),
  );
  return results.map((result, index) => {
    if (!result) {
      throw new Error(`matrix worker did not produce result ${index}`);
    }
    return result;
  });
}

/** Compute the nearest-rank percentile for non-negative timings. */
export function percentile(
  values: readonly number[],
  quantile: number,
): number {
  if (values.length === 0) return 0;
  if (!Number.isFinite(quantile) || quantile <= 0 || quantile > 1) {
    throw new Error("quantile must be greater than zero and at most one");
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * quantile) - 1] ?? 0;
}

export interface FrontendMatrixArtifactInput {
  sourceCommit: string;
  containerImageRevision: string;
  fixtureRevision: string;
  featureContractRevision: string;
  shardIndex: number;
  shardCount: number;
  startedAt: string;
  finishedAt: string;
  results: readonly FrontendCellResult[];
}

export interface FrontendMatrixArtifactProbe {
  featureType: D5FeatureType;
  status: FrontendProbeStatus;
  durationMs: number;
  testId: string;
  errorClass?: string;
}

export interface FrontendMatrixArtifactCell {
  cellId: string;
  frontend: RunnableFrontend;
  integration: string;
  feature: string;
  sourceCommit: string;
  containerImageRevision: string;
  fixtureRevision: string;
  featureContractRevision: string;
  testIds: string[];
  status: FrontendProbeStatus;
  durationMs: number;
  probes: FrontendMatrixArtifactProbe[];
  errorClass?: string;
}

export interface FrontendMatrixArtifact {
  schemaVersion: 1;
  sourceCommit: string;
  containerImageRevision: string;
  fixtureRevision: string;
  featureContractRevision: string;
  shard: { index: number; count: number };
  startedAt: string;
  finishedAt: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    p95CellDurationMs: number;
  };
  cells: FrontendMatrixArtifactCell[];
}

/** Shape the stable, frontend-aware JSON contract uploaded by each CI shard. */
export function createFrontendMatrixArtifact(
  input: FrontendMatrixArtifactInput,
): FrontendMatrixArtifact {
  const cells = input.results.map(
    ({ cell, ...result }): FrontendMatrixArtifactCell => {
      const probes = result.probes.map(
        (probe): FrontendMatrixArtifactProbe => ({
          featureType: probe.featureType,
          status: probe.status,
          durationMs: probe.durationMs,
          testId: probe.testId,
          ...(probe.errorClass === undefined
            ? {}
            : { errorClass: probe.errorClass }),
        }),
      );
      return {
        cellId: cell.id,
        frontend: cell.frontend,
        integration: cell.integration,
        feature: cell.feature,
        sourceCommit: input.sourceCommit,
        containerImageRevision: input.containerImageRevision,
        fixtureRevision: input.fixtureRevision,
        featureContractRevision: input.featureContractRevision,
        testIds: probes.map((probe) => probe.testId),
        status: result.status,
        durationMs: result.durationMs,
        probes,
        ...(result.errorClass === undefined
          ? {}
          : { errorClass: result.errorClass }),
      };
    },
  );
  return {
    schemaVersion: 1,
    sourceCommit: input.sourceCommit,
    containerImageRevision: input.containerImageRevision,
    fixtureRevision: input.fixtureRevision,
    featureContractRevision: input.featureContractRevision,
    shard: { index: input.shardIndex, count: input.shardCount },
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    summary: {
      total: cells.length,
      passed: cells.filter((cell) => cell.status === "passed").length,
      failed: cells.filter((cell) => cell.status === "failed").length,
      p95CellDurationMs: percentile(
        cells.map((cell) => cell.durationMs),
        0.95,
      ),
    },
    cells,
  };
}
