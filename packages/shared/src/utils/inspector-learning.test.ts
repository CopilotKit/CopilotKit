import { describe, expect, it } from "vitest";
import {
  parseInspectorLearningRequestV1,
  parseInspectorLearningSnapshotV1,
  parseInspectorLearningUrl,
} from "./inspector-learning";

const emptySnapshot = () => ({
  schemaVersion: 1,
  projectKey: "project-safe-key",
  snapshotVersion: "snapshot-1",
  webAppOrigin: "https://app.copilotkit.ai",
  configuration: { state: "not_configured" },
  pendingThreadCount: 0,
  run: { hasActiveRun: false, hasEverSucceeded: false, latest: null },
  pendingCandidateCount: 0,
  skillsPage: {
    page: 1,
    pageSize: 3,
    total: 0,
    totalPages: 0,
    items: [],
  },
  insightsPage: {
    page: 1,
    pageSize: 4,
    total: 0,
    totalPages: 0,
    items: [],
  },
  links: {
    learning: "https://app.copilotkit.ai/learning",
    candidates: null,
    runs: null,
  },
});

/** One available Trajectory citation, with fields overridden per case. */
const trajectoryEntry = (overrides: Record<string, unknown>) => ({
  status: "available",
  trajectoryId: "trajectory-1",
  eventCount: 1,
  url: "https://app.copilotkit.ai/o/acme/support/trajectories/trajectory-1",
  ...overrides,
});

/** Builds a configured snapshot whose Insight and Skill source cite Trajectories. */
const snapshotWithTrajectoryEvidence = (trajectoryEvidence: unknown[]) => {
  const insight = {
    id: "insight-1",
    statement: "Users switch the theme first.",
    impact: "Default to dark mode.",
    totalThreadCount: 0,
    evidenceTruncated: false,
    evidence: [],
    totalTrajectoryCount: trajectoryEvidence.length,
    trajectoryEvidence,
  };
  return {
    ...emptySnapshot(),
    configuration: {
      state: "configured",
      container: { id: "support", name: "Support" },
    },
    skillsPage: {
      page: 1,
      pageSize: 3,
      total: 1,
      totalPages: 1,
      items: [
        {
          id: "skill-1",
          name: "dark-mode",
          description: "Offer dark mode.",
          revision: 1,
          skillMd: "# Dark mode",
          sourceInsight: { ...insight, id: "source-1" },
        },
      ],
    },
    insightsPage: {
      page: 1,
      pageSize: 4,
      total: 1,
      totalPages: 1,
      items: [insight],
    },
  };
};

