import {
  DEPLOY_WORKFLOW,
  SHA256,
  equal,
  requireThat,
  validateVolume,
} from "./contract.mjs";
import { validateRun } from "./provenance.mjs";

const stages = [
  "candidate-requested",
  "candidate-deployed",
  "rollback-requested",
  "rollback-deployed",
  "resume-requested",
];
/** Validate the exact saved drain proof; an unverified final state is never authority. */
export function validateCheckpoint(value, { run, releaseSha256, operationId }) {
  requireThat(
    value &&
      equal(
        Object.keys(value).sort(),
        [
          "version",
          "operationId",
          "runId",
          "controlRevision",
          "workflowSha256",
          "releaseSha256",
          "stage",
          "baselineDeploymentId",
          "candidateDeploymentId",
          "rollbackDeploymentId",
          "templateSha256",
          "volumeId",
          "volumeInstanceId",
          "mountPath",
        ].sort(),
      ),
    "Invalid deployment checkpoint",
  );
  requireThat(
    value.version === 1 &&
      value.operationId === operationId &&
      value.runId === run.id &&
      value.controlRevision === run.sha &&
      value.workflowSha256 === run.workflowSha256 &&
      value.releaseSha256 === releaseSha256 &&
      SHA256.test(value.templateSha256) &&
      stages.includes(value.stage),
    "Deployment checkpoint provenance mismatch",
  );
  requireThat(
    typeof value.baselineDeploymentId === "string" &&
      value.baselineDeploymentId.length > 0,
    "Checkpoint baseline required",
  );
  for (const key of ["candidateDeploymentId", "rollbackDeploymentId"])
    requireThat(
      value[key] === null ||
        (typeof value[key] === "string" &&
          value[key].length > 0 &&
          value[key] !== value.baselineDeploymentId),
      "Invalid checkpoint deployment identity",
    );
  validateVolume(value);
  return value;
}
/** Recover authority across at most twenty authenticated preflight-only attempts. */
export async function readAttemptCheckpoint(github, context) {
  const { run } = context;
  for (
    let attempt = run.attempt - 1, visited = 0;
    attempt >= 1;
    attempt--, visited++
  ) {
    requireThat(visited < 20, "Checkpoint history exceeds bound");
    const previous = await github.run(run.id, attempt);
    validateRun(previous, {
      runId: run.id,
      runAttempt: attempt,
      sourceRevision: run.sha,
      workflowPath: DEPLOY_WORKFLOW,
      success: false,
    });
    const receipt = await github.receipt(previous);
    requireThat(
      receipt.schemaVersion === 1 &&
        receipt.operationId === context.operationId &&
        receipt.releaseSha256 === context.releaseSha256 &&
        equal(receipt.run, { ...run, attempt }),
      "Previous attempt receipt mismatch",
    );
    if (receipt.checkpoint !== undefined)
      return validateCheckpoint(receipt.checkpoint, context);
    // A newer attempt that entered provider work is a hard history boundary.
    if (receipt.providerWorkStarted !== false) return undefined;
  }
  return undefined;
}
