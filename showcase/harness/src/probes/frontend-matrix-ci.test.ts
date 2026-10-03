import { describe, expect, it } from "vitest";
import { FRONTEND_TOOLS_CANONICAL } from "../shared/cell-model/live-status.js";
import { testIdForFrontendProbe } from "./frontend-matrix-playwright.js";

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
  it.each(["react", "angular"] as const)(
    "preserves a qualified %s receipt and rejects a different image or run",
    (frontend) => {
      const planned = {
        ...CELLS[1]!,
        frontend,
        id: `${frontend}/mastra/frontend-tools`,
      };
      const saved = artifact(1);
      saved.shard = { index: 0, count: 1 };
      saved.startedAt = "2026-07-21T00:00:00.000Z";
      saved.finishedAt = "2026-07-21T00:00:08.000Z";
      saved.containerImageRevision = `sha256:${"a".repeat(64)}`;
      const cell = saved.cells[0]!;
      Object.assign(cell, {
        cellId: planned.id,
        frontend,
        containerImageRevision: saved.containerImageRevision,
      });
      const probe = cell.probes[0]!;
      const canonical = FRONTEND_TOOLS_CANONICAL;
      probe.testId = testIdForFrontendProbe(planned, "frontend-tools", "run-1");
      cell.testIds = [probe.testId];
      probe.functional = {
        disposition: "completed",
        attempts: 1,
        canonicalId: canonical.id,
        assertionId: canonical.assertionId,
        requiredActionIds: [...canonical.requiredActionIds],
        attemptedActionIds: [...canonical.requiredActionIds],
        successfulActionIds: [...canonical.requiredActionIds],
        binding: {
          key: "d6:mastra/frontend-tools",
          observedAt: saved.finishedAt,
          runId: "run-1",
          frontend,
          targetRevision: saved.containerImageRevision,
          canonicalRevision: canonical.id,
          outerUrl: `https://shell.test/${frontend}/mastra/frontend-tools/preview`,
          iframeUrl: `https://mastra.test/${frontend === "react" ? "demos" : "angular"}/frontend-tools`,
        },
        actions: canonical.actions.map((action, i) => ({
          actionId: action.id,
          label: action.label,
          prompt: action.prompt,
          dispatch: true,
          terminal: true,
          result: true,
          emittedMessageId: `message-${i}`,
          terminalMessageId: `message-${i}`,
          runId: `turn-${i}`,
          threadId: "thread",
          startedAt: new Date(
            Date.parse(saved.startedAt) + i * 2000,
          ).toISOString(),
          completedAt: new Date(
            Date.parse(saved.startedAt) + i * 2000 + 1000,
          ).toISOString(),
        })),
      };
      expect(
        aggregateFrontendMatrixArtifacts([planned], [saved]).summary,
      ).toMatchObject({ passed: 1, failed: 0, unverified: 0 });
      probe.functional.binding!.targetRevision = `sha256:${"b".repeat(64)}`;
      expect(
        aggregateFrontendMatrixArtifacts([planned], [saved]).summary.unverified,
      ).toBe(1);
      probe.functional.binding!.targetRevision = saved.containerImageRevision;
      probe.functional.binding!.runId = "different-run";
      expect(
        aggregateFrontendMatrixArtifacts([planned], [saved]).summary.unverified,
      ).toBe(1);
      expect(probe.status).toBe("passed");
    },
  );
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
      passed: 0,
      failed: 0,
      unverified: 2,
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

it("functional admission projects diagnostic positives as unverified without mutating artifacts", () => {
  const originals = [artifact(0), artifact(1)];
  const result = aggregateFrontendMatrixArtifacts(CELLS, originals);
  expect(result.cells.every((cell) => cell.status === "unverified")).toBe(true);
  expect(
    originals.every((source) => source.cells[0]?.status === "passed"),
  ).toBe(true);
});

it("functional admission denies an empty program while retaining a genuine failed cell", () => {
  const empty = artifact(0);
  empty.cells[0]!.probes = [];
  const failed = artifact(1);
  failed.cells[0]!.status = "failed";
  failed.cells[0]!.probes[0]!.status = "failed";
  expect(() =>
    aggregateFrontendMatrixArtifacts(CELLS, [empty, failed]),
  ).toThrow(/probe identity mismatch/);
  expect(
    aggregateFrontendMatrixArtifacts(CELLS, [artifact(0), failed]).summary,
  ).toMatchObject({ total: 2, passed: 0, failed: 1, unverified: 1 });
});
