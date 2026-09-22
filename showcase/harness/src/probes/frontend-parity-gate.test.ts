import { describe, expect, it } from "vitest";

import {
  evaluateCurrentFrontendParity,
  evaluateFrontendParity,
  frontendParityCellsFromAggregate,
} from "./frontend-parity-gate.js";
import type {
  AcceptedBaselineFailure,
  FrontendParityCell,
} from "./frontend-parity-gate.js";

const BASE_COMMIT = "1111111111111111111111111111111111111111";
const PR_COMMIT = "2222222222222222222222222222222222222222";
const IMAGE =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const FIXTURE = "3333333333333333333333333333333333333333";
const CONTRACT = "4444444444444444444444444444444444444444";

// Synthetic admission contract only; real browser proof is recorded separately.
function syntheticPillProof(frontend: "react" | "angular") {
  return {
    mode: "functional-pill",
    surface: "public",
    completed: true,
    attempts: 1,
    failures: [],
    startedAt: "2026-09-21T00:00:00Z",
    completedAt: "2026-09-21T00:00:01Z",
    identity: {
      canonical: "agentic-chat",
      integration: "mastra",
      frontend,
      targetRevision: IMAGE,
      canonicalRevision: CONTRACT,
    },
    requiredActions: ["sample"],
    actions: [
      {
        id: "sample",
        attempted: true,
        clicked: true,
        assertionPassed: true,
        completed: true,
        dispatchedPrompt: "Sample",
      },
    ],
  };
}

function cell(
  frontend: "react" | "angular",
  status: "passed" | "failed",
  sourceCommit: string,
  overrides: Partial<FrontendParityCell> = {},
): FrontendParityCell {
  return {
    frontend,
    integration: "mastra",
    feature: "agentic-chat",
    status,
    sourceCommit,
    containerImageRevision: IMAGE,
    fixtureRevision: FIXTURE,
    featureContractRevision: CONTRACT,
    probeIds: ["agentic-chat"],
    testIds: [`d5-${frontend}-agentic-chat`],
    startedAt: "2026-09-21T00:00:00Z",
    observedAt: "2026-09-21T00:00:01Z",
    probes: [
      {
        featureType: "agentic-chat",
        status,
        pillExecution: syntheticPillProof(frontend),
      },
    ],
    ...overrides,
  };
}

const acceptedFailure: AcceptedBaselineFailure = {
  integration: "mastra",
  feature: "agentic-chat",
  category: "fixture",
  owner: "Showcase maintainers",
  issue: "https://github.com/CopilotKit/CopilotKit/issues/1",
};

function evaluate(
  baseStatus: "passed" | "failed",
  reactStatus: "passed" | "failed",
  angularStatus: "passed" | "failed",
  acceptedBaselineFailures: AcceptedBaselineFailure[] = baseStatus === "failed"
    ? [acceptedFailure]
    : [],
) {
  return evaluateFrontendParity({
    frozenBaseCommit: BASE_COMMIT,
    pullRequestCommit: PR_COMMIT,
    baselineReact: [cell("react", baseStatus, BASE_COMMIT)],
    pullRequest: [
      cell("react", reactStatus, PR_COMMIT),
      cell("angular", angularStatus, PR_COMMIT),
    ],
    expectedAngularCellIds: ["mastra/agentic-chat"],
    acceptedBaselineFailures,
  });
}

