import assert from "node:assert/strict";
import { STAGING, equal, sha256 } from "./contract.mjs";
import { verifyRemovedHandoff } from "./removal-handoff.mjs";

const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
export const binding = (r) =>
  sha256(
    JSON.stringify(
      canonical(
        Object.fromEntries(
          [
            "operationId",
            "lifecycleRunId",
            "runnerRunId",
            "oldJournalSha256",
            "authorizationSha256",
            "originalReceiptSha256",
            "originalWatchSnapshotSha256",
          ].map((k) => [k, r[k]]),
        ),
      ),
    ),
  );
const watches = (r) =>
  r.watches.map((w) =>
    Object.fromEntries(
      [
        "operationId",
        "lifecycleRunId",
        "runnerRunId",
        "oldJournalSha256",
        "originalStatus",
        "deadlineExceeded",
      ].map((k) => [k, w[k]]),
    ),
  );
export function verifyWatches(live, intent) {
  assert.equal(live.recovery?.status, "watching");
  assert.equal(binding(live.recovery), intent.recoveryBindingSha256);
  assert.deepEqual(watches(live.recovery), intent.watches);
  assert.ok(
    live.recovery.watches.every((w) => w.providerFinality === "unknown"),
  );
  for (const [key, value] of Object.entries(intent.volumeWatch))
    assert.deepEqual(live.volumeCreateRecovery?.[key], value);
}
async function verifyInventory(railway, expected, removedBaseline) {
  const rows = await railway.handoffInventory();
  assert.equal(
    new Set(rows.map((row) => row.id)).size,
    rows.length,
    "Duplicate deployment inventory",
  );
  const current = rows.filter((row) => row.id === expected.id);
  assert.equal(
    current.length,
    1,
    "Expected deployment missing from complete inventory",
  );
  for (const key of ["id", "image", "status"])
    assert.equal(current[0][key], expected[key]);
  assert.notEqual(current[0].deploymentStopped, true);
  assert.ok(
    rows.every((row) => row.id === expected.id || row.status === "REMOVED"),
    "Competing deployment in inventory",
  );
  if (removedBaseline) {
    const baseline = rows.filter(
      (row) => row.id === removedBaseline.deploymentId,
    );
    assert.equal(baseline.length, 1);
    assert.equal(baseline[0].status, "REMOVED");
    assert.equal(baseline[0].image, removedBaseline.image);
  }
}
/** Whether the runner has no active work or admission block. */
const idle = (live) =>
  !live.busy && live.active === null && live.blocked === false;

