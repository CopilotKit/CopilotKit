import assert from "node:assert/strict";
import test from "node:test";
import * as checkpoints from "./checkpoint.mjs";
import { DEV_DEPLOY_WORKFLOW } from "./contract.mjs";

const original = {
  schemaVersion: 1,
  releaseSha256:
    "a15a28af25a2c3844547e7c9b1655876dca903f4591581ef31a91d26fcc1f2a7",
  run: {
    id: 39540863388,
    attempt: 1,
    sha: "6a00aeb6b634c96a41e5f7b8abb0e8538cd14034",
    workflowPath: ".github/workflows/intelligence-rich-threads-dev.yml",
    workflowSha256:
      "33c7b9facd2fe8747d1b4ac631c3a22a4f5cbc6a2cfb840584772cbeedfff4a4",
  },
  continuedFromRun: 39522351205,
  operationId: "github-655515393-39540863388",
  outcome: "unknown",
  providerWorkStarted: true,
  finalState: {
    verified: false,
  },
  checkpoint: {
    version: 3,
    operationId: "github-655515393-39540863388",
    runId: 39540863388,
    controlRevision: "6a00aeb6b634c96a41e5f7b8abb0e8538cd14034",
    workflowSha256:
      "33c7b9facd2fe8747d1b4ac631c3a22a4f5cbc6a2cfb840584772cbeedfff4a4",
    releaseSha256:
      "a15a28af25a2c3844547e7c9b1655876dca903f4591581ef31a91d26fcc1f2a7",
    stage: "candidate-deployed",
    removalProof: {
      version: 1,
      method: "deploymentRemove",
      deploymentId: "41d9b023-1870-444f-8889-c369e26faa54",
      status: "REMOVED",
      image:
        "ghcr.io/copilotkit/rich-thread-runner@sha256:8db845b5d2b427317524254ff58b3e18db69046b9e75d950b6dc967c004a0019",
      projectId: "6f8c6bff-a80d-4f8f-b78d-50b32bcf4479",
      environmentId: "8edfef02-ea09-4a20-8689-261f21cc2849",
      serviceId: "4922b45b-6981-4559-be2f-fbbca9123323",
      volumeId: "2a70e47d-85d4-4a8a-b17b-b6788c91b1c7",
      volumeInstanceId: "f3187181-2fb7-4d3e-a9dc-c80eac894895",
      mountPath: "/data",
      observedAt: "2026-10-21T03:52:24.919Z",
    },
    removalRequest: {
      outcome: "acknowledged",
      response: true,
    },
    baselineDeploymentId: "41d9b023-1870-444f-8889-c369e26faa54",
    candidateDeploymentId: "63b508a4-beda-4f78-8a91-591a9aa32e0b",
    rollbackDeploymentId: null,
    templateSha256:
      "ba76d57e7311faf9b9cb988851b23f34ad1e17285bdd2208e3680fdf527a03c9",
    volumeId: "2a70e47d-85d4-4a8a-b17b-b6788c91b1c7",
    volumeInstanceId: "f3187181-2fb7-4d3e-a9dc-c80eac894895",
    mountPath: "/data",
  },
};
function fixture() {
  const receipt = structuredClone(original);
  const run = {
    id: 39540863388,
    run_attempt: 1,
    head_sha: original.run.sha,
    head_branch: "dev/railway-runner-controlled-test-once",
    path: original.run.workflowPath,
    status: "completed",
    conclusion: "failure",
    repository: { id: 655515393, full_name: "CopilotKit/CopilotKit" },
    head_repository: { id: 655515393, full_name: "CopilotKit/CopilotKit" },
  };
  const context = {
    operationId: "github-655515393-39540863388",
    releaseSha256: original.releaseSha256,
    run: {
      id: 123,
      attempt: 1,
      sha: "a".repeat(40),
      workflowPath: DEV_DEPLOY_WORKFLOW,
      workflowSha256: "b".repeat(64),
    },
  };
  return {
    receipt,
    run,
    context,
    ref: "refs/heads/dev/railway-runner-watch-test-once",
    github: {
      run: async (id, attempt) => {
        assert.equal(id, 39540863388);
        assert.equal(attempt, 1);
        return run;
      },
      receipt: async () => receipt,
    },
  };
}
test("one-time continuation authenticates the deployed candidate and preserves its owner across execution provenance", async () => {
  const h = fixture();
  const value = await checkpoints.readOneTimeStagingCheckpoint(
    h.github,
    h.context,
    h.ref,
  );
  assert.deepEqual(value, {
    ...original.checkpoint,
    operationId: h.context.operationId,
    runId: 123,
    controlRevision: h.context.run.sha,
    workflowSha256: h.context.run.workflowSha256,
  });
  assert.equal(value.operationId, original.operationId);
  assert.deepEqual(h.receipt, original);
  checkpoints.validateCheckpoint(value, h.context);
});
for (const defect of [
  "branch",
  "attempt",
  "workflow",
  "release",
  "source-sha",
  "source-repo",
  "source-outcome",
  "receipt-run",
  "checkpoint-volume",
  "checkpoint-stage",
  "candidate",
  "removal-outcome",
  "owner",
])
  test(`one-time continuation rejects ${defect}`, async () => {
    const h = fixture();
    if (defect === "owner") h.context.operationId = "github-655515393-123";
    if (defect === "branch") h.ref = "refs/heads/main";
    if (defect === "attempt") h.context.run.attempt = 2;
    if (defect === "workflow")
      h.context.run.workflowPath =
        ".github/workflows/intelligence-rich-threads-deploy.yml";
    if (defect === "release") h.context.releaseSha256 = "c".repeat(64);
    if (defect === "source-sha") h.run.head_sha = "d".repeat(40);
    if (defect === "source-repo") h.run.repository.id = 1;
    if (defect === "source-outcome") h.run.conclusion = "success";
    if (defect === "receipt-run") h.receipt.run.id = 42;
    if (defect === "checkpoint-volume")
      h.receipt.checkpoint.volumeId = "foreign";
    if (defect === "checkpoint-stage")
      h.receipt.checkpoint.stage = "resume-requested";
    if (defect === "candidate")
      h.receipt.checkpoint.candidateDeploymentId = null;
    if (defect === "removal-outcome")
      h.receipt.checkpoint.removalRequest = {
        outcome: "unknown",
        response: null,
      };
    await assert.rejects(() =>
      checkpoints.readOneTimeStagingCheckpoint(h.github, h.context, h.ref),
    );
  });
