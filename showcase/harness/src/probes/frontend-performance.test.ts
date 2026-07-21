import { describe, expect, it } from "vitest";

import {
  FRONTEND_PERFORMANCE_PROFILE,
  createFrontendPerformanceArtifact,
  nearestRankPercentile,
} from "./frontend-performance.js";

describe("Angular shell readiness performance contract", () => {
  it("uses ten cold navigations under a fixed CPU and network profile", () => {
    expect(FRONTEND_PERFORMANCE_PROFILE).toEqual({
      coldNavigations: 10,
      cpuSlowdownRate: 4,
      networkProfile: "50mbps-down-10mbps-up-20ms-latency",
      latencyMs: 20,
      downloadThroughputBytesPerSecond: 6_250_000,
      uploadThroughputBytesPerSecond: 1_250_000,
      readinessMark: "copilotkit:showcase-shell-ready",
      p95BudgetMs: 2_000,
    });
  });

  it("calculates p95 using the nearest-rank definition", () => {
    expect(nearestRankPercentile([50, 10, 100, 30, 20], 0.95)).toBe(100);
    expect(nearestRankPercentile([10, 20], 0.5)).toBe(10);
  });

  it("emits measured evidence and fails the two-second p95 budget", () => {
    const pass = createFrontendPerformanceArtifact({
      commitSha: "abc123",
      startedAt: "2026-07-21T00:00:00.000Z",
      finishedAt: "2026-07-21T00:00:01.000Z",
      readinessDurationsMs: [
        1_000, 1_100, 1_200, 1_300, 1_400, 1_500, 1_600, 1_700, 1_800, 2_000,
      ],
    });
    const fail = createFrontendPerformanceArtifact({
      commitSha: "abc123",
      startedAt: "2026-07-21T00:00:00.000Z",
      finishedAt: "2026-07-21T00:00:01.000Z",
      readinessDurationsMs: [
        1_000, 1_100, 1_200, 1_300, 1_400, 1_500, 1_600, 1_700, 1_800, 2_001,
      ],
    });

    expect(pass.summary).toEqual({
      sampleCount: 10,
      p95ReadinessMs: 2_000,
      budgetMs: 2_000,
      status: "passed",
    });
    expect(fail.summary.status).toBe("failed");
    expect(JSON.stringify(pass)).not.toMatch(
      /prompt|message|content|credential/i,
    );
  });
});
