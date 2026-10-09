import { describe, expect, it } from "vitest";

import {
  angularSupportedFeatureIdsFromRegistry,
  buildAngularFinalReport,
} from "./angular-final-report.js";
import type { AngularCanaryEvidence } from "./angular-final-report.js";
import type { FrontendParityReport } from "./frontend-parity-gate.js";

const parity: FrontendParityReport = {
  schemaVersion: 1,
  frozenBaseCommit: "a".repeat(40),
  pullRequestCommit: "b".repeat(40),
  passed: true,
  summary: {
    passed: 1,
    "angular-regression": 0,
    "react-regression": 0,
    "accepted-baseline-failure": 1,
    "angular-improvement": 0,
    "react-only": 0,
    "unowned-baseline-failure": 0,
    "identity-mismatch": 0,
    "missing-result": 0,
  },
  comparisons: [
    {
      id: "langgraph-python/agentic-chat",
      integration: "langgraph-python",
      feature: "agentic-chat",
      baseReact: "passed",
      pullRequestReact: "passed",
      pullRequestAngular: "passed",
      outcome: "passed",
      blockingReasons: [],
    },
  ],
};

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
          { ...canary("chromium"), browser: "safari" as "chromium" },
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