/** One reviewed compatibility transition. No retry, rollback, or admission override. */
export async function upgradeBrowser({
  intent,
  operationId,
  railway,
  runner,
  setUpgrade,
  verifyProvenance,
  verifyReceipts,
  save,
  sleep,
  clock = Date.now,
  deadline,
}) {
  const receipt = {
    operationId,
    outcome: "unknown",
    providerWorkStarted: false,
    finalState: { verified: false },
  };
  const record = async (stage) => {
    receipt.stage = stage;
    await save(structuredClone(receipt));
  };
  const check = (live, identity) => {
    assert.deepEqual(live.runtimeIdentity, identity);
    assert.equal(live.templateSha256, intent.targetTemplateSha256);
    verifyWatches(live, intent);
  };
  const poll = async (read, accept) => {
    while (clock() < deadline) {
      const v = await read();
      if (accept(v)) return v;
      await sleep(1000);
    }
    throw Error("Reviewed upgrade deadline exceeded");
  };
  const removal = () =>
    verifyRemovedHandoff({
      railway,
      scope: STAGING,
      baseline: intent.removalBaseline,
      configuredImages: [intent.baseline.image, intent.candidate.image],
      clock,
    });
  try {
    await record("verify-provenance");
    await verifyProvenance();
    assert.equal(intent.baselineTemplateSha256, intent.targetTemplateSha256);
    assert.equal(
      intent.baseline.runtimeIdentity.policySha256,
      intent.candidate.runtimeIdentity.policySha256,
    );
    let live = await runner.get();
    check(live, intent.baseline.runtimeIdentity);
    assert.ok(idle(live));
    assert.equal(live.phase, "running");
    assert.equal(live.operation.operationId, intent.baselineOperationId);
    assert.equal(live.operation.status, "resumed");
    await verifyReceipts();
    const provider = await railway.inspect();
    assert.deepEqual(provider.active, {
      id: intent.removalBaseline.deploymentId,
      image: intent.baseline.image,
      status: "SUCCESS",
    });
    assert.deepEqual(provider.latest, provider.active);
    assert.equal(provider.configuredImage, intent.baseline.image);
    for (const key of ["volumeId", "volumeInstanceId", "mountPath"])
      assert.equal(provider[key], STAGING[key]);
    assert.notEqual(provider.isPendingDeletion, true);
    // A same-image drain closes admissions before the incompatible runtime is removed.
    receipt.providerWorkStarted = true;
    await record("drain-requested");
    await runner.drain({
      operationId,
      targetIdentity: intent.baseline.runtimeIdentity,
    });
    live = await poll(
      () => runner.get(),
      (v) => v.phase === "drained" && idle(v),
    );
    check(live, intent.baseline.runtimeIdentity);
    assert.equal(live.operation.operationId, operationId);
    assert.equal(live.operation.status, "drained");
    await verifyInventory(railway, provider.active);
    const refreshed = await railway.inspect();
    assert.deepEqual(refreshed.active, provider.active);
    assert.deepEqual(refreshed.latest, refreshed.active);
    assert.equal(refreshed.configuredImage, intent.baseline.image);
    for (const key of ["volumeId", "volumeInstanceId", "mountPath"])
      assert.equal(refreshed[key], STAGING[key]);
    assert.notEqual(refreshed.isPendingDeletion, true);
    await verifyReceipts();
    // Persist the intent before the request; neither a rerun nor this call resends it.
    receipt.removalOutcome = "unknown";
    await record("removal-requested");
    try {
      await railway.removeDeployment(intent.removalBaseline.deploymentId);
      receipt.removalOutcome = "acknowledged";
    } catch (error) {
      receipt.removalOutcome =
        error.removalOutcome === "refused" ? "refused" : "unknown";
    }
    await record("removal-response-recorded");
    const handoff = await poll(async () => {
      try {
        return await removal();
      } catch {
        return null;
      }
    }, Boolean);
    receipt.removalProof = handoff.removalProof;
    await record("removed-handoff-verified");
    await setUpgrade({
      operationId,
      baselineIdentity: intent.baseline.runtimeIdentity,
      targetIdentity: intent.candidate.runtimeIdentity,
      baselineTemplateSha256: intent.baselineTemplateSha256,
      targetTemplateSha256: intent.targetTemplateSha256,
      recoveryBindingSha256: intent.recoveryBindingSha256,
      removalProof: handoff.removalProof,
      volumeRecovery: intent.volumeRecovery,
    });
    await removal();
    await railway.setImage(intent.candidate.image);
    await removal();
    await record("candidate-requested");
    receipt.candidateDeploymentId = await railway.deploy();
    await record("candidate-acknowledged");
    await poll(
      () => railway.deployment(receipt.candidateDeploymentId),
      (v) => {
        assert.ok(
          !["FAILED", "CRASHED", "REMOVED", "SKIPPED"].includes(v.status),
        );
        return v.status === "SUCCESS";
      },
    );
    live = await poll(
      () => runner.probe(),
      (v) =>
        v &&
        equal(v.runtimeIdentity, intent.candidate.runtimeIdentity) &&
        v.phase === "drained" &&
        idle(v),
    );
    check(live, intent.candidate.runtimeIdentity);
    assert.equal(live.operation.operationId, operationId);
    assert.equal(live.operation.status, "drained");
    await verifyReceipts();
    const candidateProvider = await railway.inspect();
    assert.deepEqual(candidateProvider.active, {
      id: receipt.candidateDeploymentId,
      image: intent.candidate.image,
      status: "SUCCESS",
    });
    assert.deepEqual(candidateProvider.latest, candidateProvider.active);
    assert.equal(candidateProvider.configuredImage, intent.candidate.image);
    for (const key of ["volumeId", "volumeInstanceId", "mountPath"])
      assert.equal(candidateProvider[key], STAGING[key]);
    assert.notEqual(candidateProvider.isPendingDeletion, true);
    await verifyInventory(
      railway,
      candidateProvider.active,
      intent.removalBaseline,
    );
    await record("verified-drained");
    await runner.resume({
      operationId,
      expectedRuntimeIdentity: intent.candidate.runtimeIdentity,
    });
    live = await poll(() => runner.get(), idle);
    check(live, intent.candidate.runtimeIdentity);
    assert.equal(live.phase, "running");
    assert.equal(live.operation.operationId, operationId);
    assert.equal(live.operation.status, "resumed");
    const final = await railway.inspect();
    assert.deepEqual(final.active, {
      id: receipt.candidateDeploymentId,
      image: intent.candidate.image,
      status: "SUCCESS",
    });
    assert.deepEqual(final.latest, final.active);
    assert.equal(final.configuredImage, intent.candidate.image);
    for (const key of ["volumeId", "volumeInstanceId", "mountPath"])
      assert.equal(final[key], STAGING[key]);
    assert.notEqual(final.isPendingDeletion, true);
    await verifyInventory(railway, final.active, intent.removalBaseline);
    await verifyReceipts();
    receipt.finalState = {
      verified: true,
      phase: live.phase,
      deploymentId: final.active.id,
      image: final.active.image,
      runtimeIdentity: live.runtimeIdentity,
      templateSha256: live.templateSha256,
      volumeId: final.volumeId,
      volumeInstanceId: final.volumeInstanceId,
      mountPath: final.mountPath,
    };
    receipt.outcome = "deployed";
    await record("verified-running");
    return receipt;
  } catch (error) {
    receipt.outcome = "failed";
    await record(`failed-at-${receipt.stage}`);
    throw error;
  }
}
