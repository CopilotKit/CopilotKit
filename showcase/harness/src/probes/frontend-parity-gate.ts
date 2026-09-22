export type FrontendParityStatus = "passed" | "failed";
export type FrontendFailureCategory =
  | "product"
  | "integration"
  | "fixture"
  | "probe"
  | "infrastructure";

export interface FrontendParityCell {
  frontend: "react" | "angular";
  integration: string;
  feature: string;
  status: FrontendParityStatus;
  sourceCommit: string;
  containerImageRevision: string;
  fixtureRevision: string;
  featureContractRevision: string;
  probeIds: string[];
  testIds: string[];
}

export interface AcceptedBaselineFailure {
  integration: string;
  feature: string;
  category: FrontendFailureCategory;
  owner: string;
  issue: string;
}

export type FrontendParityOutcome =
  | "passed"
  | "angular-regression"
  | "react-regression"
  | "accepted-baseline-failure"
  | "angular-improvement"
  | "react-only"
  | "unowned-baseline-failure"
  | "identity-mismatch"
  | "missing-result";

export interface FrontendParityComparison {
  id: string;
  integration: string;
  feature: string;
  baseReact: FrontendParityStatus | null;
  pullRequestReact: FrontendParityStatus | null;
  pullRequestAngular: FrontendParityStatus | null;
  outcome: FrontendParityOutcome;
  blockingReasons: string[];
  acceptedBaselineFailure?: AcceptedBaselineFailure;
}

export interface FrontendParityReport {
  schemaVersion: 1;
  frozenBaseCommit: string;
  pullRequestCommit: string;
  passed: boolean;
  summary: Record<FrontendParityOutcome, number>;
  comparisons: FrontendParityComparison[];
}

export type CurrentFrontendParityOutcome =
  | "passed"
  | "angular-regression"
  | "shared-failure"
  | "angular-improvement"
  | "react-only"
  | "identity-mismatch"
  | "missing-counterpart";

export interface CurrentFrontendParityComparison {
  id: string;
  integration: string;
  feature: string;
  react: FrontendParityStatus | null;
  angular: FrontendParityStatus | null;
  outcome: CurrentFrontendParityOutcome;
  blockingReasons: string[];
}

export interface CurrentFrontendParityReport {
  schemaVersion: 1;
  sourceCommit: string;
  passed: boolean;
  summary: Record<CurrentFrontendParityOutcome, number>;
  comparisons: CurrentFrontendParityComparison[];
}

export interface FrontendParityInput {
  frozenBaseCommit: string;
  pullRequestCommit: string;
  baselineReact: readonly FrontendParityCell[];
  pullRequest: readonly FrontendParityCell[];
  expectedAngularCellIds: readonly string[];
  acceptedBaselineFailures: readonly AcceptedBaselineFailure[];
}

const OUTCOMES: readonly FrontendParityOutcome[] = [
  "passed",
  "angular-regression",
  "react-regression",
  "accepted-baseline-failure",
  "angular-improvement",
  "react-only",
  "unowned-baseline-failure",
  "identity-mismatch",
  "missing-result",
];

const CURRENT_OUTCOMES: readonly CurrentFrontendParityOutcome[] = [
  "passed",
  "angular-regression",
  "shared-failure",
  "angular-improvement",
  "react-only",
  "identity-mismatch",
  "missing-counterpart",
];

function comparisonId(
  cell: Pick<FrontendParityCell, "integration" | "feature">,
): string {
  return `${cell.integration}/${cell.feature}`;
}

function acceptedFailureId(
  failure: Pick<AcceptedBaselineFailure, "integration" | "feature">,
): string {
  return `${failure.integration}/${failure.feature}`;
}

function indexCells(
  cells: readonly FrontendParityCell[],
  expectedFrontend?: FrontendParityCell["frontend"],
): Map<string, FrontendParityCell> {
  const indexed = new Map<string, FrontendParityCell>();
  for (const cell of cells) {
    if (expectedFrontend && cell.frontend !== expectedFrontend) {
      throw new Error(
        `expected only ${expectedFrontend} baseline cells; received ${cell.frontend}`,
      );
    }
    const key = `${cell.frontend}/${comparisonId(cell)}`;
    if (indexed.has(key)) throw new Error(`duplicate frontend result ${key}`);
    indexed.set(key, cell);
  }
  return indexed;
}