describe("Inspector Learning wire validation", () => {
  it("accepts and copies a bounded V1 snapshot", () => {
    const source = emptySnapshot();
    const parsed = parseInspectorLearningSnapshotV1(source);

    expect(parsed).toEqual(source);
    expect(parsed).not.toBe(source);
  });

  it("copies only the supported fields from the latest Learning run", () => {
    const source = {
      ...emptySnapshot(),
      run: {
        hasActiveRun: false,
        hasEverSucceeded: true,
        latest: {
          status: "succeeded",
          completedAt: "2026-09-04T12:00:00.000Z",
          internalPayload: "must-not-cross-the-boundary",
        },
      },
    };

    expect(parseInspectorLearningSnapshotV1(source)?.run.latest).toEqual({
      status: "succeeded",
      completedAt: "2026-09-04T12:00:00.000Z",
    });
  });

  it("rejects unsafe links and oversized evidence", () => {
    expect(
      parseInspectorLearningUrl(
        "javascript:alert(1)",
        "https://app.copilotkit.ai",
      ),
    ).toBeUndefined();
    expect(
      parseInspectorLearningUrl(
        "http://example.com/learning",
        "https://app.copilotkit.ai",
      ),
    ).toBeUndefined();
    expect(
      parseInspectorLearningUrl(
        "https://attacker.example/learning",
        "https://app.copilotkit.ai",
      ),
    ).toBeUndefined();
    expect(
      parseInspectorLearningUrl(
        "https://app.copilotkit.ai.evil.test/learning",
        "https://app.copilotkit.ai",
      ),
    ).toBeUndefined();
    expect(
      parseInspectorLearningUrl(
        "http://localhost:3000/learning",
        "http://localhost:3000",
      ),
    ).toBe("http://localhost:3000/learning");
    expect(
      parseInspectorLearningUrl(
        "https://intelligence.customer.example/learning",
        "https://intelligence.customer.example",
      ),
    ).toBe("https://intelligence.customer.example/learning");

    const snapshot = emptySnapshot();
    snapshot.insightsPage = {
      page: 1,
      pageSize: 4,
      total: 1,
      totalPages: 1,
      items: [
        {
          id: "insight-1",
          statement: "A bounded pattern",
          impact: "A bounded impact",
          totalThreadCount: 101,
          evidenceTruncated: true,
          evidence: Array.from({ length: 101 }, (_, index) => ({
            status: "available",
            threadId: `thread-${index}`,
            threadName: null,
            messageIds: [],
            updatedAt: "2026-09-03T00:00:00.000Z",
          })),
        },
      ],
    };
    expect(parseInspectorLearningSnapshotV1(snapshot)).toBeUndefined();
  });

  it("rejects required actions that are absent or point at another origin", () => {
    const missingRuns = emptySnapshot();
    missingRuns.pendingThreadCount = 1;
    expect(parseInspectorLearningSnapshotV1(missingRuns)).toBeUndefined();

    const missingCandidates = emptySnapshot();
    missingCandidates.pendingCandidateCount = 1;
    expect(parseInspectorLearningSnapshotV1(missingCandidates)).toBeUndefined();

    const arbitraryOrigin = emptySnapshot();
    arbitraryOrigin.links.learning = "https://attacker.example/learning";
    expect(parseInspectorLearningSnapshotV1(arbitraryOrigin)).toBeUndefined();

    const configuredOrigin = emptySnapshot();
    configuredOrigin.webAppOrigin = "https://intelligence.customer.example";
    configuredOrigin.links.learning =
      "https://intelligence.customer.example/learning";
    expect(parseInspectorLearningSnapshotV1(configuredOrigin)).toBeDefined();
  });

  it("accepts identifier-free unavailable evidence separately from unnamed evidence", () => {
    const snapshot = emptySnapshot();
    snapshot.insightsPage = {
      page: 1,
      pageSize: 4,
      total: 1,
      totalPages: 1,
      items: [
        {
          id: "insight-1",
          statement: "Verify the order.",
          impact: "Avoids incorrect guidance.",
          totalThreadCount: 2,
          evidenceTruncated: false,
          evidence: [
            { status: "unavailable" },
            {
              status: "available",
              threadId: "thread-2",
              threadName: null,
              messageIds: ["message-2"],
              updatedAt: "2026-09-03T00:00:00.000Z",
            },
          ],
        },
      ],
    };

    expect(parseInspectorLearningSnapshotV1(snapshot)).toBeDefined();
    snapshot.insightsPage.items[0].evidence[0] = {
      status: "unavailable",
      threadId: "former-id",
    };
    expect(parseInspectorLearningSnapshotV1(snapshot)).toBeUndefined();
  });

  it("rejects inconsistent server pagination", () => {
    const snapshot = emptySnapshot();
    snapshot.insightsPage = {
      page: 2,
      pageSize: 4,
      total: 1,
      totalPages: 1,
      items: [],
    };

    expect(parseInspectorLearningSnapshotV1(snapshot)).toBeUndefined();
  });

  it("copies Trajectory evidence next to the Thread evidence", () => {
    const snapshot = snapshotWithTrajectoryEvidence([
      {
        status: "available",
        trajectoryId: "0190a3b4-0000-7000-8000-000000000001",
        eventCount: 2,
        url: "https://app.copilotkit.ai/o/acme/support/trajectories/0190a3b4-0000-7000-8000-000000000001?event=901",
      },
      { status: "unavailable" },
    ]);

    const parsed = parseInspectorLearningSnapshotV1(snapshot);

    expect(parsed?.insightsPage.items[0]).toEqual(
      snapshot.insightsPage.items[0],
    );
    expect(
      parseInspectorLearningSnapshotV1(
        snapshotWithTrajectoryEvidence([
          {
            status: "available",
            trajectoryId: "trajectory-1",
            eventCount: 1,
            url: "https://app.copilotkit.ai/o/acme/support/trajectories/trajectory-1",
            addedLater: "ignored",
          },
        ]),
      )?.insightsPage.items[0]?.trajectoryEvidence,
    ).toEqual([
      {
        status: "available",
        trajectoryId: "trajectory-1",
        eventCount: 1,
        url: "https://app.copilotkit.ai/o/acme/support/trajectories/trajectory-1",
      },
    ]);
    expect(parsed?.skillsPage.items[0]?.sourceInsight).toEqual(
      snapshot.skillsPage.items[0]?.sourceInsight,
    );
  });

  it("accepts Insights from producers that omit Trajectory evidence", () => {
    const snapshot = snapshotWithTrajectoryEvidence([]);
    const [insight] = snapshot.insightsPage.items;
    delete (insight as { totalTrajectoryCount?: number }).totalTrajectoryCount;
    delete (insight as { trajectoryEvidence?: unknown }).trajectoryEvidence;

    const parsed = parseInspectorLearningSnapshotV1(snapshot);

    expect(parsed?.insightsPage.items[0]).toEqual(insight);
    expect(parsed?.insightsPage.items[0]).not.toHaveProperty(
      "trajectoryEvidence",
    );
  });

  it("rejects Trajectory evidence with foreign links or unknown fields", () => {
    for (const invalid of [
      trajectoryEntry({
        url: "https://attacker.example/o/acme/support/trajectories/t",
      }),
      trajectoryEntry({ url: "javascript:alert(1)" }),
      trajectoryEntry({ eventCount: -1 }),
      trajectoryEntry({ trajectoryId: "" }),
      { status: "unavailable", trajectoryId: "former-id" },
      { status: "pending" },
    ]) {
      expect(
        parseInspectorLearningSnapshotV1(
          snapshotWithTrajectoryEvidence([invalid]),
        ),
      ).toBeUndefined();
    }
    const tooMany = snapshotWithTrajectoryEvidence(
      Array.from({ length: 101 }, () => ({ status: "unavailable" })),
    );
    expect(parseInspectorLearningSnapshotV1(tooMany)).toBeUndefined();
  });

  it("accepts only the browser-owned scope and pagination fields", () => {
    expect(
      parseInspectorLearningRequestV1({
        agentId: "support",
        skillsPage: 2,
        insightsPage: 3,
      }),
    ).toEqual({ agentId: "support", skillsPage: 2, insightsPage: 3 });
    expect(
      parseInspectorLearningRequestV1({ runtimeContainerId: "attacker-scope" }),
    ).toBeUndefined();
    expect(parseInspectorLearningRequestV1({ skillsPage: 0 })).toBeUndefined();
  });
});
