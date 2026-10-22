import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { durableJson, authority } from "./journal.mjs";
import { railwayApi } from "./api.mjs";
import { journalBinding } from "./recovery-v2.mjs";
import { assertOwnersStopped, finishTransfer } from "./recovery.mjs";
import { ownerAlive } from "./process-owner.mjs";
import { optionalMetadata, templateDigest } from "./runner/deployment.mjs";
import { publishSnapshot } from "./contract.mts";
import { distributeSnapshot } from "./distribution.mjs";
import { observeVolumeRetirement } from "./volume-retirement.mjs";

export const volumeCreateCase = Object.freeze({
  projectId: "6f8c6bff-a80d-4f8f-b78d-50b32bcf4479",
  lifecycleRunId: "rich-92c9b050-5fd0-4f13-b4e5-96df2c40a20c",
  runnerRunId: "run-60c27d73-0562-406d-b6b9-cb738b768eb5",
  sourceEnvironmentId: "4605dae6-9836-42d0-879a-4fdde1f9c0ac",
  environmentId: "75596542-6243-4a49-bd09-d85612827980",
  redisServiceId: "4be8758b-c6ea-493e-9537-e237e249a5c1",
  startedAt: "2026-10-22T20:51:05.451Z",
  mountPath: "/bitnami/redis",
  baselineRevision: "3265f81e51702394b2cc1a215d113889eb83e07c",
});
const c = volumeCreateCase;
const binding = (state) =>
  templateDigest({
    authorization: state.authorization,
    oldJournalSha256: state.oldJournalSha256,
    originalReceiptSha256: state.originalReceiptSha256,
  });

function validate(state, config, journal) {
  const auth = state.authorization;
  assert.equal(state.version, 1);
  assert.equal(auth.version, 1);
  assert.equal(auth.kind, "redis-volume-create-retained-watch");
  assert.equal(auth.decision, "operator-2026-10-22-one-time-recovery");
  assert.equal(config.projectId, c.projectId);
  assert.equal(journal.projectId, c.projectId);
  assert.equal(journal.runId, c.lifecycleRunId);
  assert.equal(journal.environmentId, c.environmentId);
  assert.equal(
    templateDigest(journalBinding(journal)),
    auth.journalBindingSha256,
  );
  assert.equal(templateDigest(journal), state.oldJournalSha256);
  assert.equal(templateDigest(state.originalJournal), state.oldJournalSha256);
  assert.equal(templateDigest(journal.lease), auth.leaseSha256);
  assert.equal(
    templateDigest(state.originalReceipt),
    auth.originalReceiptSha256,
  );
  assert.equal(state.originalReceiptSha256, auth.originalReceiptSha256);
  assert.equal(state.originalReceipt.id, c.runnerRunId);
  assert.equal(state.originalReceipt.status, "failed");
  assert.ok(
    Date.parse(journal.expiresAt) < Date.now(),
    "Original attempt must remain overdue",
  );
  const pending = journal.intents.filter(
    (i) => !["recorded", "absent"].includes(i.status),
  );
  assert.equal(pending.length, 1);
  const intent = pending[0];
  assert.equal(templateDigest(intent), auth.intentSha256);
  assert.equal(intent.kind, "createVolume");
  assert.equal(intent.status, "pending");
  assert.equal(intent.scope, c.redisServiceId);
  assert.equal(intent.startedAt, c.startedAt);
  assert.equal(intent.mountPath, c.mountPath);
  assert.equal(intent.resultId, undefined);
  assert.equal(intent.failure?.outcome, "unknown");
  assert.equal(journal.environments.length, 2);
  assert.deepEqual(
    journal.environments.map((e) => e.id).sort(),
    [c.sourceEnvironmentId, c.environmentId].sort(),
  );
  return intent;
}

/** One authorized incident only. Detect late storage and fail closed; never
 * retry creation/deletion or infer provider finality from an empty inventory.
 * Empty source/fork namespaces remain retained ownership, not cleaned resources.
 */
