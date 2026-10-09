import { describe, expect, it, vi } from "vitest";

import type { FrontendMatrixCell } from "./frontend-matrix.js";
import {
  buildMeasuredShardPlan,
  createFrontendMatrixArtifact,
  executeFrontendMatrixShard,
  mergeFrontendMatrixShardArtifacts,
  percentile,
} from "./frontend-matrix-runner.js";
import type { FrontendCellExecutor } from "./frontend-matrix-runner.js";

const CELLS: FrontendMatrixCell[] = [
  {
    id: "angular/langgraph-python/beautiful-chat",
    frontend: "angular",
    integration: "langgraph-python",
    feature: "beautiful-chat",
    featureTypes: ["beautiful-chat-toggle-theme", "beautiful-chat-pie-chart"],
  },
  {
    id: "react/mastra/agentic-chat",
    frontend: "react",
    integration: "mastra",
    feature: "agentic-chat",
    featureTypes: ["agentic-chat"],
  },
  {
    id: "angular/mastra/frontend-tools",
    frontend: "angular",
    integration: "mastra",
    feature: "frontend-tools",
    featureTypes: ["frontend-tools"],
  },
];

const PAIRED_CELLS: FrontendMatrixCell[] = [
  ...CELLS,
  {
    id: "react/langgraph-python/beautiful-chat",
    frontend: "react",
    integration: "langgraph-python",
    feature: "beautiful-chat",
    featureTypes: ["beautiful-chat-toggle-theme", "beautiful-chat-pie-chart"],
  },
  {
    id: "react/mastra/frontend-tools",
    frontend: "react",
    integration: "mastra",
    feature: "frontend-tools",
    featureTypes: ["frontend-tools"],
  },
  {
    id: "angular/mastra/agentic-chat",
    frontend: "angular",
    integration: "mastra",
    feature: "agentic-chat",
    featureTypes: ["agentic-chat"],
  },
];