describe("evaluateFrontendParity", () => {
  it.each([
    ["passed", "passed", "passed", true, "passed"],
    ["failed", "failed", "failed", true, "accepted-baseline-failure"],
    ["failed", "failed", "passed", true, "angular-improvement"],
    ["failed", "passed", "passed", true, "passed"],
    ["passed", "passed", "failed", false, "angular-regression"],
    ["failed", "passed", "failed", false, "angular-regression"],
    ["passed", "failed", "failed", false, "react-regression"],
    ["passed", "failed", "passed", false, "react-regression"],
  ] as const)(
    "base %s, React %s, Angular %s yields %s / %s",
    (base, react, angular, passed, outcome) => {
      const report = evaluate(base, react, angular);

      expect(report.passed).toBe(passed);
      expect(report.comparisons).toHaveLength(1);
      expect(report.comparisons[0].outcome).toBe(outcome);
    },
  );

  it("blocks an accepted baseline failure without a category, owner, and issue", () => {
    const report = evaluate("failed", "failed", "failed", []);

    expect(report.passed).toBe(false);
    expect(report.comparisons[0].outcome).toBe("unowned-baseline-failure");
  });

  it("blocks PR pairs that did not use one image, fixture, contract, and commit", () => {
    const report = evaluateFrontendParity({
      frozenBaseCommit: BASE_COMMIT,
      pullRequestCommit: PR_COMMIT,
      baselineReact: [cell("react", "passed", BASE_COMMIT)],
      pullRequest: [
        cell("react", "passed", PR_COMMIT),
        cell("angular", "passed", PR_COMMIT, {
          fixtureRevision: "5555555555555555555555555555555555555555",
        }),
      ],
      expectedAngularCellIds: ["mastra/agentic-chat"],
      acceptedBaselineFailures: [],
    });

    expect(report.passed).toBe(false);
    expect(report.comparisons[0]).toMatchObject({
      outcome: "identity-mismatch",
      blockingReasons: ["fixture revision differs"],
    });
  });

  it("allows unique correlation IDs when both cells use the same probe contract", () => {
    const report = evaluate("passed", "passed", "passed");

    expect(report.passed).toBe(true);
  });

  it("blocks a baseline produced with a different feature contract", () => {
    const report = evaluateFrontendParity({
      frozenBaseCommit: BASE_COMMIT,
      pullRequestCommit: PR_COMMIT,
      baselineReact: [
        cell("react", "passed", BASE_COMMIT, {
          featureContractRevision: "older-contract",
        }),
      ],
      pullRequest: [
        cell("react", "passed", PR_COMMIT),
        cell("angular", "passed", PR_COMMIT),
      ],
      expectedAngularCellIds: ["mastra/agentic-chat"],
      acceptedBaselineFailures: [],
    });

    expect(report).toMatchObject({
      passed: false,
      comparisons: [
        {
          outcome: "identity-mismatch",
          blockingReasons: ["feature contract differs from frozen baseline"],
        },
      ],
    });
  });

  it("converts aggregate cells without losing revisions or probe identity", () => {
    expect(
      frontendParityCellsFromAggregate({
        cells: [
          {
            frontend: "react",
            integration: "mastra",
            feature: "agentic-chat",
            status: "failed",
            sourceCommit: BASE_COMMIT,
            containerImageRevision: IMAGE,
            fixtureRevision: FIXTURE,
            featureContractRevision: CONTRACT,
            testIds: ["fm-react-1"],
            probes: [{ featureType: "agentic-chat" }],
          },
        ],
      }),
    ).toEqual([
      {
        frontend: "react",
        integration: "mastra",
        feature: "agentic-chat",
        status: "failed",
        sourceCommit: BASE_COMMIT,
        containerImageRevision: IMAGE,
        fixtureRevision: FIXTURE,
        featureContractRevision: CONTRACT,
        testIds: ["fm-react-1"],
        probeIds: ["agentic-chat"],
        probes: [{ featureType: "agentic-chat" }],
        startedAt: undefined,
        observedAt: undefined,
      },
    ]);
  });

  it("fails closed when a base, React, or Angular cell is missing", () => {
    const report = evaluateFrontendParity({
      frozenBaseCommit: BASE_COMMIT,
      pullRequestCommit: PR_COMMIT,
      baselineReact: [cell("react", "passed", BASE_COMMIT)],
      pullRequest: [cell("react", "passed", PR_COMMIT)],
      expectedAngularCellIds: ["mastra/agentic-chat"],
      acceptedBaselineFailures: [],
    });

    expect(report.passed).toBe(false);
    expect(report.comparisons[0].outcome).toBe("missing-result");
  });
});