export async function reconcileVolumeCreateRecovery(
  { root, config, operation, expectedBinding },
  dependencies = {},
) {
  const path = join(root, "volume-create-recovery.json");
  let state = await optionalMetadata(path);
  if (!state && !operation?.volumeRecovery) {
    assert.equal(expectedBinding, undefined, "Retained volume watch missing");
    return null;
  }
  await authority(config.controlDirectory);
  const journal = await optionalMetadata(
    join(config.controlDirectory, c.lifecycleRunId, "journal.json"),
  );
  assert.ok(journal, "Original volume-create journal missing");
  if (!state) {
    assert.equal(operation.kind, "retained-watch-upgrade");
    assert.equal(operation.status, "draining");
    assert.equal(operation.templateSha256, templateDigest(config));
    assert.equal(operation.baselineIdentity.sourceRevision, c.baselineRevision);
    assert.equal(operation.removalProof?.method, "deploymentRemove");
    assert.equal(operation.removalProof.status, "REMOVED");
    for (const [key, value] of Object.entries(config.permanentRunner))
      assert.equal(operation.removalProof[key], value);
    const lease = await optionalMetadata(
      join(config.controlDirectory, "active-run/lease.json"),
    );
    assert.equal(templateDigest(lease), operation.volumeRecovery.leaseSha256);
    const originalReceipt = await optionalMetadata(
      join(root, "results", c.runnerRunId, "run.json"),
    );
    state = {
      version: 1,
      authorization: {
        ...operation.volumeRecovery,
        lifecycleRunId: c.lifecycleRunId,
        runnerRunId: c.runnerRunId,
      },
      status: "prepared",
      originalJournal: journal,
      oldJournalSha256: templateDigest(journal),
      originalReceipt,
      originalReceiptSha256: templateDigest(originalReceipt),
      providerFinality: "unknown",
      retainedEnvironmentIds: [c.sourceEnvironmentId, c.environmentId],
    };
    validate(state, config, journal);
    await assertOwnersStopped(
      root,
      config,
      journal,
      dependencies.ownerAlive ?? ownerAlive,
      true,
    );
    await durableJson(path, state);
  }
  const intent = validate(state, config, journal);
  const stableBinding = binding(state);
  if (expectedBinding !== undefined)
    assert.equal(
      expectedBinding,
      stableBinding,
      "Volume watch binding changed",
    );
  assert.ok(["prepared", "watching"].includes(state.status));
  await assertOwnersStopped(
    root,
    config,
    journal,
    dependencies.ownerAlive ?? ownerAlive,
    true,
  );
  const api = dependencies.api ?? railwayApi();
  const [volumes, services, environments] = await Promise.all([
    api.list("volumes", c.projectId),
    api.list("services", c.projectId),
    api.list("environments", c.projectId),
  ]);
  assert.ok(
    !services.some((s) => journal.services.some((old) => old.id === s.id)),
    "Original services remain",
  );
  const knownVolumeIds = new Set(intent.beforeIds);
  for (const entry of await readdir(config.controlDirectory, {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) continue;
    const owned = await optionalMetadata(
      join(config.controlDirectory, entry.name, "journal.json"),
    );
    for (const resource of owned?.volumes ?? [])
      knownVolumeIds.add(resource.id);
  }
  for (const volume of volumes) {
    assert.equal(volume.projectId, c.projectId);
    assert.equal(
      volume.volumeInstances.pageInfo.hasNextPage,
      false,
      "Incomplete volume ownership",
    );
    const refs = volume.volumeInstances.edges.map((e) => e.node);
    if (!knownVolumeIds.has(volume.id)) {
      assert.ok(
        !refs.some(
          (r) =>
            state.retainedEnvironmentIds.includes(r.environmentId) ||
            r.serviceId === c.redisServiceId,
        ),
        "Late volume detected; exact cleanup required",
      );
      assert.ok(
        refs.length > 0 ||
          Date.parse(volume.createdAt) < Date.parse(c.startedAt),
        "Unattached volume has ambiguous ownership",
      );
    }
  }
  for (const saved of journal.environments) {
    const listed = environments.find((e) => e.id === saved.id);
    assert.ok(listed, "Retained volume namespace missing");
    const detail = await api.environment(saved.id);
    for (const key of ["id", "name", "projectId", "createdAt", "isEphemeral"])
      assert.equal(detail[key], saved[key], "Retained environment changed");
    assert.equal(
      detail.sourceEnvironment?.id ?? null,
      saved.sourceEnvironment?.id ?? null,
    );
    assert.deepEqual(
      detail.serviceInstances,
      [],
      "Retained environment contains services",
    );
    assert.ok(
      detail.volumeInstances.every((v) =>
        journal.volumes.some((old) => old.id === v.volumeId),
      ),
      "Late volume detected in retained environment",
    );
  }
  state.retainedVolumes = [];
  for (const resource of journal.volumes) {
    const receipt = journal.volumeDeletionReceipts?.find(
      (r) => r.volumeId === resource.id,
    );
    const evidence = await observeVolumeRetirement({
      api,
      journal,
      resource,
      receipt,
    });
    if (evidence.state !== "absent")
      state.retainedVolumes.push({ volumeId: resource.id, evidence });
  }
  state.lastVerifiedAt = new Date().toISOString();
  state.providerFinality = "unknown";
  await durableJson(path, state);
  // Publish a terminal failed attempt while retaining every original resource ID.
  if (!state.registryTransferred) {
    const snapshot = await optionalMetadata(config.recordsFile);
    let run = snapshot.runs.find((r) => r.runId === c.lifecycleRunId);
    assert.ok(run, "Original registry ownership missing");
    if (run.phase === "interrupted") {
      run = { ...run, phase: "teardown" };
      await publishSnapshot(config.recordsFile, { run });
    }
    if (run.phase !== "complete")
      await publishSnapshot(config.recordsFile, {
        run: { ...run, phase: "complete" },
      });
    await (dependencies.distribute ?? distributeSnapshot)(
      config.recordsFile,
      config.consumers,
    );
    state.registryTransferred = true;
  }
  state.status = "watching";
  await durableJson(path, state);
  await dependencies.beforeTransfer(stableBinding);
  await finishTransfer(root, config, state, dependencies);
  return {
    lifecycleRunId: c.lifecycleRunId,
    runnerRunId: c.runnerRunId,
    bindingSha256: stableBinding,
    status: "watching",
    providerFinality: "unknown",
    originalStatus: "failed",
    deadlineExceeded: true,
    retainedEnvironmentIds: state.retainedEnvironmentIds,
    lastVerifiedAt: state.lastVerifiedAt,
  };
}
