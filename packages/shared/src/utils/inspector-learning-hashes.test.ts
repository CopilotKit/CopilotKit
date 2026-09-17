import { expect, test } from "vitest";
import { parseInspectorLearningSnapshotV1 } from "./inspector-learning.js";

function setup(hashes: unknown = ["a".repeat(64)]) {
  const insight = {
    id: "insight-1",
    statement: "Ask for the order.",
    impact: "Avoid wrong refunds.",
    totalThreadCount: 1,
    evidenceTruncated: false,
    evidence: [
      {
        status: "available",
        threadId: "thread-1",
        threadName: null,
        messageIds: ["message-1"],
        messageHashes: hashes,
        updatedAt: "2026-09-17T12:00:00.000Z",
      },
    ],
  };
  const snapshot = {
    schemaVersion: 1,
    projectKey: "project-1",
    snapshotVersion: "snapshot-1",
    webAppOrigin: "https://app.example.test",
    configuration: { state: "not_configured" },
    pendingThreadCount: 0,
    pendingCandidateCount: 0,
    run: { hasActiveRun: false, hasEverSucceeded: false, latest: null },
    skillsPage: { page: 1, pageSize: 3, total: 0, totalPages: 0, items: [] },
    insightsPage: {
      page: 1,
      pageSize: 4,
      total: 1,
      totalPages: 1,
      items: [insight],
    },
    links: {
      learning: "https://app.example.test/learning",
      candidates: null,
      runs: null,
    },
  };
  return { insight, snapshot };
}

test.each([
  [],
  ["bad"],
  ["a".repeat(64), "b".repeat(64)],
  "a".repeat(64),
  [42],
])("rejects misaligned or malformed evidence hashes: %j", (hashes) => {
  const { snapshot } = setup(hashes);
  expect(parseInspectorLearningSnapshotV1(snapshot) !== undefined).toBe(false);
});

test("preserves valid hashes and permits old producers and unverifiable messages", () => {
  const { insight, snapshot } = setup();
  const parsed =
    parseInspectorLearningSnapshotV1(snapshot)?.insightsPage.items[0];
  expect(parsed?.evidence[0]).toMatchObject({
    messageHashes: ["a".repeat(64)],
  });
  insight.evidence[0]!.messageHashes = [null];
  expect(parseInspectorLearningSnapshotV1(snapshot) !== undefined).toBe(true);
  insight.evidence[0]!.messageHashes = undefined;
  expect(parseInspectorLearningSnapshotV1(snapshot) !== undefined).toBe(true);
});
