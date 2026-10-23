import { validateCheckpoint } from "./checkpoint.mjs";
import {
  equal,
  compatible,
  requireThat,
  validateVolume,
  SHA256,
} from "./contract.mjs";

const failedStatuses = new Set(["FAILED", "CRASHED"]);
/** Check that recovery has cleared every cleanup owner before replacing the image. */
const clean = (state) =>
  state.phase === "drained" &&
  state.operation.status === "drained" &&
  state.busy === false &&
  state.active === null &&
  state.blocked === false;

/** Roll out one reviewed image while a durable runner operation owns admission. */
export async function deployReviewedRunner({
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
  compatible(
    release.baseline.runtimeIdentity,
    release.candidate.runtimeIdentity,
  );
  requireThat(
    /^github-655515393-\d+$/.test(operationId),
    "Invalid deployment owner",
  );
  const { baseline, candidate } = release;
  let checkpoint = previousCheckpoint;
  const checkpointContext = { ...provenance, operationId };
  if (checkpoint) validateCheckpoint(checkpoint, checkpointContext);
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
      "Deployment deadline exceeded; drain retained",
    );
  const pause = async () => {
    checkTime();
    await sleep(Math.min(5000, deadline - clock()));
    checkTime();
  };
  const inspect = async (allowNoActive = false) => {
    checkTime();
    const state = await railway.inspect({ allowNoActive });
    validateVolume(state);
    return state;
  };
  const runnerState = async () => {
    checkTime();
    const state = await runner.get();
    requireThat(
      state.protocolVersion === 1 && SHA256.test(state.templateSha256),
      "Invalid deployment protocol",
    );
    requireThat(
      ["running", "draining", "drained"].includes(state.phase),
      "Runner recovery failed",
    );
    if (templateSha256)
      requireThat(
        state.templateSha256 === templateSha256,
        "Retained template changed",
      );
    return state;
  };
  const owned = (state) => {
    const op = state.operation;
    requireThat(
      op?.version === 1 && op.operationId === operationId,
      "Deployment owner mismatch",
    );
    requireThat(
      equal(op.baselineIdentity, baseline.runtimeIdentity) &&
        equal(op.targetIdentity, candidate.runtimeIdentity),
      "Deployment identity mismatch",
    );
    requireThat(
      op.templateSha256 === templateSha256,
      "Retained template changed",
    );
    requireThat(
      ["draining", "drained", "resumed"].includes(op.status),
      "Invalid operation status",
    );
  };
  const actual = (
    state,
    target,
    expectedId,
    allowConfiguredCandidate = false,
  ) => {
    requireThat(
      state.configuredImage === target.image ||
        (allowConfiguredCandidate && state.configuredImage === candidate.image),
      "Configured image mismatch",
    );
    requireThat(
      state.active?.status === "SUCCESS" && state.active.image === target.image,
      "Actual active image mismatch",
    );
    requireThat(
      state.latest?.id === state.active.id && state.latest.status === "SUCCESS",
      "Ambiguous active deployment",
    );
    if (expectedId)
      requireThat(
        state.active.id === expectedId,
        "Active deployment identity mismatch",
      );
  };
  const waitDrain = async (target) => {
    for (;;) {
      const state = await runnerState();
      owned(state);
      requireThat(
        equal(state.runtimeIdentity, target.runtimeIdentity),
        "Runtime identity mismatch",
      );
      requireThat(
        state.operation.status !== "resumed",
        "Drain unexpectedly resumed",
      );
      if (clean(state)) return state;
      await pause();
    }
  };
  const finish = async (target, outcome, expectedId) => {
    const provider = await inspect();
    actual(provider, target, expectedId);
    const state = await runnerState();
    owned(state);
    requireThat(
      equal(state.runtimeIdentity, target.runtimeIdentity) &&
        state.phase === "running" &&
        state.operation.status === "resumed" &&
        state.blocked === false,
      "Resume proof incomplete",
    );
    result = {
      ...result,
      outcome,
      finalState: {
        verified: true,
        image: target.image,
        runtimeIdentity: target.runtimeIdentity,
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
  };
  const saveCheckpoint = async (stage, fields = {}) => {
    checkpoint = { ...checkpoint, ...fields, stage };
    validateCheckpoint(checkpoint, checkpointContext);
    result = { ...result, checkpoint };
    await receipt(result);
  };
  const resume = async (target, id, outcome) => {
    const provider = await inspect();
    actual(provider, target, id);
    await waitDrain(target);
    if (checkpoint) await saveCheckpoint("resume-requested");
    await runner.resume({
      operationId,
      expectedRuntimeIdentity: target.runtimeIdentity,
    });
    return finish(target, outcome, id);
  };
  const deploy = async (target, previousId) => {
    await saveCheckpoint(
      target === candidate ? "candidate-requested" : "rollback-requested",
    );
    await railway.setImage(target.image);
    const id = await railway.deploy();
    requireThat(
      typeof id === "string" && id.length > 0 && id !== previousId,
      "New deployment identity required",
    );
    await saveCheckpoint(
      target === candidate ? "candidate-deployed" : "rollback-deployed",
      target === candidate
        ? { candidateDeploymentId: id }
        : { rollbackDeploymentId: id },
    );
    for (;;) {
      checkTime();
      const state = await railway.deployment(id);
      requireThat(state.id === id, "Provider deployment identity changed");
      if (failedStatuses.has(state.status)) return { id, failed: true };
      if (state.status === "SUCCESS") return { id, failed: false };
      requireThat(
        ["INITIALIZING", "QUEUED", "BUILDING", "DEPLOYING", "WAITING"].includes(
          state.status,
        ),
        "Unknown deployment status",
      );
      await pause();
    }
  };
  const rollbackFailedCandidate = async (failed) => {
    requireThat(
      checkpoint &&
        [
          "candidate-requested",
          "candidate-deployed",
          "rollback-requested",
        ].includes(checkpoint.stage) &&
        checkpoint.candidateDeploymentId === failed.latest?.id &&
        failed.latest.image === candidate.image &&
        failedStatuses.has(failed.latest.status) &&
        (failed.configuredImage === candidate.image ||
          (checkpoint.stage === "rollback-requested" &&
            failed.configuredImage === baseline.image)),
      "Rollback deployment proof incomplete",
    );
    requireThat(
      !failed.active ||
        (failed.active.id === checkpoint.baselineDeploymentId &&
          failed.active.image === baseline.image &&
          failed.active.status === "SUCCESS"),
      "Unexpected active deployment during rollback",
    );
    // A reachable runner can disprove saved authority; only temporary unavailability permits the saved proof alone.
    const live = runner.probe ? await runner.probe() : null;
    if (live) {
      owned(live);
      requireThat(
        live.protocolVersion === 1 &&
          live.templateSha256 === templateSha256 &&
          clean(live) &&
          (equal(live.runtimeIdentity, baseline.runtimeIdentity) ||
            equal(live.runtimeIdentity, candidate.runtimeIdentity)),
        "Live rollback drain proof changed",
      );
    }
    const rollback = await deploy(baseline, failed.latest.id);
    requireThat(!rollback.failed, "Rollback failed; drain retained");
    await resume(baseline, rollback.id, "rolled-back");
    throw new Error("Runner rolled back; candidate failed");
  };
  try {
    const initial = await inspect(Boolean(checkpoint));
    if (
      checkpoint &&
      [
        "candidate-requested",
        "candidate-deployed",
        "rollback-requested",
      ].includes(checkpoint.stage) &&
      checkpoint.candidateDeploymentId &&
      initial.latest?.id === checkpoint.candidateDeploymentId &&
      failedStatuses.has(initial.latest.status)
    ) {
      return await rollbackFailedCandidate(initial);
    }
    if (
      checkpoint?.rollbackDeploymentId &&
      initial.latest?.id === checkpoint.rollbackDeploymentId &&
      failedStatuses.has(initial.latest.status)
    )
      throw new Error("Rollback failed; drain retained");
    let state = await runnerState();
    templateSha256 = state.templateSha256;
    const sameOperation = state.operation?.operationId === operationId;
    if (
      checkpoint &&
      (["rollback-requested", "rollback-deployed"].includes(checkpoint.stage) ||
        (checkpoint.stage === "resume-requested" &&
          checkpoint.rollbackDeploymentId))
    ) {
      owned(state);
      actual(initial, baseline, checkpoint.rollbackDeploymentId ?? undefined);
      requireThat(
        initial.active.id !== checkpoint.baselineDeploymentId &&
          initial.active.id !== checkpoint.candidateDeploymentId,
        "New rollback deployment required",
      );
      await saveCheckpoint("rollback-deployed", {
        rollbackDeploymentId: initial.active.id,
      });
      if (state.operation.status === "resumed")
        await finish(baseline, "rolled-back", initial.active.id);
      else await resume(baseline, initial.active.id, "rolled-back");
      throw new Error("Runner rolled back; use a fresh dispatch");
    }
    if (
      sameOperation &&
      checkpoint &&
      [
        "candidate-requested",
        "candidate-deployed",
        "rollback-requested",
      ].includes(checkpoint.stage) &&
      failedStatuses.has(initial.latest?.status)
    ) {
      owned(state);
      requireThat(
        clean(state) &&
          equal(state.runtimeIdentity, baseline.runtimeIdentity) &&
          initial.active?.id === checkpoint.baselineDeploymentId &&
          initial.active.image === baseline.image &&
          initial.latest.id !== checkpoint.baselineDeploymentId &&
          initial.latest.image === candidate.image,
        "Lost deployment response recovery proof incomplete",
      );
      if (checkpoint.candidateDeploymentId)
        requireThat(
          checkpoint.candidateDeploymentId === initial.latest.id,
          "Failed deployment identity mismatch",
        );
      await saveCheckpoint("candidate-deployed", {
        candidateDeploymentId: initial.latest.id,
      });
      return await rollbackFailedCandidate(initial);
    }
    if (sameOperation) {
      owned(state);
      if (state.operation.status === "resumed") {
        requireThat(
          baseline.image !== candidate.image,
          "Same-image completed operation requires a fresh dispatch",
        );
        if (equal(state.runtimeIdentity, candidate.runtimeIdentity)) {
          actual(
            initial,
            candidate,
            checkpoint?.candidateDeploymentId ?? undefined,
          );
          return await finish(
            candidate,
            "deployed",
            checkpoint?.candidateDeploymentId ?? undefined,
          );
        }
        requireThat(
          equal(state.runtimeIdentity, baseline.runtimeIdentity),
          "Unexpected completed runtime",
        );
        actual(initial, baseline);
        await finish(baseline, "rolled-back");
        throw new Error("Runner rolled back; use a fresh dispatch");
      }
      if (
        (baseline.image !== candidate.image ||
          (checkpoint?.candidateDeploymentId &&
            initial.active?.id === checkpoint.candidateDeploymentId)) &&
        equal(state.runtimeIdentity, candidate.runtimeIdentity)
      ) {
        actual(
          initial,
          candidate,
          checkpoint?.candidateDeploymentId ?? undefined,
        );
        if (checkpoint && !checkpoint.candidateDeploymentId)
          await saveCheckpoint("candidate-deployed", {
            candidateDeploymentId: initial.active.id,
          });
        return await resume(candidate, initial.active.id, "deployed");
      }
      requireThat(
        equal(state.runtimeIdentity, baseline.runtimeIdentity),
        "Unexpected runtime identity",
      );
      actual(
        initial,
        baseline,
        checkpoint?.baselineDeploymentId ?? undefined,
        true,
      );
    } else {
      requireThat(
        state.phase === "running" &&
          (!state.operation || state.operation.status === "resumed"),
        "Another operation owns the drain",
      );
      requireThat(
        equal(state.runtimeIdentity, baseline.runtimeIdentity),
        "Baseline runtime identity mismatch",
      );
      actual(initial, baseline);
      await runner.drain({
        operationId,
        targetIdentity: candidate.runtimeIdentity,
      });
    }
    await waitDrain(baseline);
    const before = await inspect();
    actual(
      before,
      baseline,
      checkpoint?.baselineDeploymentId ?? undefined,
      sameOperation,
    );
    checkpoint = {
      version: 1,
      operationId,
      runId: provenance.run.id,
      controlRevision: provenance.run.sha,
      workflowSha256: provenance.run.workflowSha256,
      releaseSha256: provenance.releaseSha256,
      stage: "candidate-requested",
      baselineDeploymentId: before.active.id,
      candidateDeploymentId: null,
      rollbackDeploymentId: null,
      templateSha256,
      volumeId: before.volumeId,
      volumeInstanceId: before.volumeInstanceId,
      mountPath: before.mountPath,
    };
    await saveCheckpoint("candidate-requested");
    const candidateDeployment = await deploy(candidate, before.active.id);
    if (!candidateDeployment.failed)
      return await resume(candidate, candidateDeployment.id, "deployed");
    // Saved clean-drain proof permits a definite failed startup to roll back without candidate HTTP.
    return await rollbackFailedCandidate(await inspect(true));
  } catch (error) {
    if (!result.finalState.verified) await receipt(result);
    throw error;
  }
}
