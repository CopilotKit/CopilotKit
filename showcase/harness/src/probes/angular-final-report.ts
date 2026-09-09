import type {
  AcceptedBaselineFailure,
  FrontendParityReport,
} from "./frontend-parity-gate.js";

export type AngularCanaryBrowser = "chromium" | "firefox" | "webkit";

export interface AngularCanaryEvidence {
  schemaVersion: 1;
  sourceCommit: string;
  containerImageRevision: string;
  fixtureRevision: string;
  integration: string;
  browser: AngularCanaryBrowser;
  canaries: Array<{
    id: string;
    durationMs: number;
    status: "passed";
  }>;
  runtimeReadiness: {
    budgetMs: number;
    sampleCount: number;
    measurementsMs: number[];
    maximumMs: number;
    p95Ms: number;
    passed: boolean;
  };
  status: "passed";
}

export interface AngularFinalReport {
  schemaVersion: 1;
  sourceCommit: string;
  frozenBaseCommit: string;
  status: "passed";
  pairedCells: number;
  supportedAngularFeatures: number;
  paritySummary: FrontendParityReport["summary"];
  browserCanaries: Array<{
    browser: AngularCanaryBrowser;
    integration: string;
    containerImageRevision: string;
    fixtureRevision: string;
    canaryCount: number;
    runtimeSampleCount: number;
    runtimeMaximumMs: number;
    runtimeP95Ms: number;
  }>;
  acceptedBaselineFailures: AcceptedBaselineFailure[];
}

const REQUIRED_BROWSERS: readonly AngularCanaryBrowser[] = [
  "chromium",
  "firefox",
  "webkit",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read the Angular supported-feature set from the authoritative registry. */
export function angularSupportedFeatureIdsFromRegistry(
  registry: unknown,
): string[] {
  if (!isRecord(registry) || !isRecord(registry.feature_support)) {
    throw new Error("frontend registry requires feature_support");
  }

  const supported: string[] = [];
  for (const [featureId, declarations] of Object.entries(
    registry.feature_support,
  )) {
    if (!isRecord(declarations) || !isRecord(declarations.angular)) {
      throw new Error(
        `frontend registry feature ${featureId} requires Angular support`,
      );
    }
    const state = declarations.angular.state;
    if (typeof state !== "string" || state.trim() === "") {
      throw new Error(
        `frontend registry feature ${featureId} requires an Angular support state`,
      );
    }
    if (state === "supported") supported.push(featureId);
  }
  return supported.sort();
}

/** Require each accepted frozen-base failure to name an owner and issue. */
function validateAcceptedFailure(failure: AcceptedBaselineFailure): void {
  if (failure.owner.trim() === "" || failure.issue.trim() === "") {
    throw new Error(
      `accepted failure ${failure.integration}/${failure.feature} requires owner and issue`,
    );
  }
  let issue: URL;
  try {
    issue = new URL(failure.issue);
  } catch {
    throw new Error(
      `accepted failure ${failure.integration}/${failure.feature} issue must be an HTTPS URL`,
    );
  }
  if (issue.protocol !== "https:") {
    throw new Error(
      `accepted failure ${failure.integration}/${failure.feature} issue must be an HTTPS URL`,
    );
  }
}

/** Calculate the nearest-rank percentile used by runtime readiness evidence. */
function percentile(values: readonly number[], quantile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * quantile) - 1] ?? 0;
}

/** Validate the bounded evidence emitted by one browser canary job. */
function validateCanaryEvidence(
  evidence: AngularCanaryEvidence,
  expectedSourceCommit: string,
): void {
  if (
    evidence.schemaVersion !== 1 ||
    evidence.status !== "passed" ||
    !REQUIRED_BROWSERS.includes(evidence.browser)
  ) {
    throw new Error(`invalid ${String(evidence.browser)} canary evidence`);
  }
  const measurements = evidence.runtimeReadiness.measurementsMs;
  if (
    evidence.sourceCommit !== expectedSourceCommit ||
    !/^sha256:[a-f0-9]{64}$/.test(evidence.containerImageRevision) ||
    !/^[a-f0-9]{40}$/.test(evidence.fixtureRevision) ||
    !evidence.runtimeReadiness.passed ||
    evidence.runtimeReadiness.sampleCount !== 10 ||
    measurements.length !== 10
  ) {
    throw new Error(
      `${evidence.browser} canary evidence requires ten runtime samples`,
    );
  }
  if (
    measurements.some(
      (measurement) =>
        !Number.isFinite(measurement) ||
        measurement < 0 ||
        measurement > evidence.runtimeReadiness.budgetMs,
    ) ||
    Math.max(...measurements) !== evidence.runtimeReadiness.maximumMs ||
    percentile(measurements, 0.95) !== evidence.runtimeReadiness.p95Ms
  ) {
    throw new Error(`${evidence.browser} canary runtime evidence is invalid`);
  }
  if (
    evidence.canaries.length === 0 ||
    new Set(evidence.canaries.map((canary) => canary.id)).size !==
      evidence.canaries.length ||
    evidence.canaries.some(
      (canary) =>
        canary.id.trim() === "" ||
        canary.status !== "passed" ||
        !Number.isFinite(canary.durationMs) ||
        canary.durationMs < 0,
    )
  ) {
    throw new Error(`${evidence.browser} canary checks are invalid`);
  }
}