function indexAcceptedFailures(
  failures: readonly AcceptedBaselineFailure[],
): Map<string, AcceptedBaselineFailure> {
  const indexed = new Map<string, AcceptedBaselineFailure>();
  for (const failure of failures) {
    const key = acceptedFailureId(failure);
    if (indexed.has(key)) throw new Error(`duplicate accepted failure ${key}`);
    if (failure.owner.trim() === "" || failure.issue.trim() === "") {
      throw new Error(`accepted failure ${key} requires owner and issue`);
    }
    if (
      ![
        "product",
        "integration",
        "fixture",
        "probe",
        "infrastructure",
      ].includes(failure.category)
    ) {
      throw new Error(`accepted failure ${key} has invalid category`);
    }
    indexed.set(key, failure);
  }
  return indexed;
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((value, index) => value === sortedRight[index])
  );
}

function pairIdentityReasons(
  react: FrontendParityCell,
  angular: FrontendParityCell,
  pullRequestCommit: string,
): string[] {
  const reasons: string[] = [];
  if (
    react.sourceCommit !== angular.sourceCommit ||
    react.sourceCommit !== pullRequestCommit
  ) {
    reasons.push("source commit differs");
  }
  if (react.containerImageRevision !== angular.containerImageRevision) {
    reasons.push("container image revision differs");
  }
  if (react.fixtureRevision !== angular.fixtureRevision) {
    reasons.push("fixture revision differs");
  }
  if (react.featureContractRevision !== angular.featureContractRevision) {
    reasons.push("feature contract revision differs");
  }
  if (!sameStrings(react.probeIds, angular.probeIds)) {
    reasons.push("probe identity differs");
  }
  return reasons;
}

function comparisonFor(
  id: string,
  base: FrontendParityCell | undefined,
  react: FrontendParityCell | undefined,
  angular: FrontendParityCell | undefined,
  accepted: AcceptedBaselineFailure | undefined,
  angularExpected: boolean,
  input: Pick<FrontendParityInput, "frozenBaseCommit" | "pullRequestCommit">,
): FrontendParityComparison {
  const [integration = "", feature = ""] = id.split("/", 2);
  const result = (
    outcome: FrontendParityOutcome,
    blockingReasons: string[] = [],
  ): FrontendParityComparison => ({
    id,
    integration,
    feature,
    baseReact: base?.status ?? null,
    pullRequestReact: react?.status ?? null,
    pullRequestAngular: angular?.status ?? null,
    outcome,
    blockingReasons,
    ...(accepted ? { acceptedBaselineFailure: accepted } : {}),
  });

  if (!base || !react || (angularExpected && !angular)) {
    return result("missing-result", [
      `missing ${!base ? "base React" : !react ? "PR React" : "PR Angular"} result`,
    ]);
  }

  const identityReasons = angular
    ? pairIdentityReasons(react, angular, input.pullRequestCommit)
    : react.sourceCommit === input.pullRequestCommit
      ? []
      : ["source commit differs"];
  if (base.sourceCommit !== input.frozenBaseCommit) {
    identityReasons.push("frozen base commit differs");
  }
  if (base.featureContractRevision !== react.featureContractRevision) {
    identityReasons.push("feature contract differs from frozen baseline");
  }
  if (identityReasons.length > 0) {
    return result("identity-mismatch", identityReasons);
  }

  if (base.status === "failed" && !accepted) {
    return result("unowned-baseline-failure", [
      "baseline failure requires category, owner, and issue",
    ]);
  }
  if (base.status === "passed" && react.status === "failed") {
    return result("react-regression", [
      "PR React regressed from the frozen base",
    ]);
  }
  if (!angular) {
    return result(
      base.status === "failed" && react.status === "failed"
        ? "accepted-baseline-failure"
        : "react-only",
    );
  }
  if (react.status === "passed" && angular.status === "failed") {
    return result("angular-regression", [
      "PR React passed while Angular failed",
    ]);
  }
  if (react.status === "failed" && angular.status === "failed") {
    return result("accepted-baseline-failure");
  }
  if (react.status === "failed" && angular.status === "passed") {
    return result("angular-improvement");
  }
  return result("passed");
}

/**
 * Compare frozen React, PR React, and PR Angular results under the approved
 * regression rules. Existing owned failures stay visible without blocking.
 */
