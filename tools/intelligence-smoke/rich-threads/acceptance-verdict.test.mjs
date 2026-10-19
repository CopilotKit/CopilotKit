import test from "node:test";
import assert from "node:assert/strict";
import { acceptanceVerdict } from "./acceptance-verdict.mjs";
import { milestone } from "./contract.mjs";
import { reportCleanupVerified } from "./cleanup-verdict.mjs";
const report = () => ({
  milestone,
  provider: "railway",
  purpose: "acceptance",
  cleanup: "passed",
  cleanupEvidence: {
    status: "passed",
    activeResourcesAbsent: true,
    physicalDeletionComplete: true,
    retainedVolumes: [],
    verifiedAt: "2026-10-19T12:00:00.000Z",
    deadlineExceeded: false,
  },
  withinLifetime: true,
  deadlineExceeded: false,
  harnessSuccess: true,
  status: "passed",
  frameworks: [
    { framework: "mastra", status: "passed" },
    { framework: "strands-typescript", status: "passed" },
  ],
});

function pendingReport() {
  const value = report();
  value.cleanup = "passed-pending-provider-deletion";
  const instance = {
    id: "attachment",
    volumeId: "volume",
    environmentId: "environment",
    serviceId: null,
    mountPath: "/data",
    isPendingDeletion: true,
  };
  value.cleanupEvidence = {
    status: value.cleanup,
    activeResourcesAbsent: true,
    physicalDeletionComplete: false,
    verifiedAt: "2026-10-19T12:00:02.000Z",
    deadlineExceeded: false,
    retainedVolumes: [
      {
        volumeId: "volume",
        projectId: "project",
        environmentId: "environment",
        serviceId: "service",
        mountPath: "/data",
        firstVerifiedAt: "2026-10-19T12:00:01.000Z",
        retentionDeadlineAt: "2026-10-21T12:00:01.000Z",
        overdue: false,
        receipt: {
          volumeId: "volume",
          projectId: "project",
          environmentId: "environment",
          startedAt: "2026-10-19T12:00:00.000Z",
          outcome: "acknowledged",
          requestSent: true,
          returnedAt: "2026-10-19T12:00:00.500Z",
          response: true,
        },
        evidence: {
          state: "pending-detached",
          observedAt: "2026-10-19T12:00:01.000Z",
          volumeId: "volume",
          projectId: "project",
          environmentId: "environment",
          instances: [instance],
          environmentReferences: [instance],
          inspectedEnvironmentIds: ["environment"],
          inventoryComplete: true,
        },
      },
    ],
  };
  return value;
}
test("acceptance distinguishes verified pending detachment from physical deletion", () => {
  const value = pendingReport();
  assert.equal(acceptanceVerdict({ report: value, supervisorExit: 0 }), true);
  value.cleanupEvidence.retainedVolumes[0].receipt.outcome = "unknown";
  delete value.cleanupEvidence.retainedVolumes[0].receipt.response;
  assert.equal(acceptanceVerdict({ report: value, supervisorExit: 0 }), true);
});
test("hosted aggregate requires every lifecycle receipt and preserves pending state", () => {
  const complete = { runId: "first", ...report().cleanupEvidence };
  const pending = { runId: "second", ...pendingReport().cleanupEvidence };
  const receipt = {
    cleanup: "passed-pending-provider-deletion",
    cleanupEvidence: [complete, pending],
  };
  assert.equal(reportCleanupVerified(receipt), true);
  receipt.cleanup = "passed";
  assert.equal(reportCleanupVerified(receipt), false);
  receipt.cleanupEvidence = [complete];
  assert.equal(reportCleanupVerified(receipt), true);
  receipt.cleanupEvidence = [complete, complete];
  assert.equal(reportCleanupVerified(receipt), false);
  receipt.cleanupEvidence = [];
  assert.equal(reportCleanupVerified(receipt), false);
});
test("retention reconciliation does not replace the active cleanup timestamp", () => {
  const value = pendingReport();
  const original = value.cleanupEvidence.verifiedAt;
  value.cleanupEvidence.retainedVolumes[0].evidence.observedAt =
    "2026-10-20T12:00:00.000Z";
  assert.equal(reportCleanupVerified(value), false);
  value.cleanupEvidence.retentionReconciledAt = "2026-10-20T12:00:01.000Z";
  assert.equal(reportCleanupVerified(value), true);
  assert.equal(value.cleanupEvidence.verifiedAt, original);
  value.cleanupEvidence.retentionReconciledAt = "2026-10-21T12:00:02.000Z";
  assert.equal(reportCleanupVerified(value), false);
});
test("acceptance rejects markers, attached resources, refusals and contradictory retirement evidence", () => {
  for (const change of [
    (r) => delete r.cleanupEvidence,
    (r) => (r.cleanupEvidence.retainedVolumes = []),
    (r) => (r.cleanupEvidence.physicalDeletionComplete = true),
    (r) => (r.cleanupEvidence.activeResourcesAbsent = false),
    (r) =>
      (r.cleanupEvidence.retainedVolumes[0].evidence.instances[0].serviceId =
        "service"),
    (r) => (r.cleanupEvidence.retainedVolumes[0].evidence.instances = []),
    (r) =>
      (r.cleanupEvidence.retainedVolumes[0].evidence.inventoryComplete = false),
    (r) => (r.cleanupEvidence.retainedVolumes[0].evidence.projectId = "other"),
    (r) => (r.cleanupEvidence.retainedVolumes[0].receipt.outcome = "refused"),
    (r) => (r.cleanupEvidence.retainedVolumes[0].receipt.response = false),
    (r) => (r.cleanupEvidence.retainedVolumes[0].receipt.requestSent = false),
    (r) => delete r.cleanupEvidence.retainedVolumes[0].receipt.requestSent,
    (r) =>
      (r.cleanupEvidence.retainedVolumes[0].retentionDeadlineAt =
        "2026-10-22T12:00:01.000Z"),
    (r) => (r.cleanupEvidence.retainedVolumes[0].overdue = true),
  ]) {
    const value = pendingReport();
    change(value);
    assert.equal(
      acceptanceVerdict({ report: value, supervisorExit: 0 }),
      false,
    );
  }
  const value = report();
  delete value.cleanupEvidence;
  assert.equal(acceptanceVerdict({ report: value, supervisorExit: 0 }), false);
});
test("supervisor failure never becomes an expected assertion success", () => {
  const value = report();
  value.status = "failed";
  value.failureControl = { injected: true, stage: "after-real-journeys" };
  assert.equal(
    acceptanceVerdict({ report: value, supervisorExit: 0, intentional: true }),
    true,
  );
  for (const supervisorExit of [1, null, 137])
    assert.equal(
      acceptanceVerdict({ report: value, supervisorExit, intentional: true }),
      false,
    );
  assert.equal(
    acceptanceVerdict({
      report: value,
      supervisorExit: 0,
      intentional: true,
      cancelled: true,
    }),
    false,
  );
});
test("both distinct real framework reports and verified cleanup are required", () => {
  assert.equal(
    acceptanceVerdict({ report: report(), supervisorExit: 0 }),
    true,
  );
  for (const change of [
    (r) => r.frameworks.pop(),
    (r) => (r.frameworks[1].framework = "mastra"),
    (r) => (r.cleanup = "failed"),
    (r) => (r.provider = "docker"),
    (r) => (r.status = "blocked"),
    (r) => (r.deadlineExceeded = true),
    (r) => (r.withinLifetime = false),
  ]) {
    const value = report();
    change(value);
    assert.equal(
      acceptanceVerdict({ report: value, supervisorExit: 0 }),
      false,
    );
  }
});

test("environment reference evidence must come from inspected environments", () => {
  const value = pendingReport();
  value.cleanupEvidence.retainedVolumes[0].evidence.inspectedEnvironmentIds =
    [];
  assert.equal(reportCleanupVerified(value), false);
  value.cleanupEvidence.retainedVolumes[0].evidence.environmentReferences = [];
  assert.equal(reportCleanupVerified(value), true);
});
