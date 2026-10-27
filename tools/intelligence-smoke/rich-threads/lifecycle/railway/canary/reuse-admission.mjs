import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve, isAbsolute } from "node:path";

export const reuseIdentity = Object.freeze({
  projectId: "a843d02e-df72-4161-93cc-2bebbba329b2",
  projectName: "pni605-canary-4c62a8d01b97",
  workspaceId: "9cab81e9-4aa5-40cd-a484-3a585ca35c90",
  createdAt: "2026-10-19T12:18:51.730Z",
  baselineId: "addf2003-bbb0-4b33-a49e-c42c54688d36",
  sourceId: "5f09c966-4c75-4642-a162-2fe22c3cb53c",
  sourceName: "pni605-c761e7aa-a",
  sourceCreatedAt: "2026-10-19T12:19:14.125Z",
  unresolvedName: "pni605-c761e7aa-b",
});
const digest = (value) => createHash("sha256").update(value).digest("hex");

/** Operator-reviewed admission binds evidence; it does not infer deletion status
 * from a null deletedAt or turn an old unknown request into a cancelled one.
 */
export async function loadReuseAdmission({
  root,
  priorRoot,
  admissionPath,
  scope,
  clock = Date.now,
  expected,
  cleanup = false,
}) {
  assert.ok(isAbsolute(priorRoot) && isAbsolute(admissionPath));
  assert.notEqual(resolve(root), resolve(priorRoot, "probe"));
  assert.notEqual(resolve(root), resolve(priorRoot));
  for (const key of ["projectId", "projectName", "workspaceId"])
    assert.equal(scope[key], reuseIdentity[key]);
  const raw = await readFile(admissionPath);
  const admission = JSON.parse(raw);
  const admissionSha256 = digest(raw);
  if (expected)
    assert.equal(
      admissionSha256,
      expected.admissionSha256,
      "Reuse admission changed",
    );
  assert.equal(admission.version, 1);
  assert.equal(admission.kind, "pni605-existing-project-reuse");
  assert.equal(
    admission.authorization,
    "ran-2026-10-19-reuse-existing-project",
  );
  for (const key of ["projectId", "projectName", "workspaceId"])
    assert.equal(admission[key], reuseIdentity[key]);
  const reviewedAt = Date.parse(admission.reviewedAt);
  const expiresAt = Date.parse(admission.expiresAt);
  assert.ok(Number.isFinite(reviewedAt) && Number.isFinite(expiresAt));
  assert.ok(
    reviewedAt <= clock() && (cleanup || clock() < expiresAt),
    "Reuse admission expired or future dated",
  );
  assert.ok(expiresAt > reviewedAt && expiresAt - reviewedAt <= 900000);
  if (!expected)
    assert.ok(clock() - reviewedAt <= 300000, "Reuse review must be recent");
  assert.equal(
    admission.deletion.status,
    "inactive",
    "Pending or unknown project deletion blocks reuse",
  );
  assert.ok(isAbsolute(admission.deletion.evidencePath));
  assert.equal(
    digest(await readFile(admission.deletion.evidencePath)),
    admission.deletion.sha256,
    "Deletion evidence changed",
  );
  const originals = {};
  for (const [kind, path] of Object.entries({
    project: "project-journal.json",
    probe: "probe/journal.json",
    retirement: "project-retirement.json",
  })) {
    const bytes = await readFile(join(priorRoot, path));
    assert.equal(
      digest(bytes),
      admission.prior[`${kind}Sha256`],
      "Original journal changed",
    );
    originals[kind] = JSON.parse(bytes);
  }
  const { project, probe, retirement } = originals;
  assert.equal(project.status, "create-verified");
  assert.equal(project.returned.id, reuseIdentity.projectId);
  assert.equal(project.returned.name, reuseIdentity.projectName);
  assert.equal(project.returned.workspaceId, reuseIdentity.workspaceId);
  assert.equal(project.returned.createdAt, reuseIdentity.createdAt);
  assert.ok(
    Array.isArray(project.before) &&
      !project.before.some((p) => p.id === reuseIdentity.projectId),
  );
  assert.equal(probe.status, "unresolved");
  assert.equal(probe.scope.projectId, reuseIdentity.projectId);
  assert.equal(probe.intents.length, 2);
  assert.deepEqual(probe.services, []);
  assert.deepEqual(probe.environments, [
    { id: reuseIdentity.sourceId, name: reuseIdentity.sourceName },
  ]);
  const [sourceIntent, unknownIntent] = probe.intents;
  assert.equal(sourceIntent.operation, "createEnvironment");
  assert.equal(sourceIntent.status, "returned");
  assert.equal(sourceIntent.input.input.projectId, reuseIdentity.projectId);
  assert.equal(sourceIntent.input.input.name, reuseIdentity.sourceName);
  assert.equal(sourceIntent.input.input.sourceEnvironmentId, undefined);
  const source = sourceIntent.result;
  assert.equal(source.id, reuseIdentity.sourceId);
  assert.equal(source.name, reuseIdentity.sourceName);
  assert.equal(source.projectId, reuseIdentity.projectId);
  assert.equal(source.createdAt, reuseIdentity.sourceCreatedAt);
  assert.equal(source.isEphemeral, true);
  assert.equal(source.sourceEnvironment, null);
  assert.equal(unknownIntent.operation, "createEnvironment");
  assert.equal(unknownIntent.status, "pending");
  assert.equal(unknownIntent.result, undefined);
  assert.equal(unknownIntent.input.input.projectId, reuseIdentity.projectId);
  assert.equal(unknownIntent.input.input.name, reuseIdentity.unresolvedName);
  assert.equal(unknownIntent.input.input.sourceEnvironmentId, undefined);
  assert.equal(retirement.projectId, reuseIdentity.projectId);
  assert.equal(retirement.status, "deletion-unresolved");
  assert.equal(retirement.response, "unknown");
  assert.equal(retirement.probeJournalSha256, admission.prior.probeSha256);
  if (expected) {
    assert.deepEqual(
      expected.admission,
      admission,
      "Saved reuse admission differs from evidence",
    );
    assert.deepEqual(
      expected.originals,
      originals,
      "Saved original journals changed",
    );
    assert.deepEqual(expected.source, source, "Saved reuse source changed");
    assert.deepEqual(
      expected.unknownIntent,
      unknownIntent,
      "Saved unknown intent changed",
    );
    assert.equal(expected.expiresAt, expiresAt);
  }
  return {
    priorRoot,
    admissionPath,
    admissionSha256,
    admission,
    originals,
    source,
    unknownIntent,
    expiresAt,
  };
}

