import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { durableJson } from "../journal.mjs";

/** Sort object keys without changing arrays or scalar values. */
function canonical(item) {
  if (Array.isArray(item)) return item.map(canonical);
  if (item && typeof item === "object")
    return Object.fromEntries(
      Object.keys(item)
        .sort()
        .map((key) => [key, canonical(item[key])]),
    );
  return item;
}
/** Hash canonical JSON without exposing retained secrets. */
export function templateDigest(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
/** Read optional metadata; corruption is never treated as absence. */
export async function optionalMetadata(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
/** Validate the image's nonsecret identity, independently of its provider digest. */
export function validateIdentity(identity) {
  assert.ok(
    identity && typeof identity === "object",
    "Runtime identity required",
  );
  assert.deepEqual(
    Object.keys(identity).sort(),
    [
      "protocolVersion",
      "sourceRevision",
      "sourceManifestSha256",
      "compatibilitySha256",
      "policySha256",
    ].sort(),
  );
  assert.equal(identity.protocolVersion, 1);
  assert.match(identity.sourceRevision, /^[a-f0-9]{40}$/);
  for (const key of [
    "sourceManifestSha256",
    "compatibilitySha256",
    "policySha256",
  ])
    assert.match(identity[key], /^[a-f0-9]{64}$/);
}
/** Refuse protocol or cleanup-contract changes in an ordinary test rollout. */
export function compatibleIdentity(baseline, target) {
  validateIdentity(baseline);
  validateIdentity(target);
  for (const key of ["protocolVersion", "compatibilitySha256", "policySha256"])
    assert.equal(target[key], baseline[key], "Runtime compatibility mismatch");
}
/** Compare complete build identities without depending on JSON field ordering. */
export function sameIdentity(a, b) {
  return templateDigest(a) === templateDigest(b);
}
/** Bind deployments to immutable watch ownership, not mutable observations. */
export function retainedWatchBinding(state) {
  const auth = state.authorization ?? state;
  return templateDigest({
    operationId: auth.operationId,
    lifecycleRunId: auth.lifecycleRunId,
    runnerRunId: auth.runnerRunId,
    oldJournalSha256: state.oldJournalSha256,
    authorizationSha256: state.authorization
      ? templateDigest(state.authorization)
      : state.authorizationSha256,
    originalReceiptSha256: state.originalReceiptSha256,
    originalWatchSnapshotSha256: state.originalWatch
      ? templateDigest(state.originalWatch)
      : state.originalWatchSnapshotSha256,
  });
}
/** Historical authorization continues to validate against its original private template. */
export async function recoveryTemplate(root, config) {
  return (
    (await optionalMetadata(join(root, "private/recovery-template.json"))) ??
    config
  );
}
/** Established watches survive a separately owned deployment; prepared recovery does not. */
export function validateWatchingDeployment(
  state,
  operation,
  runtimeIdentity,
  config,
) {
  assert.equal(state.status, "watching", "Established recovery watch required");
  assert.equal(operation?.version, 1);
  assert.match(operation.operationId, /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/);
  assert.equal(
    operation.recoveryBindingSha256,
    retainedWatchBinding(state),
    "Retained watch binding changed",
  );
  assert.equal(operation.templateSha256, templateDigest(config));
  assert.ok(["draining", "drained", "resumed"].includes(operation.status));
  validateIdentity(operation.baselineIdentity);
  validateIdentity(operation.targetIdentity);
  if (operation.kind === "retained-watch-upgrade") {
    assert.equal(operation.removalProof?.method, "deploymentRemove");
    assert.equal(operation.removalProof.status, "REMOVED");
    for (const [key, value] of Object.entries(config.permanentRunner))
      assert.equal(operation.removalProof[key], value);
    assert.equal(operation.removalProof.mountPath, "/data");
    assert.match(operation.baselineTemplateSha256, /^[a-f0-9]{64}$/);
  } else {
    assert.equal(operation.kind, undefined);
    compatibleIdentity(operation.baselineIdentity, operation.targetIdentity);
  }
  assert.ok(
    sameIdentity(runtimeIdentity, operation.baselineIdentity) ||
      sameIdentity(runtimeIdentity, operation.targetIdentity),
    "Unexpected watched deployment runtime",
  );
}
/** A coordinated image upgrade may change only the private inspection image. */
async function inspectorOnly(previous, next) {
  const expected = structuredClone(previous);
  const oldWorkers =
    expected.services?.filter((s) => s.roles.includes("inspection-worker")) ??
    [];
  const newWorkers =
    next.services?.filter((s) => s.roles.includes("inspection-worker")) ?? [];
  assert.equal(oldWorkers.length, 1, "Exactly one retained inspector required");
  assert.equal(newWorkers.length, 1);
  assert.match(
    newWorkers[0].image,
    /^ghcr\.io\/copilotkit\/rich-thread-inspector@sha256:[a-f0-9]{64}$/,
  );
  const { policy } = await import("../contract.mts");
  assert.ok(
    policy.approvedImages.includes(newWorkers[0].image),
    "Inspector requires independent registry approval",
  );
  oldWorkers[0].image = newWorkers[0].image;
  assert.equal(
    templateDigest(expected),
    templateDigest(next),
    "Upgrade may change only the inspector image",
  );
}
async function prepareWatchingUpgrade({
  root,
  template,
  retained,
  metadata,
  operation,
  recovery,
  runtimeIdentity,
  authorization,
  recoveryAuthorization,
}) {
  assert.equal(recovery.status, "watching", "Prepared recovery cannot upgrade");
  assert.match(authorization.operationId, /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/);
  validateIdentity(authorization.baselineIdentity);
  assert.ok(
    sameIdentity(authorization.targetIdentity, runtimeIdentity),
    "Upgrade target mismatch",
  );
  assert.ok(
    sameIdentity(metadata.runtimeIdentity, authorization.baselineIdentity) ||
      sameIdentity(metadata.runtimeIdentity, runtimeIdentity),
    "Upgrade baseline mismatch",
  );
  assert.ok(
    [
      authorization.baselineTemplateSha256,
      authorization.targetTemplateSha256,
    ].includes(metadata.templateSha256),
  );
  assert.ok(
    [
      authorization.baselineTemplateSha256,
      authorization.targetTemplateSha256,
    ].includes(templateDigest(retained)),
  );
  assert.equal(authorization.targetTemplateSha256, templateDigest(template));
  assert.equal(
    authorization.recoveryBindingSha256,
    retainedWatchBinding(recovery),
    "Upgrade watch binding changed",
  );
  const historical = await recoveryTemplate(root, retained);
  await inspectorOnly(historical, template);
  const proof = authorization.removalProof;
  assert.equal(proof.version, 1);
  assert.equal(proof.method, "deploymentRemove");
  assert.equal(proof.status, "REMOVED", "Verified removal required");
  for (const [key, value] of Object.entries(template.permanentRunner))
    assert.equal(proof[key], value, "Upgrade removal scope mismatch");
  assert.equal(proof.mountPath, "/data");
  assert.ok(
    typeof proof.deploymentId === "string" && proof.deploymentId.length > 0,
  );
  assert.match(
    proof.image,
    /^ghcr\.io\/copilotkit\/rich-thread-runner@sha256:[a-f0-9]{64}$/,
  );
  assert.ok(
    typeof proof.volumeInstanceId === "string" &&
      proof.volumeInstanceId.length > 0,
  );
  if (recovery.authorization.providerHandoff?.volumeInstanceId)
    assert.equal(
      proof.volumeInstanceId,
      recovery.authorization.providerHandoff.volumeInstanceId,
    );
  assert.ok(Number.isFinite(Date.parse(proof.observedAt)));
  const next = {
    version: 1,
    kind: "retained-watch-upgrade",
    operationId: authorization.operationId,
    baselineIdentity: authorization.baselineIdentity,
    targetIdentity: runtimeIdentity,
    baselineTemplateSha256: authorization.baselineTemplateSha256,
    templateSha256: authorization.targetTemplateSha256,
    recoveryBindingSha256: authorization.recoveryBindingSha256,
    removalProof: proof,
    status: "draining",
    ...(authorization.volumeRecovery
      ? { volumeRecovery: authorization.volumeRecovery }
      : {}),
  };
  const { prepareRetainedRecovery, assertOwnersStopped } =
    await import("../recovery.mjs");
  if (operation?.operationId === next.operationId) {
    assert.equal(
      templateDigest({ ...operation, status: "draining" }),
      templateDigest(next),
      "Upgrade checkpoint changed",
    );
    await prepareRetainedRecovery({
      root,
      config: template,
      runtimeIdentity,
      metadata,
      operation,
      authorization: recoveryAuthorization,
    });
  } else {
    assert.equal(
      operation?.status,
      "resumed",
      "Previous deployment must be resumed",
    );
    assert.ok(
      sameIdentity(metadata.runtimeIdentity, authorization.baselineIdentity),
    );
    assert.equal(metadata.templateSha256, authorization.baselineTemplateSha256);
    assert.equal(
      templateDigest(retained),
      authorization.baselineTemplateSha256,
    );
    // Validate the prior deployed authority and dead owners before retaining any new state.
    await prepareRetainedRecovery({
      root,
      config: retained,
      runtimeIdentity: metadata.runtimeIdentity,
      metadata,
      operation,
      authorization: recoveryAuthorization,
    });
    const { ownerAlive } = await import("../process-owner.mjs");
    await assertOwnersStopped(
      root,
      historical,
      recovery.originalJournal,
      ownerAlive,
    );
    if (!(await optionalMetadata(join(root, "private/recovery-template.json"))))
      await durableJson(
        join(root, "private/recovery-template.json"),
        historical,
      );
    await durableJson(join(root, "deployment.json"), next);
  }
  await durableJson(join(root, "private/template.json"), template);
}
/** Freeze every shipped input except explicit test orchestration/assertion surfaces. */
export function compatibilityFiles(files) {
  const prefix = "tools/intelligence-smoke/rich-threads/";
  return files.filter(
    ({ path }) =>
      ![`${prefix}scenarios/row1.mjs`, `${prefix}rows/row1.mjs`].includes(
        path,
      ) &&
      !path.endsWith(".test.mjs") &&
      !path.endsWith(".test.ts") &&
      !path.endsWith(".md"),
  );
}
/** Validate retained state before bootstrap or configuration can write anything. */
export async function checkStartup({
  root,
  template,
  runtimeIdentity,
  recoveryAuthorization,
  upgradeAuthorization,
}) {
  validateIdentity(runtimeIdentity);
  const templateSha256 = templateDigest(template);
  const [metadata, operation, retained, initialized] = await Promise.all([
    optionalMetadata(join(root, "runtime.json")),
    optionalMetadata(join(root, "deployment.json")),
    optionalMetadata(join(root, "private/template.json")),
    optionalMetadata(join(root, "initialized.json")),
  ]);
  if (initialized) assert.ok(retained, "Retained configuration missing");
  const recovery =
    (await optionalMetadata(join(root, "recovery-v2.json"))) ??
    (await optionalMetadata(join(root, "recovery.json")));
  if (recovery && initialized) {
    assert.equal(initialized.serviceId, template.permanentRunner.serviceId);
    assert.equal(initialized.volumeId, template.permanentRunner.volumeId);
  }
  const drainedWatchTransition =
    operation?.recoveryBindingSha256 &&
    operation.kind !== "retained-watch-upgrade" &&
    operation.status === "drained" &&
    operation.templateSha256 === templateSha256 &&
    (sameIdentity(runtimeIdentity, operation.baselineIdentity) ||
      sameIdentity(runtimeIdentity, operation.targetIdentity));
  if (
    upgradeAuthorization &&
    recovery &&
    !drainedWatchTransition &&
    !(
      sameIdentity(metadata?.runtimeIdentity, runtimeIdentity) &&
      metadata.templateSha256 === templateSha256 &&
      templateDigest(retained) === templateSha256
    )
  ) {
    assert.ok(
      metadata && retained && initialized,
      "Upgrade requires retained authority",
    );
    await prepareWatchingUpgrade({
      root,
      template,
      retained,
      metadata,
      operation,
      recovery,
      runtimeIdentity,
      authorization: upgradeAuthorization,
      recoveryAuthorization,
    });
    return { runtimeIdentity, templateSha256 };
  }
  if (retained)
    assert.equal(
      templateDigest(retained),
      templateSha256,
      "Retained configuration mismatch",
    );
  if (recoveryAuthorization || recovery) {
    assert.ok(
      metadata && retained && initialized,
      "Recovery requires initialized retained authority",
    );
    assert.equal(metadata.templateSha256, templateSha256);
    assert.equal(initialized.serviceId, template.permanentRunner.serviceId);
    assert.equal(initialized.volumeId, template.permanentRunner.volumeId);
    if (
      operation?.recoveryBindingSha256 &&
      !sameIdentity(metadata.runtimeIdentity, runtimeIdentity)
    ) {
      assert.ok(
        sameIdentity(metadata.runtimeIdentity, operation.baselineIdentity) ||
          sameIdentity(metadata.runtimeIdentity, operation.targetIdentity),
      );
      if (operation.kind !== "retained-watch-upgrade")
        assert.equal(
          operation.status,
          "drained",
          "Clean deployment drain required for changed runtime",
        );
    }
    const { prepareRetainedRecovery } = await import("../recovery.mjs");
    await prepareRetainedRecovery({
      root,
      config: template,
      runtimeIdentity,
      metadata,
      operation,
      authorization: recoveryAuthorization,
    });
    return { runtimeIdentity, templateSha256 };
  }
  if (!metadata) {
    assert.equal(
      operation,
      null,
      "Deployment metadata absent with retained operation",
    );
    return { runtimeIdentity, templateSha256 };
  }
  assert.ok(retained, "Retained configuration missing");
  compatibleIdentity(metadata.runtimeIdentity, runtimeIdentity);
  assert.equal(
    metadata.templateSha256,
    templateSha256,
    "Retained configuration mismatch",
  );
  if (operation) {
    assert.equal(operation.version, 1);
    assert.ok(["draining", "drained", "resumed"].includes(operation.status));
    compatibleIdentity(operation.baselineIdentity, operation.targetIdentity);
    assert.equal(
      operation.templateSha256,
      templateSha256,
      "Deployment configuration mismatch",
    );
  }
  if (!sameIdentity(metadata.runtimeIdentity, runtimeIdentity)) {
    assert.ok(
      operation?.status === "drained",
      "Clean deployment drain required for changed runtime",
    );
    assert.ok(
      sameIdentity(runtimeIdentity, operation.targetIdentity) ||
        sameIdentity(runtimeIdentity, operation.baselineIdentity),
      "Unexpected deployment runtime identity",
    );
  }
  return { runtimeIdentity, templateSha256 };
}
