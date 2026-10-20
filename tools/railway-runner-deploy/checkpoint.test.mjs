import assert from "node:assert/strict";
import test from "node:test";
import { readAttemptCheckpoint, validateCheckpoint } from "./checkpoint.mjs";
import { STAGING, DEPLOY_WORKFLOW } from "./contract.mjs";
function fixture() {
  const run = {
    id: 123,
    attempt: 2,
    sha: "a".repeat(40),
    workflowPath: DEPLOY_WORKFLOW,
    workflowSha256: "b".repeat(64),
  };
  const context = {
    run,
    releaseSha256: "c".repeat(64),
    operationId: "github-655515393-123",
  };
  const checkpoint = {
    version: 1,
    operationId: context.operationId,
    runId: run.id,
    controlRevision: run.sha,
    workflowSha256: run.workflowSha256,
    releaseSha256: context.releaseSha256,
    stage: "candidate-deployed",
    baselineDeploymentId: "baseline",
    candidateDeploymentId: "candidate",
    rollbackDeploymentId: null,
    templateSha256: "d".repeat(64),
    volumeId: STAGING.volumeId,
    volumeInstanceId: STAGING.volumeInstanceId,
    mountPath: "/data",
  };
  const receipt = {
    schemaVersion: 1,
    ...context,
    run: { ...run, attempt: 1 },
    checkpoint,
    finalState: { verified: false },
    outcome: "unknown",
  };
  const remote = {
    id: 123,
    run_attempt: 1,
    head_sha: run.sha,
    path: DEPLOY_WORKFLOW,
    status: "completed",
    conclusion: "failure",
    repository: { id: 655515393, full_name: "CopilotKit/CopilotKit" },
    head_repository: { id: 655515393, full_name: "CopilotKit/CopilotKit" },
  };
  const github = { run: async () => remote, receipt: async () => receipt };
  return { context, checkpoint, receipt, remote, github };
}
test("only exact prior attempt checkpoint carries drain authority across reruns", async () => {
  const h = fixture();
  assert.deepEqual(
    await readAttemptCheckpoint(h.github, h.context),
    h.checkpoint,
  );
});
for (const mismatch of [
  "run",
  "sha",
  "release",
  "operation",
  "volume",
  "stage",
  "workflow",
  "attempt",
])
  test(`checkpoint rejects ${mismatch} mismatch`, async () => {
    const h = fixture();
    if (mismatch === "run") h.checkpoint.runId = 999;
    if (mismatch === "sha") h.checkpoint.controlRevision = "e".repeat(40);
    if (mismatch === "release") h.checkpoint.releaseSha256 = "e".repeat(64);
    if (mismatch === "operation")
      h.checkpoint.operationId = "github-655515393-999";
    if (mismatch === "volume") h.checkpoint.volumeId = "other";
    if (mismatch === "stage") h.checkpoint.stage = "resumed";
    if (mismatch === "workflow") h.checkpoint.workflowSha256 = "f".repeat(64);
    if (mismatch === "attempt") h.receipt.run.attempt = 0;
    await assert.rejects(readAttemptCheckpoint(h.github, h.context));
  });
test("checkpoint must record original active/latest baseline and no unexpected fields", () => {
  const h = fixture();
  delete h.checkpoint.baselineDeploymentId;
  assert.throws(() => validateCheckpoint(h.checkpoint, h.context));
});
test("third attempt retains first attempt authority through a verified preflight-only failure", async () => {
  const h = fixture();
  h.context.run.attempt = 3;
  const first = h.receipt;
  const second = {
    ...first,
    run: { ...first.run, attempt: 2 },
    providerWorkStarted: false,
  };
  delete second.checkpoint;
  h.github.run = async (id, attempt) => ({ ...h.remote, run_attempt: attempt });
  h.github.receipt = async (run) => (run.run_attempt === 2 ? second : first);
  assert.deepEqual(
    await readAttemptCheckpoint(h.github, h.context),
    h.checkpoint,
  );
  second.providerWorkStarted = true;
  assert.equal(await readAttemptCheckpoint(h.github, h.context), undefined);
});