export function assertReuseInventory(snapshot, state, reuse, cleanup = false) {
  const identity = reuseIdentity;
  assert.equal(snapshot.project.id, identity.projectId);
  assert.equal(snapshot.project.name, identity.projectName);
  assert.equal(snapshot.project.workspaceId, identity.workspaceId);
  assert.equal(snapshot.project.createdAt, identity.createdAt);
  assert.equal(
    snapshot.project.deletedAt,
    null,
    "Deleted project blocks reuse",
  );
  assert.ok(
    !snapshot.environments.some((e) => e.name === identity.unresolvedName),
    "Original unresolved environment appeared; reconcile before writes",
  );
  const allowed = new Set([
    identity.baselineId,
    identity.sourceId,
    ...state.environments.map((e) => e.id),
  ]);
  assert.ok(
    snapshot.environments.every((e) => allowed.has(e.id)),
    "Unexpected environment blocks reuse",
  );
  for (const id of [identity.baselineId, identity.sourceId])
    assert.equal(
      snapshot.environments.filter((e) => e.id === id).length,
      1,
      "Reuse baseline disappeared",
    );
  for (const source of [
    snapshot.environments.find((e) => e.id === identity.sourceId),
    snapshot.details.find((e) => e.id === identity.sourceId),
  ]) {
    for (const key of ["id", "name", "projectId", "createdAt", "isEphemeral"])
      assert.equal(source[key], reuse.source[key]);
    assert.equal(source.sourceEnvironment?.id ?? null, null);
  }
  for (const id of [identity.baselineId, identity.sourceId]) {
    const detail = snapshot.details.find((e) => e.id === id);
    if (cleanup)
      assert.ok(
        detail.serviceInstances.every((instance) =>
          state.services.some((s) => s.id === instance.serviceId),
        ),
        "Unowned baseline service blocks cleanup",
      );
    else
      assert.deepEqual(
        detail.serviceInstances,
        [],
        "Existing baseline must remain empty",
      );
    assert.deepEqual(detail.volumeInstances, []);
  }
  const serviceIds = new Set(state.services.map((s) => s.id));
  assert.ok(
    snapshot.services.every((s) => serviceIds.has(s.id)),
    "Unexpected service blocks reuse",
  );
  assert.deepEqual(snapshot.volumes, []);
}
