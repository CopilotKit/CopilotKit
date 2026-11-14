import { equal, requireThat, validateVolume, SHA256 } from "./contract.mjs";
import { validateCheckpoint } from "./checkpoint.mjs";
import {
  recoveryAuthorization,
  validateRecovery,
  RECOVERY_BASELINE_IMAGE,
} from "./recovery-contract.mjs";

/** Incident-specific bridge. A durable watch is retained ownership, never cancellation proof. */
export async function deployRecoveryRunner({
  release,
  operationId,
  runner,
  railway,
  clock = Date.now,
  sleep,
  deadline = clock() + 210 * 60000,
  receipt = async () => {},
  provenance = {},
  previousCheckpoint,
}) {
  const { baseline, candidate, recovery } = release;
  requireThat(
    baseline.image === RECOVERY_BASELINE_IMAGE &&
      candidate.image !== RECOVERY_BASELINE_IMAGE,
    "Recovery image mismatch",
  );
  validateRecovery(
    recovery,
    baseline.runtimeIdentity,
    candidate.runtimeIdentity,
  );
  requireThat(
    /^github-655515393-\d+$/.test(operationId),
    "Invalid recovery owner",
  );
  let checkpoint = previousCheckpoint;
  const context = { ...provenance, operationId };
  if (checkpoint) {
    validateCheckpoint(checkpoint, context);
    requireThat(
      !checkpoint.rollbackDeploymentId &&
        [
          "candidate-requested",
          "candidate-deployed",
          "resume-requested",
        ].includes(checkpoint.stage),
      "Invalid recovery checkpoint",
    );
  }
  let templateSha256 = checkpoint?.templateSha256;
  let result = {
    schemaVersion: 1,
    ...provenance,
    operationId,
    outcome: "unknown",
    providerWorkStarted: true,
    finalState: { verified: false },
    ...(checkpoint ? { checkpoint } : {}),
  };
  await receipt(result);
  const checkTime = () =>
    requireThat(
      clock() < deadline,
      "Recovery deadline exceeded; fence retained",
    );
  const inspect = async () => {
    checkTime();
    const value = await railway.inspect({ allowNoActive: Boolean(checkpoint) });
    validateVolume(value);
    return value;
  };
  const get = async () => {
    checkTime();
    const state = await runner.get();
    requireThat(
      state.protocolVersion === 1 && SHA256.test(state.templateSha256),
      "Invalid recovery protocol",
    );
    if (templateSha256)
      requireThat(
        state.templateSha256 === templateSha256,
        "Recovery template changed",
      );
    else templateSha256 = state.templateSha256;
    return state;
  };
  const actual = (provider, target, id) => {
    requireThat(
      provider.configuredImage === target.image &&
        provider.active?.image === target.image &&
        provider.active.status === "SUCCESS" &&
        provider.latest?.id === provider.active.id &&
        provider.latest.status === "SUCCESS",
      "Recovery image proof incomplete",
    );
    if (id)
      requireThat(provider.active.id === id, "Recovery deployment changed");
  };
  const owned = (state, replacement) => {
    const op = state.operation;
    requireThat(
      op?.version === 1 &&
        op.operationId === operationId &&
        op.templateSha256 === templateSha256 &&
        equal(op.baselineIdentity, baseline.runtimeIdentity),
      "Recovery fence owner mismatch",
    );
    requireThat(
      equal(
        op.targetIdentity,
        replacement ? candidate.runtimeIdentity : baseline.runtimeIdentity,
      ),
      "Recovery fence target mismatch",
    );
    requireThat(
      replacement
        ? op.kind === "bounded-environment-retry"
        : op.kind === undefined,
      "Recovery fence kind mismatch",
    );
    requireThat(
      equal(
        state.runtimeIdentity,
        replacement ? candidate.runtimeIdentity : baseline.runtimeIdentity,
      ),
      "Recovery runtime changed",
    );
  };
  const legacyBlocked = (state) => {
    owned(state, false);
    requireThat(
      state.phase === "draining" &&
        state.operation.status === "draining" &&
        state.busy === false &&
        state.blocked === true &&
        state.active === recovery.runnerRunId,
      "Exact failed legacy run required",
    );
  };
  const watch = (state) => {
    const value = state.recovery;
    requireThat(
      value?.status === "watching" &&
        value.operationId === operationId &&
        value.runnerRunId === recovery.runnerRunId &&
        value.lifecycleRunId === recovery.lifecycleRunId &&
        SHA256.test(value.oldJournalSha256) &&
        SHA256.test(value.watchSha256) &&
        Number.isInteger(value.observationCount) &&
        value.observationCount > 0 &&
        Number.isFinite(Date.parse(value.lastVerifiedAt)) &&
        value.providerFinality === "unknown" &&
        value.originalStatus === "failed" &&
        value.deadlineExceeded === true,
      "Retained ownership evidence incomplete",
    );
    requireThat(
      state.busy === false && state.active === null && state.blocked === false,
      "Recovery admission not ready",
    );
    return value;
  };
  const save = async (stage, fields = {}) => {
    checkpoint = { ...checkpoint, ...fields, stage };
    validateCheckpoint(checkpoint, context);
    result = { ...result, checkpoint };
    await receipt(result);
  };
  try {
    let provider = await inspect();
    let state = await get();
    if (equal(state.runtimeIdentity, baseline.runtimeIdentity)) {
      // Never repeat a possibly accepted deploy. A later workflow attempt may only adopt
      // a fully verified replacement; absence of a new deployment is not cancellation.
      requireThat(
        !checkpoint,
        "Prior recovery deployment unresolved; fence retained",
      );
      actual(provider, baseline);
      if (state.operation?.operationId !== operationId) {
        requireThat(
          state.phase === "running" &&
            (!state.operation || state.operation.status === "resumed") &&
            state.busy === false &&
            state.blocked === true &&
            state.active === recovery.runnerRunId,
          "Exact failed baseline required",
        );
        try {
          await runner.drain({
            operationId,
            targetIdentity: baseline.runtimeIdentity,
          });
        } catch {
          // The old runner can reject cleanup after durably writing its fence.
          // Only the subsequent exact read establishes authority to continue.
        }
        state = await get();
      }
      legacyBlocked(state);
      provider = await inspect();
      actual(provider, baseline);
      checkpoint = {
        version: 1,
        operationId,
        runId: provenance.run.id,
        controlRevision: provenance.run.sha,
        workflowSha256: provenance.run.workflowSha256,
        releaseSha256: provenance.releaseSha256,
        stage: "candidate-requested",
        baselineDeploymentId: provider.active.id,
        candidateDeploymentId: null,
        rollbackDeploymentId: null,
        templateSha256,
        volumeId: provider.volumeId,
        volumeInstanceId: provider.volumeInstanceId,
        mountPath: provider.mountPath,
      };
      await save("candidate-requested");
      await railway.setRecoveryAuthorization(
        recoveryAuthorization(release, operationId, templateSha256),
      );
      legacyBlocked(await get());
      actual(await inspect(), baseline, checkpoint.baselineDeploymentId);
      await railway.setImage(candidate.image);
      const id = await railway.deploy();
      requireThat(
        typeof id === "string" &&
          id.length > 0 &&
          id !== checkpoint.baselineDeploymentId,
        "New recovery deployment required",
      );
      await save("candidate-deployed", { candidateDeploymentId: id });
      for (;;) {
        checkTime();
        const value = await railway.deployment(id);
        requireThat(value.id === id, "Recovery deployment identity mismatch");
        if (value.status === "SUCCESS") break;
        requireThat(
          [
            "INITIALIZING",
            "QUEUED",
            "BUILDING",
            "DEPLOYING",
            "WAITING",
          ].includes(value.status),
          "Recovery deployment failed; fence retained",
        );
        await sleep(Math.min(5000, deadline - clock()));
      }
      state = await get();
      provider = await inspect();
    }
    requireThat(checkpoint, "Recovery deployment checkpoint required");
    owned(state, true);
    actual(provider, candidate, checkpoint.candidateDeploymentId);
    requireThat(
      provider.active.id !== checkpoint.baselineDeploymentId,
      "New recovery deployment required",
    );
    if (!checkpoint.candidateDeploymentId)
      await save("candidate-deployed", {
        candidateDeploymentId: provider.active.id,
      });
    if (state.operation.status !== "resumed") {
      requireThat(
        ["draining", "recovery-ready"].includes(state.phase) &&
          state.busy === false,
        "Recovery fence not ready",
      );
      if (state.operation.status !== "recovery-ready") {
        await runner.recover({
          operationId,
          expectedRuntimeIdentity: candidate.runtimeIdentity,
        });
        state = await get();
        owned(state, true);
      }
      requireThat(
        state.phase === "recovery-ready" &&
          state.operation.status === "recovery-ready",
        "Explicit recovery required",
      );
      watch(state);
      actual(await inspect(), candidate, checkpoint.candidateDeploymentId);
      await save("resume-requested");
      await runner.resume({
        operationId,
        expectedRuntimeIdentity: candidate.runtimeIdentity,
      });
      state = await get();
    }
    owned(state, true);
    const retained = watch(state);
    requireThat(
      state.phase === "running" && state.operation.status === "resumed",
      "Recovery resume unverified",
    );
    provider = await inspect();
    actual(provider, candidate, checkpoint.candidateDeploymentId);
    result = {
      ...result,
      outcome: "deployed",
      recovery: retained,
      finalState: {
        verified: true,
        image: candidate.image,
        runtimeIdentity: candidate.runtimeIdentity,
        deploymentId: provider.active.id,
        templateSha256,
        volumeId: provider.volumeId,
        volumeInstanceId: provider.volumeInstanceId,
        mountPath: provider.mountPath,
        phase: "running",
      },
    };
    await receipt(result);
    return result;
  } catch (error) {
    await receipt(result);
    throw error;
  }
}
