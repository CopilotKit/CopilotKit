import assert from "node:assert/strict";
import test from "node:test";
import {
  validateRelease,
  verifyBuild,
  readBaselineReceipt,
} from "./provenance.mjs";
import {
  BUILD_WORKFLOW,
  DEPLOY_WORKFLOW,
  DEV_DEPLOY_WORKFLOW,
  POLICY,
  sha256,
  STAGING,
} from "./contract.mjs";

function fixture() {
  const files = [
    { path: "package.json", sha256: "a".repeat(64) },
    {
      path: "tools/intelligence-smoke/rich-threads/scenarios/row1.mjs",
      sha256: "b".repeat(64),
    },
  ];
  const manifest = Buffer.from(
    JSON.stringify({
      revision: "a".repeat(40),
      files,
      compatibilityFiles: [files[0]],
    }),
  );
  const identity = {
    protocolVersion: 1,
    sourceRevision: "a".repeat(40),
    sourceManifestSha256: sha256(manifest),
    compatibilitySha256: sha256(JSON.stringify([files[0]])),
    policySha256: POLICY,
  };
  const image = `ghcr.io/copilotkit/rich-thread-runner@sha256:${"b".repeat(64)}`;
  const workflow = Buffer.from("trusted workflow");
  const artifact = {
    created_at: "2026-10-16T12:30:00Z",
    id: 9,
    name: "bounded-row1-image-candidates",
    expired: false,
    size_in_bytes: 1000,
    digest: `sha256:${"c".repeat(64)}`,
    workflow_run: { id: 7, head_sha: identity.sourceRevision },
  };
  const release = {
    schemaVersion: 1,
    sourceRevision: identity.sourceRevision,
    build: {
      runId: 7,
      runAttempt: 1,
      workflowPath: BUILD_WORKFLOW,
      workflowSha256: sha256(workflow),
      artifactId: 9,
      artifactSha256: "c".repeat(64),
    },
    baseline: { image, runtimeIdentity: identity },
    candidate: { image, runtimeIdentity: identity },
  };
  const run = {
    run_started_at: "2026-10-16T12:00:00Z",
    updated_at: "2026-10-16T13:00:00Z",
    id: 7,
    run_attempt: 1,
    head_sha: identity.sourceRevision,
    path: BUILD_WORKFLOW,
    status: "completed",
    conclusion: "success",
    repository: { id: 655515393, full_name: "CopilotKit/CopilotKit" },
    head_repository: { id: 655515393, full_name: "CopilotKit/CopilotKit" },
  };
  const archive = {
    "runner-source.json": manifest,
    "runner-identity.json": Buffer.from(JSON.stringify(identity)),
    "image-candidates.json": Buffer.from(
      JSON.stringify({
        revision: identity.sourceRevision,
        runner: image,
        approved: false,
      }),
    ),
  };
  const github = {
    run: async () => run,
    workflow: async () => workflow,
    artifact: async () => artifact,
    archive: async () => archive,
  };
  return { release, run, artifact, archive, github };
}
test("reviewed immutable build verifies even when artifact approved is false", async () => {
  const h = fixture();
  validateRelease(h.release);
  await verifyBuild(h.release, h.github, { verifyImage: async () => {} });
});
for (const field of [
  "attempt",
  "repository",
  "headRepository",
  "revision",
  "workflow",
  "artifact",
  "expired",
  "identity",
  "compatibility",
  "digest",
])
  test(`rejects build ${field} mismatch`, async () => {
    const h = fixture();
    if (field === "attempt") h.run.run_attempt = 2;
    if (field === "repository") h.run.repository.full_name = "attacker/repo";
    if (field === "headRepository") h.run.head_repository.id = 1;
    if (field === "revision") h.run.head_sha = "b".repeat(40);
    if (field === "workflow")
      h.github.workflow = async () => Buffer.from("changed workflow");
    if (field === "artifact") h.artifact.id = 10;
    if (field === "expired") h.artifact.expired = true;
    if (field === "identity")
      h.archive["runner-identity.json"] = Buffer.from("{}");
    if (field === "compatibility")
      h.release.candidate.runtimeIdentity.compatibilitySha256 = "f".repeat(64);
    if (field === "digest") h.artifact.digest = `sha256:${"d".repeat(64)}`;
    await assert.rejects(
      verifyBuild(h.release, h.github, { verifyImage: async () => {} }),
    );
  });
