import { describe, expect, it } from "vitest";

import {
  angularSupportedFeatureIdsFromRegistry,
  buildAngularFinalReport,
} from "./angular-final-report.js";
import type { AngularCanaryEvidence } from "./angular-final-report.js";
import { evaluateFrontendParity } from "./frontend-parity-gate.js";
import type {
  FrontendParityCell,
  FrontendParityReport,
} from "./frontend-parity-gate.js";

function proofCell(
  frontend: "react" | "angular",
  sourceCommit: string,
): FrontendParityCell {
  return {
    frontend,
    sourceCommit,
    integration: "langgraph-python",
    feature: "agentic-chat",
    status: "passed",
    containerImageRevision: `sha256:${"c".repeat(64)}`,
    fixtureRevision: "b".repeat(40),
    featureContractRevision: "d".repeat(40),
    probeIds: ["agentic-chat"],
    testIds: ["synthetic-proof"],
    startedAt: "2026-09-21T00:00:00Z",
    observedAt: "2026-09-21T00:00:01Z",
    probes: [
      {
        featureType: "agentic-chat",
        status: "passed",
        pillExecution: {
          mode: "functional-pill",
          surface: "public",
          completed: true,
          attempts: 1,
          failures: [],
          startedAt: "2026-09-21T00:00:00Z",
          completedAt: "2026-09-21T00:00:01Z",
          identity: {
            canonical: "agentic-chat",
            integration: "langgraph-python",
            frontend,
            targetRevision: `sha256:${"c".repeat(64)}`,
            canonicalRevision: "d".repeat(40),
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
        },
      },
    ],
  };
}
const parity: FrontendParityReport = evaluateFrontendParity({
  frozenBaseCommit: "a".repeat(40),
  pullRequestCommit: "b".repeat(40),
  baselineReact: [proofCell("react", "a".repeat(40))],
  pullRequest: [
    proofCell("react", "b".repeat(40)),
    proofCell("angular", "b".repeat(40)),
  ],
  expectedAngularCellIds: ["langgraph-python/agentic-chat"],
  acceptedBaselineFailures: [],
});

const canary = (
  browser: AngularCanaryEvidence["browser"],
): AngularCanaryEvidence => ({
  schemaVersion: 1,
  sourceCommit: "b".repeat(40),
  containerImageRevision: `sha256:${"c".repeat(64)}`,
  fixtureRevision: "b".repeat(40),
  integration: "langgraph-python",
  browser,
  canaries: [{ id: "bootstrap", durationMs: 10, status: "passed" }],
  runtimeReadiness: {
    budgetMs: 2_000,
    sampleCount: 10,
    measurementsMs: Array.from({ length: 10 }, () => 1_000),
    maximumMs: 1_000,
    p95Ms: 1_000,
    passed: true,
  },
  status: "passed",
});

describe("Angular final CI report", () => {
  it("records three browser engines and the owned baseline failure list", () => {
    const report = buildAngularFinalReport({
      parity,
      canaries: [canary("chromium"), canary("firefox"), canary("webkit")],
      acceptedBaselineFailures: [
        {
          integration: "ag2",
          feature: "agentic-chat",
          category: "probe",
          owner: "Showcase maintainers",
          issue: "https://github.com/CopilotKit/CopilotKit/issues/6113",
        },
      ],
      supportedAngularFeatureIds: ["agentic-chat"],
      expectedSupportedFeatures: 1,
    });

    expect(report.status).toBe("passed");
    expect(report.browserCanaries.map((item) => item.browser)).toEqual([
      "chromium",
      "firefox",
      "webkit",
    ]);
    expect(report.acceptedBaselineFailures).toHaveLength(1);
    expect(report.pairedCells).toBe(1);
    expect(report.supportedAngularFeatures).toBe(1);
  });

  it("counts supported registry features without inventing backend pairs", () => {
    const report = buildAngularFinalReport({
      parity,
      canaries: [canary("chromium"), canary("firefox"), canary("webkit")],
      acceptedBaselineFailures: [],
      supportedAngularFeatureIds: [
        "agentic-chat",
        "threadid-frontend-tool-roundtrip",
      ],
      expectedSupportedFeatures: 2,
    });

    expect(report.pairedCells).toBe(1);
    expect(report.supportedAngularFeatures).toBe(2);
  });

  it("reads only supported Angular features from the frontend registry", () => {
    expect(
      angularSupportedFeatureIdsFromRegistry({
        feature_support: {
          "threadid-frontend-tool-roundtrip": {
            angular: { state: "supported" },
          },
          "declarative-hashbrown": {
            angular: { state: "not-supported" },
          },
          "cli-start": { angular: { state: "not-applicable" } },
          "agentic-chat": { angular: { state: "supported" } },
        },
      }),
    ).toEqual(["agentic-chat", "threadid-frontend-tool-roundtrip"]);
  });

  it("fails closed on missing browsers, failed parity, or unowned exceptions", () => {
    expect(() =>
      buildAngularFinalReport({
        parity,
        canaries: [canary("chromium"), canary("firefox")],
        acceptedBaselineFailures: [],
        supportedAngularFeatureIds: ["agentic-chat"],
        expectedSupportedFeatures: 1,
      }),
    ).toThrow(/webkit/i);
    expect(() =>
      buildAngularFinalReport({
        parity: { ...parity, passed: false },
        canaries: [canary("chromium"), canary("firefox"), canary("webkit")],
        acceptedBaselineFailures: [],
        supportedAngularFeatureIds: ["agentic-chat"],
        expectedSupportedFeatures: 1,
      }),
    ).toThrow(/parity/i);
    expect(() =>
      buildAngularFinalReport({
        parity,
        canaries: [canary("chromium"), canary("firefox"), canary("webkit")],
        acceptedBaselineFailures: [
          {
            integration: "ag2",
            feature: "agentic-chat",
            category: "probe",
            owner: "",
            issue: "",
          },
        ],
        supportedAngularFeatureIds: ["agentic-chat"],
        expectedSupportedFeatures: 1,
      }),
    ).toThrow(/owner.*issue/i);
  });

  it("fails closed on extra evidence or incomplete runtime samples", () => {
    expect(() =>
      buildAngularFinalReport({
        parity,
        canaries: [
          canary("chromium"),
          canary("firefox"),
          canary("webkit"),
          canary("chromium"),
        ],
        acceptedBaselineFailures: [],
        supportedAngularFeatureIds: ["agentic-chat"],
        expectedSupportedFeatures: 1,
      }),
    ).toThrow(/exactly three/i);
    expect(() =>
      buildAngularFinalReport({
        parity,
        canaries: [
          {
            ...canary("chromium"),
            runtimeReadiness: {
              ...canary("chromium").runtimeReadiness,
              measurementsMs: [1_000],
            },
          },
          canary("firefox"),
          canary("webkit"),
        ],
        acceptedBaselineFailures: [],
        supportedAngularFeatureIds: ["agentic-chat"],
        expectedSupportedFeatures: 1,
      }),
    ).toThrow(/ten runtime samples/i);
  });
});

it("rejects a legacy passed parity report with no retained evidence", () => {
  expect(() =>
    buildAngularFinalReport({
      parity: { ...parity, evidence: undefined },
      canaries: [],
      acceptedBaselineFailures: [],
      supportedAngularFeatureIds: [],
    }),
  ).toThrow(/public pill evidence/);
});
