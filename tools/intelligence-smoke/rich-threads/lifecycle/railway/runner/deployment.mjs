import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

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
  if (retained)
    assert.equal(
      templateDigest(retained),
      templateSha256,
      "Retained configuration mismatch",
    );
  const recovery = await optionalMetadata(join(root, "recovery.json"));
  if (recoveryAuthorization || recovery) {
    assert.ok(
      metadata && retained && initialized,
      "Recovery requires initialized retained authority",
    );
    assert.equal(metadata.templateSha256, templateSha256);
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
