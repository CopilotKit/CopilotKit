import { describe, expect, it } from "vitest";

import type { FrontendMatrixCell } from "./frontend-matrix.js";
import type {
  FrontendMatrixArtifact,
  MeasuredShardPlan,
} from "./frontend-matrix-runner.js";
import {
  aggregateFrontendMatrixArtifacts,
  backendUrlsFromRegistry,
  selectFrontendMatrixShard,
} from "./frontend-matrix-ci.js";

const CELLS: FrontendMatrixCell[] = [
  {
    id: "angular/langgraph-python/agentic-chat",
    frontend: "angular",
    integration: "langgraph-python",
    feature: "agentic-chat",
    featureTypes: ["agentic-chat"],
  },
  {
    id: "react/mastra/frontend-tools",
    frontend: "react",
    integration: "mastra",
    feature: "frontend-tools",
    featureTypes: ["frontend-tools"],
  },
];

const PLAN: MeasuredShardPlan = {
  schemaVersion: 1,
  targetDurationMs: 1_500_000,
  estimatedTotalDurationMs: 50_000,
  measuredCellCount: 0,
  defaultedCellCount: 2,
  shards: [
    {
      index: 0,
      estimatedDurationMs: 25_000,
      cellIds: [CELLS[0]!.id],
    },
    {
      index: 1,
      estimatedDurationMs: 25_000,
      cellIds: [CELLS[1]!.id],
    },
  ],
};

function artifact(index: number): FrontendMatrixArtifact {
  const cell = CELLS[index]!;
  return {
    schemaVersion: 1,
    sourceCommit: "abc123",
    containerImageRevision: "sha256:image",
    fixtureRevision: "fixture123",
    featureContractRevision: "contract123",
    shard: { index, count: 2 },
    startedAt: `2026-07-21T00:00:0${index}.000Z`,
    finishedAt: `2026-07-21T00:00:0${index + 1}.000Z`,
    summary: {
      total: 1,
      passed: 1,
      failed: 0,
      p95CellDurationMs: 500,
    },
    cells: [
      {
        cellId: cell.id,
        frontend: cell.frontend,
        integration: cell.integration,
        feature: cell.feature,
        sourceCommit: "abc123",
        containerImageRevision: "sha256:image",
        fixtureRevision: "fixture123",
        featureContractRevision: "contract123",
        testIds: [`fm-${index}`],
        status: "passed",
        durationMs: 500,
        url: `https://example.test/${cell.feature}`,
        backendUrl: `https://${cell.integration}.example.test`,
        probes: [
          {
            featureType: cell.featureTypes[0]!,
            status: "passed",
            durationMs: 500,
            testId: `fm-${index}`,
          },
        ],
      },
    ],
  };
}

describe("frontend matrix CI contracts", () => {
  it("selects an exact shard only after validating complete plan coverage", () => {
    expect(selectFrontendMatrixShard(CELLS, PLAN, 1)).toEqual([CELLS[1]]);
    expect(() =>
      selectFrontendMatrixShard(
        CELLS,
        {
          ...PLAN,
          shards: [{ ...PLAN.shards[0]!, cellIds: ["unknown/cell"] }],
        },
        0,
      ),
    ).toThrow(/unknown.*cell/i);
  });

  it("derives only canonical HTTPS backend roots", () => {
    expect(
      backendUrlsFromRegistry({
        integrations: [
          {
            slug: "langgraph-python",
            backend_url:
              "https://showcase-langgraph-python-production.up.railway.app",
          },
        ],
      }),
    ).toEqual({
      "langgraph-python":
        "https://showcase-langgraph-python-production.up.railway.app",
    });
    expect(() =>
      backendUrlsFromRegistry({
        integrations: [
          { slug: "bad", backend_url: "http://127.0.0.1:8000/path" },
        ],
      }),
    ).toThrow(/canonical HTTPS root/i);
  });

  it("aggregates exact cell identities and produces measured timings", () => {
    const report = aggregateFrontendMatrixArtifacts(CELLS, [
      artifact(1),
      artifact(0),
    ]);

    expect(report.summary).toMatchObject({
      total: 2,
      passed: 2,
      failed: 0,
      p95ShardWallTimeMs: 1000,
    });
    expect(report.cells.map((cell) => cell.cellId)).toEqual(
      CELLS.map((cell) => cell.id).sort(),
    );
    expect(report.measurements.cellDurationsMs).toEqual({
      [CELLS[0]!.id]: 500,
      [CELLS[1]!.id]: 500,
    });
  });

  it("aggregates independent per-integration image shard groups", () => {
    const first = artifact(0);
    first.shard = { index: 0, count: 1 };
    first.containerImageRevision = "sha256:langgraph";
    first.cells[0]!.containerImageRevision = "sha256:langgraph";
    const second = artifact(1);
    second.shard = { index: 0, count: 1 };
    second.containerImageRevision = "sha256:mastra";
    second.cells[0]!.containerImageRevision = "sha256:mastra";

    const report = aggregateFrontendMatrixArtifacts(CELLS, [first, second]);

    expect(report.summary).toMatchObject({ total: 2, shardCount: 2 });
  });

  it("fails closed on duplicate, missing, or mismatched artifact identities", () => {
    const duplicateCell = artifact(1);
    duplicateCell.cells = artifact(0).cells;
    expect(() =>
      aggregateFrontendMatrixArtifacts(CELLS, [artifact(0), duplicateCell]),
    ).toThrow(/duplicate.*angular\/langgraph-python\/agentic-chat/i);

    const wrong = artifact(0);
    wrong.cells[0] = { ...wrong.cells[0]!, frontend: "react" };
    expect(() =>
      aggregateFrontendMatrixArtifacts(CELLS, [wrong, artifact(1)]),
    ).toThrow(/identity.*angular\/langgraph-python\/agentic-chat/i);
  });
});
