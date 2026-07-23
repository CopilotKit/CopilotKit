import { describe, expect, it } from "vitest";

import {
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
