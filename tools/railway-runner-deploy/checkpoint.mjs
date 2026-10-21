import {
  DEPLOY_WORKFLOW,
  DEV_DEPLOY_WORKFLOW,
  SHA256,
  equal,
  requireThat,
  validateVolume,
} from "./contract.mjs";
import {
  bindingDigest,
  validateRemovalProof,
} from "./second-recovery-contract.mjs";
import { validateRun } from "./provenance.mjs";

const stages = [
  "candidate-requested",
  "candidate-deployed",
  "rollback-requested",
  "rollback-deployed",
  "resume-requested",
];
const removedStages = [
  "remove-requested",
  "removed",
  "candidate-requested",
  "candidate-deployed",
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
          ...(value.version === 3 ? ["removalProof", "removalRequest"] : []),
        ].sort(),
      ),
    "Invalid deployment checkpoint",
  );
  requireThat(
    [1, 3].includes(value.version) &&
      value.operationId === operationId &&
      value.runId === run.id &&
      value.controlRevision === run.sha &&
      value.workflowSha256 === run.workflowSha256 &&
      value.releaseSha256 === releaseSha256 &&
      SHA256.test(value.templateSha256) &&
      (value.version === 3 ? removedStages : stages).includes(value.stage),
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
  if (value.version === 3)
    requireThat(
      value.rollbackDeploymentId === null &&
        (!["remove-requested", "removed"].includes(value.stage) ||
          value.candidateDeploymentId === null) &&
        (!["candidate-deployed", "resume-requested"].includes(value.stage) ||
          value.candidateDeploymentId !== null),
      "Invalid removal handoff checkpoint",
    );
  if (value.version === 3) {
    const request = value.removalRequest;
    requireThat(
      request && equal(Object.keys(request).sort(), ["outcome", "response"]),
      "Removal request receipt required",
    );
    requireThat(
      ["pending", "acknowledged", "unknown", "refused"].includes(
        request.outcome,
      ) &&
        request.response ===
          (request.outcome === "acknowledged"
            ? true
            : request.outcome === "refused"
              ? false
              : null),
      "Invalid removal request outcome",
    );
    if (value.stage === "remove-requested")
      requireThat(value.removalProof === null, "Unconfirmed removal proof");
    else validateRemovalProof(value.removalProof);
  }
  validateVolume(value);
  return value;
}
/** Recover authority across at most twenty authenticated preflight-only attempts. */
export async function readAttemptCheckpoint(github, context) {
  const { run } = context;
  requireThat(
    [DEPLOY_WORKFLOW, DEV_DEPLOY_WORKFLOW].includes(run.workflowPath),
    "Unsupported checkpoint workflow",
  );
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
      workflowPath: run.workflowPath,
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

/** Temporary continuation of this one interrupted staging operation; revert after live proof. */
export async function readOneTimeStagingCheckpoint(github, context, ref) {
  requireThat(
    ref === "refs/heads/dev/railway-runner-controlled-test-once" &&
      context.run.workflowPath === DEV_DEPLOY_WORKFLOW &&
      context.run.attempt === 1,
    "One-time staging continuation context refused",
  );
  const source = {
    operationId: "github-655515393-39522351205",
    releaseSha256:
      "a15a28af25a2c3844547e7c9b1655876dca903f4591581ef31a91d26fcc1f2a7",
    run: {
      id: 39522351205,
      attempt: 1,
      sha: "abc6807f35865e043c498398e3080f137ddbdad9",
      workflowPath: DEPLOY_WORKFLOW,
      workflowSha256:
        "f5b6763923082c953ddcb5462cd72d202045304413ebc69a17cbdaad85330f89",
    },
  };
  const run = await github.run(source.run.id, source.run.attempt);
  validateRun(run, {
    runId: source.run.id,
    runAttempt: source.run.attempt,
    sourceRevision: source.run.sha,
    workflowPath: DEPLOY_WORKFLOW,
    success: false,
  });
  requireThat(
    run.head_branch === "main" && run.conclusion === "failure",
    "Interrupted source run changed",
  );
  // The existing reader authenticates the artifact and the source workflow bytes.
  const receipt = await github.receipt(run);
  requireThat(
    receipt.schemaVersion === 1 &&
      receipt.operationId === source.operationId &&
      receipt.releaseSha256 === source.releaseSha256 &&
      context.releaseSha256 === source.releaseSha256 &&
      equal(receipt.run, source.run) &&
      bindingDigest(receipt.checkpoint) ===
        "505a5f32c2425f6069a2e384e7f4dccf13947d76dbcff29e0a8233e648f882ff",
    "Exact interrupted checkpoint required",
  );
  validateCheckpoint(receipt.checkpoint, source);
  return validateCheckpoint(
    {
      ...receipt.checkpoint,
      operationId: context.operationId,
      runId: context.run.id,
      controlRevision: context.run.sha,
      workflowSha256: context.run.workflowSha256,
    },
    context,
  );
}
