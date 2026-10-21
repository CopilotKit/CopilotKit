import assert from "node:assert/strict";
import test from "node:test";
import * as checkpoints from "./checkpoint.mjs";
import { DEV_DEPLOY_WORKFLOW } from "./contract.mjs";

const original = {
  schemaVersion: 1,
  releaseSha256:
    "a15a28af25a2c3844547e7c9b1655876dca903f4591581ef31a91d26fcc1f2a7",
  run: {
    id: 39522351205,
    attempt: 1,
    sha: "abc6807f35865e043c498398e3080f137ddbdad9",
    workflowPath: ".github/workflows/intelligence-rich-threads-deploy.yml",
    workflowSha256:
      "f5b6763923082c953ddcb5462cd72d202045304413ebc69a17cbdaad85330f89",
  },
  operationId: "github-655515393-39522351205",
  outcome: "unknown",
  providerWorkStarted: true,
  finalState: {
    verified: false,
  },
  checkpoint: {
    version: 3,
    operationId: "github-655515393-39522351205",
    runId: 39522351205,
    controlRevision: "abc6807f35865e043c498398e3080f137ddbdad9",
    workflowSha256:
      "f5b6763923082c953ddcb5462cd72d202045304413ebc69a17cbdaad85330f89",
    releaseSha256:
      "a15a28af25a2c3844547e7c9b1655876dca903f4591581ef31a91d26fcc1f2a7",
    stage: "remove-requested",
    removalProof: null,
    removalRequest: {
      outcome: "acknowledged",
      response: true,
    },
    baselineDeploymentId: "41d9b023-1870-444f-8889-c369e26faa54",
    candidateDeploymentId: null,
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
    id: 39522351205,
    run_attempt: 1,
    head_sha: original.run.sha,
    head_branch: "main",
    path: original.run.workflowPath,
    status: "completed",
    conclusion: "failure",
    repository: { id: 655515393, full_name: "CopilotKit/CopilotKit" },
    head_repository: { id: 655515393, full_name: "CopilotKit/CopilotKit" },
  };
  const context = {
    operationId: "github-655515393-123",
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
    ref: "refs/heads/dev/railway-runner-controlled-test-once",
    github: {
      run: async (id, attempt) => {
        assert.equal(id, 39522351205);
        assert.equal(attempt, 1);
        return run;
      },
      receipt: async () => receipt,
    },
  };
}
test("one-time continuation authenticates the exact interrupted checkpoint and rebinds only its workflow owner", async () => {
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
])
  test(`one-time continuation rejects ${defect}`, async () => {
    const h = fixture();
    if (defect === "branch") h.ref = "refs/heads/main";
    if (defect === "attempt") h.context.run.attempt = 2;
    if (defect === "workflow")
      h.context.run.workflowPath = original.run.workflowPath;
    if (defect === "release") h.context.releaseSha256 = "c".repeat(64);
    if (defect === "source-sha") h.run.head_sha = "d".repeat(40);
    if (defect === "source-repo") h.run.repository.id = 1;
    if (defect === "source-outcome") h.run.conclusion = "success";
    if (defect === "receipt-run") h.receipt.run.id = 42;
    if (defect === "checkpoint-volume")
      h.receipt.checkpoint.volumeId = "foreign";
    if (defect === "checkpoint-stage") h.receipt.checkpoint.stage = "removed";
    if (defect === "candidate")
      h.receipt.checkpoint.candidateDeploymentId = "unexpected";
    if (defect === "removal-outcome")
      h.receipt.checkpoint.removalRequest = {
        outcome: "unknown",
        response: null,
      };
    await assert.rejects(() =>
      checkpoints.readOneTimeStagingCheckpoint(h.github, h.context, h.ref),
    );
  });