describe("frontend matrix CI runner", () => {
  it("builds a deterministic duration-balanced shard plan", () => {
    const first = buildMeasuredShardPlan(CELLS, {
      targetDurationMs: 60_000,
      minimumShardCount: 2,
      maximumShardCount: 8,
      defaultProbeDurationMs: 20_000,
      measuredCellDurationsMs: {
        "angular/langgraph-python/beautiful-chat": 50_000,
        "react/mastra/agentic-chat": 10_000,
        "angular/mastra/frontend-tools": 10_000,
      },
    });
    const second = buildMeasuredShardPlan(CELLS, {
      targetDurationMs: 60_000,
      minimumShardCount: 2,
      maximumShardCount: 8,
      defaultProbeDurationMs: 20_000,
      measuredCellDurationsMs: {
        "angular/langgraph-python/beautiful-chat": 50_000,
        "react/mastra/agentic-chat": 10_000,
        "angular/mastra/frontend-tools": 10_000,
      },
    });

    expect(first).toEqual(second);
    expect(first.shards).toHaveLength(2);
    expect(first.shards.flatMap((shard) => shard.cellIds).sort()).toEqual(
      CELLS.map((cell) => cell.id).sort(),
    );
    expect(first.shards[0]?.estimatedDurationMs).toBe(50_000);
    expect(first.shards[1]?.estimatedDurationMs).toBe(20_000);
  });

  it("keeps React and Angular counterparts adjacent on one shard", () => {
    const plan = buildMeasuredShardPlan(PAIRED_CELLS, {
      targetDurationMs: 40_000,
      minimumShardCount: 2,
      maximumShardCount: 2,
      defaultProbeDurationMs: 10_000,
      measuredCellDurationsMs: {},
    });

    const pairOrders: string[][] = [];
    for (const feature of [
      "beautiful-chat",
      "frontend-tools",
      "agentic-chat",
    ]) {
      const ids = PAIRED_CELLS.filter((cell) => cell.feature === feature).map(
        (cell) => cell.id,
      );
      const containing = plan.shards.filter((shard) =>
        ids.every((id) => shard.cellIds.includes(id)),
      );
      expect(containing).toHaveLength(1);
      const shard = containing[0]!;
      const positions = ids.map((id) => shard.cellIds.indexOf(id)).sort();
      expect(positions[1]! - positions[0]!).toBe(1);
      pairOrders.push(shard.cellIds.slice(positions[0], positions[1]! + 1));
    }

    expect(pairOrders.some((ids) => ids[0]?.startsWith("angular/"))).toBe(true);
    expect(pairOrders.some((ids) => ids[0]?.startsWith("react/"))).toBe(true);
  });

  it("executes every cell once and never retries a deterministic failure", async () => {
    const onResult = vi.fn();
    const execute: FrontendCellExecutor = vi
      .fn<FrontendCellExecutor>()
      .mockResolvedValueOnce({
        status: "failed",
        durationMs: 12,
        probes: [
          {
            featureType: "beautiful-chat-toggle-theme",
            status: "failed",
            durationMs: 12,
            testId: "matrix-angular-langgraph-python-beautiful-chat-0",
            errorClass: "conversation-error",
            error: "deterministic assertion failed",
          },
        ],
      })
      .mockResolvedValueOnce({
        status: "passed",
        durationMs: 8,
        probes: [
          {
            featureType: "agentic-chat",
            status: "passed",
            durationMs: 8,
            testId: "matrix-react-mastra-agentic-chat-0",
          },
        ],
      });

    const results = await executeFrontendMatrixShard(CELLS.slice(0, 2), {
      concurrency: 2,
      execute,
      onResult,
    });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(results.map((result) => result.cell.id).sort()).toEqual(
      CELLS.slice(0, 2)
        .map((cell) => cell.id)
        .sort(),
    );
    expect(results[0]?.status).toBe("failed");
    expect(onResult).toHaveBeenCalledTimes(2);
  });

  it("emits exact frontend cell identities and p95 timing", () => {
    const artifact = createFrontendMatrixArtifact({
      sourceCommit: "abc123",
      containerImageRevision: "sha256:image",
      fixtureRevision: "fixture123",
      featureContractRevision: "contract123",
      shardIndex: 0,
      shardCount: 1,
      startedAt: "2026-07-21T00:00:00.000Z",
      finishedAt: "2026-07-21T00:00:01.000Z",
      results: CELLS.map((cell, index) => ({
        cell,
        status: "passed" as const,
        durationMs: index + 1,
        url: `https://example.test/${cell.id}`,
        backendUrl: `https://${cell.integration}.example.test`,
        probes: cell.featureTypes.map((featureType) => ({
          featureType,
          status: "passed" as const,
          durationMs: index + 1,
          testId: `matrix-${index}`,
        })),
      })),
    });

    expect(artifact.schemaVersion).toBe(1);
    expect(artifact.cells).toHaveLength(3);
    expect(artifact.cells[0]?.frontend).toBe("angular");
    expect(artifact.cells[0]).toMatchObject({
      sourceCommit: "abc123",
      containerImageRevision: "sha256:image",
      fixtureRevision: "fixture123",
      featureContractRevision: "contract123",
      testIds: ["matrix-0", "matrix-0"],
    });
    expect(artifact.cells[0]?.cellId).toBe(
      "angular/langgraph-python/beautiful-chat",
    );
    expect(artifact.summary.passed).toBe(3);
    expect(artifact.summary.failed).toBe(0);
    expect(artifact.summary.p95CellDurationMs).toBe(3);
    expect(percentile([10, 20, 30, 40], 0.95)).toBe(40);
  });

  it("merges isolated frontend phases into one logical shard", () => {
    const createPhase = (
      cell: FrontendMatrixCell,
      startedAt: string,
      finishedAt: string,
    ) =>
      createFrontendMatrixArtifact({
        sourceCommit: "abc123",
        containerImageRevision: "sha256:image",
        fixtureRevision: "fixture123",
        featureContractRevision: "contract123",
        shardIndex: 1,
        shardCount: 4,
        startedAt,
        finishedAt,
        results: [
          {
            cell,
            status: "passed",
            durationMs: 10,
            probes: cell.featureTypes.map((featureType, index) => ({
              featureType,
              status: "passed",
              durationMs: 10,
              testId: `phase-${cell.frontend}-${index}`,
            })),
          },
        ],
      });

    const react = PAIRED_CELLS.find(
      (cell) => cell.frontend === "react" && cell.feature === "beautiful-chat",
    )!;
    const angular = PAIRED_CELLS.find(
      (cell) =>
        cell.frontend === "angular" && cell.feature === "beautiful-chat",
    )!;
    const merged = mergeFrontendMatrixShardArtifacts([
      createPhase(
        react,
        "2026-07-23T01:00:00.000Z",
        "2026-07-23T01:01:00.000Z",
      ),
      createPhase(
        angular,
        "2026-07-23T01:02:00.000Z",
        "2026-07-23T01:03:00.000Z",
      ),
    ]);

    expect(merged.startedAt).toBe("2026-07-23T01:00:00.000Z");
    expect(merged.finishedAt).toBe("2026-07-23T01:03:00.000Z");
    expect(merged.summary).toMatchObject({ total: 2, passed: 2, failed: 0 });
    expect(merged.cells.map((cell) => cell.frontend)).toEqual([
      "react",
      "angular",
    ]);
  });

  it("rejects overlapping frontend phase evidence", () => {
    const phase = createFrontendMatrixArtifact({
      sourceCommit: "abc123",
      containerImageRevision: "sha256:image",
      fixtureRevision: "fixture123",
      featureContractRevision: "contract123",
      shardIndex: 0,
      shardCount: 1,
      startedAt: "2026-07-23T01:00:00.000Z",
      finishedAt: "2026-07-23T01:01:00.000Z",
      results: [
        {
          cell: CELLS[0]!,
          status: "passed",
          durationMs: 10,
          probes: [],
        },
      ],
    });

    expect(() => mergeFrontendMatrixShardArtifacts([phase, phase])).toThrow(
      /duplicate frontend phase cell/i,
    );
  });

  it("removes page content, runtime URLs, and diagnostics from CI evidence", () => {
    const cell = CELLS[1]!;
    const artifact = createFrontendMatrixArtifact({
      sourceCommit: "abc123",
      containerImageRevision: "sha256:image",
      fixtureRevision: "fixture123",
      featureContractRevision: "contract123",
      shardIndex: 0,
      shardCount: 1,
      startedAt: "2026-07-21T00:00:00.000Z",
      finishedAt: "2026-07-21T00:00:01.000Z",
      results: [
        {
          cell,
          status: "failed",
          durationMs: 500,
          url: "https://example.test/angular/agentic-chat?token=secret",
          backendUrl: "https://backend.example.test?key=secret",
          errorClass: "probe-failed",
          error: "prompt and provider secret",
          diagnostics: { pageBody: "generated response" },
          probes: [
            {
              featureType: cell.featureTypes[0]!,
              status: "failed",
              durationMs: 500,
              testId: "fm-private",
              errorClass: "assertion",
              failureReason: "settle-dom-missing",
              error: "tool payload",
              diagnostics: { fixture: "private fixture content" },
            },
          ],
        },
      ],
    });

    expect(artifact.cells[0]).toEqual({
      cellId: cell.id,
      frontend: cell.frontend,
      integration: cell.integration,
      feature: cell.feature,
      sourceCommit: "abc123",
      containerImageRevision: "sha256:image",
      fixtureRevision: "fixture123",
      featureContractRevision: "contract123",
      testIds: ["fm-private"],
      status: "failed",
      durationMs: 500,
      errorClass: "probe-failed",
      probes: [
        {
          featureType: cell.featureTypes[0]!,
          status: "failed",
          durationMs: 500,
          testId: "fm-private",
          errorClass: "assertion",
          failureReason: "settle-dom-missing",
        },
      ],
    });
    expect(JSON.stringify(artifact)).not.toMatch(
      /secret|prompt|response|payload|fixture content|example\.test/,
    );
  });
});
