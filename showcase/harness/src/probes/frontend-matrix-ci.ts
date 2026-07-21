import type { FrontendMatrixCell } from "./frontend-matrix.js";
import type {
  FrontendMatrixArtifact,
  FrontendMatrixArtifactCell,
  MeasuredShardPlan,
} from "./frontend-matrix-runner.js";
import { percentile } from "./frontend-matrix-runner.js";

interface ShowcaseRegistryInput {
  integrations: Array<{ slug: string; backend_url: string }>;
}

/** Derive the fixed integration-to-origin map consumed by matrix execution. */
export function backendUrlsFromRegistry(
  registry: ShowcaseRegistryInput,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const integration of registry.integrations) {
    if (result[integration.slug]) {
      throw new Error(`duplicate integration slug ${integration.slug}`);
    }
    let url: URL;
    try {
      url = new URL(integration.backend_url);
    } catch {
      throw new Error(
        `integration ${integration.slug} backend_url must be a canonical HTTPS root`,
      );
    }
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      throw new Error(
        `integration ${integration.slug} backend_url must be a canonical HTTPS root`,
      );
    }
    result[integration.slug] = url.href.replace(/\/$/, "");
  }
  return result;
}

function matrixById(
  matrix: readonly FrontendMatrixCell[],
): Map<string, FrontendMatrixCell> {
  const byId = new Map<string, FrontendMatrixCell>();
  for (const cell of matrix) {
    if (byId.has(cell.id)) throw new Error(`duplicate matrix cell ${cell.id}`);
    byId.set(cell.id, cell);
  }
  return byId;
}

/** Validate a persisted plan against today's catalog before selecting a shard. */
export function selectFrontendMatrixShard(
  matrix: readonly FrontendMatrixCell[],
  plan: MeasuredShardPlan,
  shardIndex: number,
): FrontendMatrixCell[] {
  const byId = matrixById(matrix);
  const selected = plan.shards.find((shard) => shard.index === shardIndex);
  if (!selected) throw new Error(`unknown shard index ${shardIndex}`);

  const planned = new Set<string>();
  for (const [position, shard] of plan.shards.entries()) {
    if (shard.index !== position) {
      throw new Error(
        `shard index ${shard.index} must equal position ${position}`,
      );
    }
    for (const cellId of shard.cellIds) {
      if (!byId.has(cellId)) throw new Error(`unknown planned cell ${cellId}`);
      if (planned.has(cellId))
        throw new Error(`duplicate planned cell ${cellId}`);
      planned.add(cellId);
    }
  }
  const missing = [...byId.keys()].filter((cellId) => !planned.has(cellId));
  if (missing.length > 0) {
    throw new Error(
      `matrix plan is missing ${missing.length} cells: ${missing[0]}`,
    );
  }

  return selected.cellIds.map((cellId) => byId.get(cellId)!);
}

export interface FrontendMatrixAggregateReport {
  schemaVersion: 1;
  commitSha: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    shardCount: number;
    p95CellDurationMs: number;
    p95ShardWallTimeMs: number;
  };
  cells: FrontendMatrixArtifactCell[];
  measurements: {
    schemaVersion: 1;
    cellDurationsMs: Record<string, number>;
    p95ShardWallTimeMs: number;
  };
}

function assertCellIdentity(
  expected: FrontendMatrixCell,
  actual: FrontendMatrixArtifactCell,
): void {
  if (
    actual.frontend !== expected.frontend ||
    actual.integration !== expected.integration ||
    actual.feature !== expected.feature
  ) {
    throw new Error(`artifact identity mismatch for ${expected.id}`);
  }
  const expectedProbes = [...expected.featureTypes].sort();
  const actualProbes = actual.probes.map((probe) => probe.featureType).sort();
  if (
    actualProbes.length !== expectedProbes.length ||
    actualProbes.some(
      (featureType, index) => featureType !== expectedProbes[index],
    )
  ) {
    throw new Error(`artifact probe identity mismatch for ${expected.id}`);
  }
}

/**
 * Merge all shard artifacts and fail closed unless every catalog cell and
 * mapped probe appears exactly once with its enumerated frontend identity.
 */
export function aggregateFrontendMatrixArtifacts(
  matrix: readonly FrontendMatrixCell[],
  artifacts: readonly FrontendMatrixArtifact[],
): FrontendMatrixAggregateReport {
  if (artifacts.length === 0) throw new Error("no matrix artifacts found");
  const byId = matrixById(matrix);
  const shardCount = artifacts[0]!.shard.count;
  const commitSha = artifacts[0]!.commitSha;
  const shardIndexes = new Set<number>();
  const cells = new Map<string, FrontendMatrixArtifactCell>();
  const shardWallTimes: number[] = [];

  for (const artifact of artifacts) {
    if (artifact.schemaVersion !== 1) {
      throw new Error(`unsupported artifact schema ${artifact.schemaVersion}`);
    }
    if (
      artifact.shard.count !== shardCount ||
      artifact.commitSha !== commitSha
    ) {
      throw new Error("matrix artifacts came from different runs");
    }
    if (shardIndexes.has(artifact.shard.index)) {
      throw new Error(`duplicate shard artifact ${artifact.shard.index}`);
    }
    shardIndexes.add(artifact.shard.index);
    const startedAt = Date.parse(artifact.startedAt);
    const finishedAt = Date.parse(artifact.finishedAt);
    if (
      !Number.isFinite(startedAt) ||
      !Number.isFinite(finishedAt) ||
      finishedAt < startedAt
    ) {
      throw new Error(`invalid timestamps for shard ${artifact.shard.index}`);
    }
    shardWallTimes.push(finishedAt - startedAt);

    for (const cell of artifact.cells) {
      const expected = byId.get(cell.cellId);
      if (!expected) throw new Error(`unknown artifact cell ${cell.cellId}`);
      if (cells.has(cell.cellId)) {
        throw new Error(`duplicate artifact cell ${cell.cellId}`);
      }
      assertCellIdentity(expected, cell);
      cells.set(cell.cellId, cell);
    }
  }

  if (artifacts.length !== shardCount || shardIndexes.size !== shardCount) {
    throw new Error(
      `expected ${shardCount} shard artifacts; found ${artifacts.length}`,
    );
  }
  for (let index = 0; index < shardCount; index += 1) {
    if (!shardIndexes.has(index))
      throw new Error(`missing shard artifact ${index}`);
  }
  const missing = [...byId.keys()].filter((cellId) => !cells.has(cellId));
  if (missing.length > 0) {
    throw new Error(
      `matrix artifacts are missing ${missing.length} cells: ${missing[0]}`,
    );
  }

  const sortedCells = [...cells.values()].sort((left, right) =>
    left.cellId.localeCompare(right.cellId),
  );
  const failed = sortedCells.filter((cell) => cell.status === "failed").length;
  const p95ShardWallTimeMs = percentile(shardWallTimes, 0.95);
  return {
    schemaVersion: 1,
    commitSha,
    summary: {
      total: sortedCells.length,
      passed: sortedCells.length - failed,
      failed,
      shardCount,
      p95CellDurationMs: percentile(
        sortedCells.map((cell) => cell.durationMs),
        0.95,
      ),
      p95ShardWallTimeMs,
    },
    cells: sortedCells,
    measurements: {
      schemaVersion: 1,
      cellDurationsMs: Object.fromEntries(
        sortedCells.map((cell) => [cell.cellId, cell.durationMs]),
      ),
      p95ShardWallTimeMs,
    },
  };
}