test("schema rejects mutable image and foreign policy", () => {
  const h = fixture();
  h.release.candidate.image = "ghcr.io/copilotkit/rich-thread-runner:latest";
  assert.throws(() => validateRelease(h.release));
});
test("baseline uses verified actual final state from failed rollback run", async () => {
  const h = fixture();
  h.run.path = DEPLOY_WORKFLOW;
  h.run.head_branch = "main";
  h.run.conclusion = "failure";
  const receipt = {
    schemaVersion: 1,
    operationId: "github-655515393-7",
    releaseSha256: "d".repeat(64),
    run: {
      id: 7,
      attempt: 1,
      sha: h.run.head_sha,
      workflowPath: DEPLOY_WORKFLOW,
    },
    outcome: "rolled-back",
    finalState: {
      verified: true,
      image: h.release.baseline.image,
      runtimeIdentity: h.release.baseline.runtimeIdentity,
      deploymentId: "deployment",
      templateSha256: "e".repeat(64),
      volumeId: STAGING.volumeId,
      volumeInstanceId: STAGING.volumeInstanceId,
      mountPath: "/data",
      phase: "running",
    },
  };
  h.github.receipt = async () => receipt;
  assert.deepEqual(await readBaselineReceipt(7, h.github), h.release.baseline);
  receipt.finalState.verified = false;
  await assert.rejects(readBaselineReceipt(7, h.github));
});
test("development baselines require the exact development workflow and branch prefix", async () => {
  const h = fixture();
  h.run.path = DEV_DEPLOY_WORKFLOW;
  h.run.head_branch = "dev/railway-runner-branch-deploy";
  h.github.receipt = async () => ({
    schemaVersion: 1,
    operationId: "github-655515393-7",
    releaseSha256: "d".repeat(64),
    run: {
      id: 7,
      attempt: 1,
      sha: h.run.head_sha,
      workflowPath: DEV_DEPLOY_WORKFLOW,
    },
    outcome: "deployed",
    finalState: {
      verified: true,
      phase: "running",
      deploymentId: "deployment",
      image: h.release.baseline.image,
      runtimeIdentity: h.release.baseline.runtimeIdentity,
      templateSha256: "e".repeat(64),
      volumeId: STAGING.volumeId,
      volumeInstanceId: STAGING.volumeInstanceId,
      mountPath: "/data",
    },
  });
  assert.deepEqual(await readBaselineReceipt(7, h.github), h.release.baseline);
  for (const [path, branch] of [
    [DEV_DEPLOY_WORKFLOW, "main"],
    [DEV_DEPLOY_WORKFLOW, "feature"],
    [DEPLOY_WORKFLOW, "dev/railway-runner-branch-deploy"],
    [".github/workflows/foreign.yml", "dev/railway-runner-branch-deploy"],
  ]) {
    h.run.path = path;
    h.run.head_branch = branch;
    await assert.rejects(readBaselineReceipt(7, h.github));
  }
});
test("artifact created before selected run attempt is rejected", async () => {
  const h = fixture();
  h.run.run_started_at = "2026-10-16T12:00:00Z";
  h.run.updated_at = "2026-10-16T13:00:00Z";
  h.artifact.created_at = "2026-10-16T11:00:00Z";
  await assert.rejects(
    verifyBuild(h.release, h.github, { verifyImage: async () => {} }),
  );
});
test("release schema rejects extra control fields", () => {
  const h = fixture();
  h.release.environmentId = "other";
  assert.throws(() => validateRelease(h.release));
});
