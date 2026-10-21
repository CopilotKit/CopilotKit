import { verifyRemovedHandoff } from "./removal-handoff.mjs";
import {
  equal,
  requireThat,
  validateVolume,
  SHA256,
  STAGING,
} from "./contract.mjs";
import { validateCheckpoint } from "./checkpoint.mjs";
import {
  SECOND_RECOVERY,
  SECOND_TEMPLATE,
  ORIGINAL_WATCH,
  validateSecondRecovery,
  secondRecoveryAuthorization,
  bindingDigest,
  operationBinding,
  originalWatchBinding,
  validateRemovalProof,
} from "./second-recovery-contract.mjs";

const pending = new Set([
  "INITIALIZING",
  "QUEUED",
  "BUILDING",
  "DEPLOYING",
  "WAITING",
]);
/** Replace only the reviewed removed deployment; never infer cancellation or repeat an unknown deploy. */
export async function deploySecondRecoveryRunner({
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
  validateSecondRecovery(release.recovery, release.baseline, release.candidate);
  const authorization = secondRecoveryAuthorization(release, operationId);
  const { baseline, candidate } = release;
  const baselineId = SECOND_RECOVERY.providerHandoff.deploymentId;
  const context = { ...provenance, operationId };
  let checkpoint = previousCheckpoint;
  if (checkpoint) {
    validateCheckpoint(checkpoint, context);
    requireThat(
      checkpoint.version === 3 &&
        checkpoint.baselineDeploymentId === baselineId &&
        checkpoint.templateSha256 === SECOND_TEMPLATE,
      "Second recovery checkpoint mismatch",
    );
  }
  let result = {
    schemaVersion: 1,
    ...provenance,
    operationId,
    outcome: "unknown",
    providerWorkStarted: Boolean(checkpoint),
    finalState: { verified: false },
    ...(checkpoint ? { checkpoint } : {}),
  };
  await receipt(result);
  const checkTime = () =>
    requireThat(
      clock() < deadline,
      "Second recovery deadline exceeded; admission stays closed",
    );
  const inspect = async () => {
    checkTime();
    const value = await railway.inspect({ allowNoActive: true });
    validateVolume(value);
    return value;
  };
  const removedHandoff = async (configuredImages, message) => {
    checkTime();
    try {
      return await verifyRemovedHandoff({
        railway,
        scope: STAGING,
        baseline: { deploymentId: baselineId, image: baseline.image },
        configuredImages,
        clock,
      });
    } catch (error) {
      if (message && error.message === "Removed baseline configuration changed")
        throw new Error(message, { cause: error });
      throw error;
    }
  };
  const get = async () => {
    checkTime();
    const value = await runner.get();
    requireThat(
      value.protocolVersion === 1 && value.templateSha256 === SECOND_TEMPLATE,
      "Second recovery template mismatch",
    );
    return value;
  };
  const actual = (provider, target, id) =>
    requireThat(
      provider.configuredImage === target.image &&
        provider.active?.id === id &&
        provider.active.image === target.image &&
        provider.active.status === "SUCCESS" &&
        provider.latest?.id === id &&
        provider.latest.status === "SUCCESS",
      "Second recovery deployment identity mismatch",
    );
  const inventory = async (allowedId, removed) => {
    checkTime();
    const rows = await railway.handoffInventory();
    if (allowedId) {
      const allowed = rows.filter((row) => row.id === allowedId);
      requireThat(
        allowed.length === 1 &&
          allowed[0].status === "SUCCESS" &&
          allowed[0].image ===
            (allowedId === baselineId ? baseline.image : candidate.image),
        "Active deployment inventory proof incomplete",
      );
    }
    requireThat(
      rows.some((row) => row.id === baselineId && row.image === baseline.image),
      "Handoff baseline inventory missing",
    );
    for (const row of rows) {
      if (row.id === allowedId) continue;
      requireThat(
        row.status === "REMOVED",
        "Competing deployment prevents handoff",
      );
    }
    if (removed) {
      const old = await railway.readDeploymentStatus(baselineId);
      requireThat(
        old.id === baselineId &&
          old.image === baseline.image &&
          old.status === "REMOVED",
        "Original deployment has not been removed",
      );
    }
    return rows;
  };
  const originalWatch = (watch) =>
    requireThat(
      equal(originalWatchBinding(watch), ORIGINAL_WATCH) &&
        watch.status === "watching" &&
        watch.providerFinality === "unknown" &&
        watch.originalStatus === "failed" &&
        watch.deadlineExceeded === true,
      "Original recovery ownership changed",
    );
  const baselineState = (state) => {
    requireThat(
      equal(state.runtimeIdentity, baseline.runtimeIdentity) &&
        state.phase === "running" &&
        state.blocked === true &&
        state.active === SECOND_RECOVERY.runnerRunId,
      "Exact second failed run required",
    );
    requireThat(
      bindingDigest(operationBinding(state.operation)) ===
        SECOND_RECOVERY.deploymentOperationSha256,
      "Original deployment operation changed",
    );
    originalWatch(state.recovery);
  };
  const owned = (state) => {
    requireThat(
      equal(state.runtimeIdentity, candidate.runtimeIdentity),
      "Second recovery runtime changed",
    );
    const operation = state.operation;
    requireThat(
      operation?.version === 1 &&
        operation.kind === "bounded-environment-retry" &&
        operation.operationId === operationId &&
        operation.templateSha256 === SECOND_TEMPLATE &&
        equal(operation.baselineIdentity, baseline.runtimeIdentity) &&
        equal(operation.targetIdentity, candidate.runtimeIdentity),
      "Second recovery fence owner mismatch",
    );
  };
  const watches = (state) => {
    const value = state.recovery;
    requireThat(
      value?.status === "watching" &&
        value.authorizationSha256 === bindingDigest(authorization) &&
        value.journalBindingSha256 === SECOND_RECOVERY.journalSha256 &&
        value.operationId === operationId &&
        value.runnerRunId === SECOND_RECOVERY.runnerRunId &&
        value.lifecycleRunId === SECOND_RECOVERY.lifecycleRunId &&
        value.retainedSourceEnvironmentId ===
          SECOND_RECOVERY.sourceEnvironmentId &&
        Array.isArray(value.watches) &&
        value.watches.length === 2,
      "Both retained watch receipts required",
    );
    originalWatch(value.watches[0]);
    const second = value.watches[1];
    requireThat(
      second.operationId === operationId &&
        second.runnerRunId === SECOND_RECOVERY.runnerRunId &&
        second.lifecycleRunId === SECOND_RECOVERY.lifecycleRunId &&
        second.originalStatus === "failed" &&
        typeof second.deadlineExceeded === "boolean" &&
        (clock() < Date.parse("2026-10-19T11:39:45.428Z") ||
          second.deadlineExceeded === true) &&
        second.oldJournalSha256 === value.oldJournalSha256 &&
        second.providerFinality === "unknown",
      "Second failed outcome not preserved",
    );
    for (const watch of value.watches)
      requireThat(
        watch.status === "watching" &&
          SHA256.test(watch.oldJournalSha256) &&
          SHA256.test(watch.watchSha256) &&
          Number.isInteger(watch.observationCount) &&
          watch.observationCount > 0 &&
          Number.isFinite(Date.parse(watch.lastVerifiedAt)),
        "Retained watch evidence incomplete",
      );
    requireThat(
      state.busy === false && state.active === null && state.blocked === false,
      "Second recovery admission not ready",
    );
    return value;
  };
  const save = async (stage, fields = {}) => {
    checkpoint = { ...checkpoint, ...fields, stage };
    validateCheckpoint(checkpoint, context);
    result = { ...result, providerWorkStarted: true, checkpoint };
    await receipt(result);
  };
  try {
    if (!checkpoint) {
      let provider = await inspect();
      actual(provider, baseline, baselineId);
      let state = await get();
      baselineState(state);
      // Legacy cleanup can briefly own the runner. Wait for idle without changing its fence.
      while (state.busy) {
        checkTime();
        await sleep(Math.min(1000, deadline - clock()));
        state = await get();
        baselineState(state);
      }
      await inventory(baselineId, false);
      provider = await inspect();
      actual(provider, baseline, baselineId);
      checkpoint = {
        version: 3,
        operationId,
        runId: provenance.run.id,
        controlRevision: provenance.run.sha,
        workflowSha256: provenance.run.workflowSha256,
        releaseSha256: provenance.releaseSha256,
        stage: "remove-requested",
        removalProof: null,
        removalRequest: { outcome: "pending", response: null },
        baselineDeploymentId: baselineId,
        candidateDeploymentId: null,
        rollbackDeploymentId: null,
        templateSha256: SECOND_TEMPLATE,
        volumeId: provider.volumeId,
        volumeInstanceId: provider.volumeInstanceId,
        mountPath: provider.mountPath,
      };
      await save("remove-requested");
      let removalRequest;
      try {
        await railway.removeDeployment(baselineId);
        removalRequest = { outcome: "acknowledged", response: true };
      } catch (error) {
        // Keep the actual response outcome even if independent REMOVED proof later succeeds.
        removalRequest =
          error.removalOutcome === "refused"
            ? { outcome: "refused", response: false }
            : { outcome: "unknown", response: null };
      }
      await save("remove-requested", { removalRequest });
    }
    if (checkpoint.stage === "remove-requested") {
      for (;;) {
        checkTime();
        const old = await railway.readDeploymentStatus(baselineId);
        requireThat(
          old.id === baselineId && old.image === baseline.image,
          "Removal deployment identity changed",
        );
        if (old.status === "REMOVED") break;
        requireThat(
          ["SUCCESS", "REMOVING"].includes(old.status),
          "Unexpected removal status",
        );
        await sleep(Math.min(1000, deadline - clock()));
      }
      const { removalProof } = await removedHandoff([baseline.image]);
      validateRemovalProof(removalProof);
      await save("removed", { removalProof });
    }
    if (checkpoint.stage === "removed") {
      await removedHandoff([baseline.image, candidate.image]);
      await railway.setRecoveryAuthorization(authorization);
      await removedHandoff([baseline.image, candidate.image]);
      await railway.setImage(candidate.image);
      await removedHandoff(
        [candidate.image],
        "Candidate configuration unverified",
      );
      await save("candidate-requested");
      const id = await railway.deploy();
      requireThat(
        typeof id === "string" && id.length > 0 && id !== baselineId,
        "New recovery deployment required",
      );
      await save("candidate-deployed", { candidateDeploymentId: id });
    }
    if (checkpoint.candidateDeploymentId) {
      for (;;) {
        checkTime();
        const row = await railway.deployment(checkpoint.candidateDeploymentId);
        requireThat(
          row.id === checkpoint.candidateDeploymentId,
          "Candidate deployment changed",
        );
        if (row.status === "SUCCESS") break;
        requireThat(
          pending.has(row.status),
          "Second recovery candidate failed; admission stays closed",
        );
        await sleep(Math.min(5000, deadline - clock()));
      }
    }
    // A lost deployment response never grants authority to issue another deploy.
    let provider = await inspect();
    requireThat(
      provider.active?.id && provider.active.id !== baselineId,
      "Prior candidate request unresolved",
    );
    const candidateId = checkpoint.candidateDeploymentId ?? provider.active.id;
    actual(provider, candidate, candidateId);
    await inventory(candidateId, true);
    let state = await get();
    owned(state);
    if (!checkpoint.candidateDeploymentId)
      await save("candidate-deployed", { candidateDeploymentId: candidateId });
    if (state.operation.status !== "resumed") {
      requireThat(
        ["draining", "recovery-ready"].includes(state.phase) &&
          state.busy === false,
        "Second recovery fence not ready",
      );
      if (state.operation.status !== "recovery-ready") {
        originalWatch(state.recovery);
        await runner.recover({
          operationId,
          expectedRuntimeIdentity: candidate.runtimeIdentity,
        });
        state = await get();
        owned(state);
      }
      requireThat(
        state.phase === "recovery-ready" &&
          state.operation.status === "recovery-ready",
        "Explicit second recovery required",
      );
      watches(state);
      await inventory(candidateId, true);
      actual(await inspect(), candidate, candidateId);
      await save("resume-requested");
      await runner.resume({
        operationId,
        expectedRuntimeIdentity: candidate.runtimeIdentity,
      });
      state = await get();
    }
    owned(state);
    const retained = watches(state);
    requireThat(
      state.phase === "running" && state.operation.status === "resumed",
      "Second recovery resume unverified",
    );
    await inventory(candidateId, true);
    provider = await inspect();
    actual(provider, candidate, candidateId);
    result = {
      ...result,
      outcome: "deployed",
      recovery: retained,
      finalState: {
        verified: true,
        image: candidate.image,
        runtimeIdentity: candidate.runtimeIdentity,
        deploymentId: candidateId,
        templateSha256: SECOND_TEMPLATE,
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