/** Build the bounded merge-gate report after parity and browser checks pass. */
export function buildAngularFinalReport(input: {
  parity: FrontendParityReport;
  canaries: readonly AngularCanaryEvidence[];
  acceptedBaselineFailures: readonly AcceptedBaselineFailure[];
  supportedAngularFeatureIds: readonly string[];
  expectedSupportedFeatures?: number;
}): AngularFinalReport {
  if (!input.parity.passed) {
    throw new Error("frontend parity report contains a blocking failure");
  }
  if (input.canaries.length > REQUIRED_BROWSERS.length) {
    throw new Error("final report requires exactly three browser canaries");
  }

  const canariesByBrowser = new Map<
    AngularCanaryBrowser,
    AngularCanaryEvidence
  >();
  for (const evidence of input.canaries) {
    validateCanaryEvidence(evidence, input.parity.pullRequestCommit);
    if (canariesByBrowser.has(evidence.browser)) {
      throw new Error(`duplicate ${evidence.browser} canary evidence`);
    }
    canariesByBrowser.set(evidence.browser, evidence);
  }
  for (const browser of REQUIRED_BROWSERS) {
    if (!canariesByBrowser.has(browser)) {
      throw new Error(`missing ${browser} canary evidence`);
    }
  }

  for (const failure of input.acceptedBaselineFailures) {
    validateAcceptedFailure(failure);
  }

  const comparisonsWithAngular = input.parity.comparisons.filter(
    (comparison) => comparison.pullRequestAngular !== null,
  );
  const supportedFeatureIds = new Set(input.supportedAngularFeatureIds);
  if (
    supportedFeatureIds.size !== input.supportedAngularFeatureIds.length ||
    input.supportedAngularFeatureIds.some(
      (featureId) => featureId.trim() === "",
    )
  ) {
    throw new Error(
      "supported Angular feature ids must be unique and non-empty",
    );
  }
  const unsupportedPairedFeature = comparisonsWithAngular.find(
    (comparison) => !supportedFeatureIds.has(comparison.feature),
  );
  if (unsupportedPairedFeature !== undefined) {
    throw new Error(
      `paired Angular feature ${unsupportedPairedFeature.feature} is not supported by the registry`,
    );
  }
  const supportedAngularFeatures = supportedFeatureIds.size;
  const expectedSupportedFeatures = input.expectedSupportedFeatures ?? 41;
  if (supportedAngularFeatures !== expectedSupportedFeatures) {
    throw new Error(
      `expected ${expectedSupportedFeatures} supported Angular features; found ${supportedAngularFeatures}`,
    );
  }
  return {
    schemaVersion: 1,
    sourceCommit: input.parity.pullRequestCommit,
    frozenBaseCommit: input.parity.frozenBaseCommit,
    status: "passed",
    pairedCells: comparisonsWithAngular.length,
    supportedAngularFeatures,
    paritySummary: input.parity.summary,
    browserCanaries: REQUIRED_BROWSERS.map((browser) => {
      const evidence = canariesByBrowser.get(browser)!;
      return {
        browser,
        integration: evidence.integration,
        containerImageRevision: evidence.containerImageRevision,
        fixtureRevision: evidence.fixtureRevision,
        canaryCount: evidence.canaries.length,
        runtimeSampleCount: evidence.runtimeReadiness.sampleCount,
        runtimeMaximumMs: evidence.runtimeReadiness.maximumMs,
        runtimeP95Ms: evidence.runtimeReadiness.p95Ms,
      };
    }),
    acceptedBaselineFailures: [...input.acceptedBaselineFailures].sort(
      (left, right) =>
        left.integration.localeCompare(right.integration) ||
        left.feature.localeCompare(right.feature),
    ),
  };
}