describe("evaluateCurrentFrontendParity", () => {
  it.each([
    ["passed", "passed", true, "passed"],
    ["passed", "failed", false, "angular-regression"],
    ["failed", "failed", true, "shared-failure"],
    ["failed", "passed", true, "angular-improvement"],
  ] as const)(
    "React %s and Angular %s yields %s / %s",
    (react, angular, passed, outcome) => {
      const report = evaluateCurrentFrontendParity({
        sourceCommit: PR_COMMIT,
        cells: [
          cell("react", react, PR_COMMIT),
          cell("angular", angular, PR_COMMIT),
        ],
      });

      expect(report.passed).toBe(passed);
      expect(report.comparisons[0]?.outcome).toBe(outcome);
    },
  );

  it("allows a React-only catalog cell", () => {
    const report = evaluateCurrentFrontendParity({
      sourceCommit: PR_COMMIT,
      cells: [cell("react", "passed", PR_COMMIT)],
    });

    expect(report).toMatchObject({
      passed: true,
      summary: { "react-only": 1 },
    });
  });

  it("blocks an Angular cell without a React counterpart", () => {
    const report = evaluateCurrentFrontendParity({
      sourceCommit: PR_COMMIT,
      cells: [cell("angular", "passed", PR_COMMIT)],
    });

    expect(report).toMatchObject({
      passed: false,
      summary: { "missing-counterpart": 1 },
    });
  });

  it("blocks counterpart cells that did not share exact evidence identity", () => {
    const report = evaluateCurrentFrontendParity({
      sourceCommit: PR_COMMIT,
      cells: [
        cell("react", "passed", PR_COMMIT),
        cell("angular", "passed", PR_COMMIT, {
          containerImageRevision: "sha256:different",
        }),
      ],
    });

    expect(report).toMatchObject({
      passed: false,
      comparisons: [
        {
          outcome: "identity-mismatch",
          blockingReasons: ["container image revision differs"],
        },
      ],
    });
  });
});

it("blocks a legacy raw passed cell without public pill evidence", () => {
  const report = evaluateCurrentFrontendParity({
    sourceCommit: PR_COMMIT,
    cells: [cell("react", "passed", PR_COMMIT, { probes: undefined })],
  });
  expect(report.passed).toBe(false);
});

it.each([
  { feature: "shared-state-read-write" },
  { startedAt: "2026-09-21T00:00:02Z" },
  { containerImageRevision: `sha256:${"e".repeat(64)}` },
  { featureContractRevision: "e".repeat(40) },
])(
  "rejects proof copied to a different cell, observation, or revision: %j",
  (overrides) => {
    const report = evaluateCurrentFrontendParity({
      sourceCommit: PR_COMMIT,
      cells: [cell("react", "passed", PR_COMMIT, overrides)],
    });
    expect(report.passed).toBe(false);
  },
);

it.each([
  { ...syntheticPillProof("react"), requiredActions: [] },
  { ...syntheticPillProof("react"), actions: [] },
  { ...syntheticPillProof("react"), attempts: 2 },
  { ...syntheticPillProof("react"), failures: ["first attempt failed"] },
  { ...syntheticPillProof("react"), surface: "direct-diagnostic" },
  {
    ...syntheticPillProof("react"),
    actions: [
      { ...syntheticPillProof("react").actions[0], assertionPassed: false },
    ],
  },
  {
    ...syntheticPillProof("react"),
    requiredActions: ["sample", "second"],
    actions: [
      syntheticPillProof("react").actions[0],
      syntheticPillProof("react").actions[0],
    ],
  },
])("does not admit incomplete or diagnostic execution %#", (pillExecution) => {
  const report = evaluateCurrentFrontendParity({
    sourceCommit: PR_COMMIT,
    cells: [
      cell("react", "passed", PR_COMMIT, {
        probes: [
          { featureType: "agentic-chat", status: "passed", pillExecution },
        ],
      }),
    ],
  });
  expect(report.passed).toBe(false);
});

it("does not let a React-only cell bypass the requested source revision", () => {
  expect(
    evaluateCurrentFrontendParity({
      sourceCommit: PR_COMMIT,
      cells: [cell("react", "passed", BASE_COMMIT)],
    }).passed,
  ).toBe(false);
});
