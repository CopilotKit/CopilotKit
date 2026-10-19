import assert from "node:assert/strict";

export const volumeRetentionMs = 48 * 60 * 60 * 1000;

/** Independent complete inventory, never a local marker, establishes detachment. */
export async function observeVolumeRetirement({
  api,
  journal,
  resource,
  receipt,
  now = Date.now(),
}) {
  assert.equal(
    receipt?.volumeId,
    resource.id,
    "Missing exact volume deletion intent",
  );
  assert.equal(receipt.projectId, journal.projectId);
  assert.equal(receipt.environmentId, journal.environmentId);
  assert.ok(
    ["pending", "acknowledged", "unknown", "refused"].includes(receipt.outcome),
  );
  const volumes = await api.list("volumes", journal.projectId);
  const environments = await api.list("environments", journal.projectId);
  assert.equal(
    new Set(environments.map((e) => e.id)).size,
    environments.length,
  );
  for (const e of environments) assert.equal(e.projectId, journal.projectId);
  const details = await Promise.all(
    environments.map(async (e) => {
      const detail = await api.environment(e.id);
      assert.equal(detail.id, e.id);
      assert.equal(detail.projectId, journal.projectId);
      return detail;
    }),
  );
  const volume = volumes.find((v) => v.id === resource.id);
  const references = details.flatMap((e) =>
    e.volumeInstances.filter((v) => v.volumeId === resource.id),
  );
  const observedAt = new Date(now).toISOString();
  if (!volume) {
    assert.equal(
      references.length,
      0,
      "Absent volume still referenced by environment",
    );
    return {
      state: "absent",
      observedAt,
      volumeId: resource.id,
      projectId: journal.projectId,
    };
  }
  assert.equal(
    receipt.requestSent,
    true,
    "Pending volume requires durable sent deletion intent",
  );
  assert.notEqual(
    receipt.outcome,
    "refused",
    "Provider refused volume deletion",
  );
  assert.equal(volume.projectId, journal.projectId);
  assert.equal(
    volume.volumeInstances.pageInfo.hasNextPage,
    false,
    "Incomplete volume instance inventory",
  );
  const instances = volume.volumeInstances.edges.map((e) => e.node);
  assert.ok(
    instances.length > 0,
    "Retained volume has no pending-deletion evidence",
  );
  for (const instance of [...instances, ...references]) {
    assert.equal(instance.volumeId, resource.id);
    assert.equal(
      instance.environmentId,
      journal.environmentId,
      "Volume escaped owned environment",
    );
    assert.equal(instance.mountPath, resource.mountPath);
    assert.equal(instance.serviceId, null, "Volume remains attached");
    assert.equal(
      instance.isPendingDeletion,
      true,
      "Volume is not pending deletion",
    );
  }
  if (details.some((e) => e.id === journal.environmentId))
    for (const instance of instances)
      assert.ok(
        references.some((r) => r.id === instance.id),
        "Volume missing from existing environment inventory",
      );
  for (const reference of references)
    assert.ok(
      instances.some((i) => i.id === reference.id),
      "Inconsistent volume inventories",
    );
  return {
    state: "pending-detached",
    observedAt,
    volumeId: resource.id,
    projectId: journal.projectId,
    environmentId: journal.environmentId,
    instances,
    environmentReferences: references,
    inspectedEnvironmentIds: details.map((e) => e.id),
    inventoryComplete: true,
  };
}

export function retainedVolumeRecord({
  journal,
  resource,
  receipt,
  evidence,
  previous,
}) {
  assert.equal(evidence.state, "pending-detached");
  const firstVerifiedAt = previous?.firstVerifiedAt ?? evidence.observedAt;
  const retentionDeadlineAt = new Date(
    Date.parse(firstVerifiedAt) + volumeRetentionMs,
  ).toISOString();
  return {
    volumeId: resource.id,
    projectId: journal.projectId,
    environmentId: journal.environmentId,
    serviceId: resource.serviceId,
    mountPath: resource.mountPath,
    firstVerifiedAt,
    retentionDeadlineAt,
    overdue: Date.parse(evidence.observedAt) > Date.parse(retentionDeadlineAt),
    receipt: structuredClone(receipt),
    evidence,
  };
}