export function evaluateFrontendParity(
  input: FrontendParityInput,
): FrontendParityReport {
  const baseline = indexCells(input.baselineReact, "react");
  const pullRequest = indexCells(input.pullRequest);
  const accepted = indexAcceptedFailures(input.acceptedBaselineFailures);
  const expectedAngular = new Set(input.expectedAngularCellIds);
  const ids = new Set<string>();

  for (const key of baseline.keys()) ids.add(key.replace(/^react\//, ""));
  for (const key of pullRequest.keys()) {
    ids.add(key.replace(/^(react|angular)\//, ""));
  }
  for (const [id, failure] of accepted) {
    const baselineCell = baseline.get(`react/${id}`);
    if (!baselineCell || baselineCell.status !== "failed") {
      throw new Error(
        `accepted failure ${acceptedFailureId(failure)} is not a frozen baseline failure`,
      );
    }
  }

  const comparisons = [...ids]
    .sort()
    .map((id) =>
      comparisonFor(
        id,
        baseline.get(`react/${id}`),
        pullRequest.get(`react/${id}`),
        pullRequest.get(`angular/${id}`),
        accepted.get(id),
        expectedAngular.has(id),
        input,
      ),
    );
  const summary = Object.fromEntries(
    OUTCOMES.map((outcome) => [
      outcome,
      comparisons.filter((comparison) => comparison.outcome === outcome).length,
    ]),
  ) as Record<FrontendParityOutcome, number>;

  return {
    schemaVersion: 1,
    frozenBaseCommit: input.frozenBaseCommit,
    pullRequestCommit: input.pullRequestCommit,
    passed: comparisons.every(
      (comparison) => comparison.blockingReasons.length === 0,
    ),
    summary,
    comparisons,
  };
}

/**
 * Compare the two frontends at one exact source revision. Shared failures stay
 * visible but do not block an Angular-parity audit; an Angular-only failure,
 * missing counterpart, or pair-identity mismatch does.
 */
export function evaluateCurrentFrontendParity(input: {
  sourceCommit: string;
  cells: readonly FrontendParityCell[];
}): CurrentFrontendParityReport {
  const indexed = indexCells(input.cells);
  const ids = new Set<string>();
  for (const key of indexed.keys()) {
    ids.add(key.replace(/^(react|angular)\//, ""));
  }

  const comparisons = [...ids]
    .sort()
    .map((id): CurrentFrontendParityComparison => {
      const react = indexed.get(`react/${id}`);
      const angular = indexed.get(`angular/${id}`);
      const [integration = "", feature = ""] = id.split("/", 2);
      const result = (
        outcome: CurrentFrontendParityOutcome,
        blockingReasons: string[] = [],
      ): CurrentFrontendParityComparison => ({
        id,
        integration,
        feature,
        react: react?.status ?? null,
        angular: angular?.status ?? null,
        outcome,
        blockingReasons,
      });

      if (!react) {
        return result("missing-counterpart", [
          "Angular cell has no React counterpart",
        ]);
      }
      if (!angular) return result("react-only");

      const identityReasons = pairIdentityReasons(
        react,
        angular,
        input.sourceCommit,
      );
      if (identityReasons.length > 0) {
        return result("identity-mismatch", identityReasons);
      }
      if (react.status === "passed" && angular.status === "failed") {
        return result("angular-regression", [
          "React passed while Angular failed at the same revision",
        ]);
      }
      if (react.status === "failed" && angular.status === "failed") {
        return result("shared-failure");
      }
      if (react.status === "failed" && angular.status === "passed") {
        return result("angular-improvement");
      }
      return result("passed");
    });

  const summary = Object.fromEntries(
    CURRENT_OUTCOMES.map((outcome) => [
      outcome,
      comparisons.filter((comparison) => comparison.outcome === outcome).length,
    ]),
  ) as Record<CurrentFrontendParityOutcome, number>;

  return {
    schemaVersion: 1,
    sourceCommit: input.sourceCommit,
    passed: comparisons.every(
      (comparison) => comparison.blockingReasons.length === 0,
    ),
    summary,
    comparisons,
  };
}

interface FrontendAggregateCellInput {
  frontend: string;
  integration: string;
  feature: string;
  status: string;
  sourceCommit: string;
  containerImageRevision: string;
  fixtureRevision: string;
  featureContractRevision: string;
  testIds: string[];
  probes: Array<{ featureType: string }>;
}

interface FrontendAggregateInput {
  cells: readonly FrontendAggregateCellInput[];
}

/** Convert a verified aggregate report into the smaller parity gate contract. */
export function frontendParityCellsFromAggregate(
  report: FrontendAggregateInput,
): FrontendParityCell[] {
  return report.cells.map((cell) => {
    if (cell.frontend !== "react" && cell.frontend !== "angular") {
      throw new Error(`unsupported aggregate frontend ${cell.frontend}`);
    }
    if (cell.status !== "passed" && cell.status !== "failed") {
      throw new Error(`unsupported aggregate status ${cell.status}`);
    }
    return {
      frontend: cell.frontend,
      integration: cell.integration,
      feature: cell.feature,
      status: cell.status,
      sourceCommit: cell.sourceCommit,
      containerImageRevision: cell.containerImageRevision,
      fixtureRevision: cell.fixtureRevision,
      featureContractRevision: cell.featureContractRevision,
      probeIds: cell.probes.map((probe) => probe.featureType),
      testIds: cell.testIds,
    };
  });
}
