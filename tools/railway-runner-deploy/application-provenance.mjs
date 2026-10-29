import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sha256 } from "./contract.mjs";
import { boundedBytes } from "./adapters.mjs";
import {
  verifyBuild,
  validateRun,
  validateArtifactTime,
} from "./provenance.mjs";
import { verifyRegistryImage } from "./github.mjs";
import {
  APPLICATION_IMAGE,
  APPLICATION_POLICY,
  validateApplicationRelease,
} from "./application-release.mjs";

/** Authenticate only to GHCR and verify actual manifest bytes for the two scoped repositories. */
export async function verifyApplicationImage(
  image,
  { token, fetch: request = globalThis.fetch },
) {
  const match =
    /^ghcr\.io\/(copilotkit\/(?:rich-thread-application|showcase-harness))@(sha256:[a-f0-9]{64})$/.exec(
      image,
    );
  assert.ok(match, "Scoped immutable application image required");
  const [, repository, digest] = match;
  const auth = await request(
    `https://ghcr.io/token?service=ghcr.io&scope=repository:${repository}:pull`,
    {
      headers: {
        authorization: `Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
      },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    },
  );
  assert.ok(auth.ok, "Registry authentication refused");
  const access = JSON.parse(await boundedBytes(auth, 65536));
  assert.ok(
    typeof access.token === "string" && access.token.length,
    "Registry authentication refused",
  );
  const result = await request(
    `https://ghcr.io/v2/${repository}/manifests/${digest}`,
    {
      headers: {
        authorization: `Bearer ${access.token}`,
        accept:
          "application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.docker.distribution.manifest.list.v2+json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    },
  );
  assert.ok(
    result.ok &&
      `sha256:${sha256(await boundedBytes(result, 4 * 1024 * 1024))}` ===
        digest,
    "Registry image digest mismatch",
  );
}

export async function verifyApplicationProvenance(intent, github, token) {
  validateApplicationRelease(intent);
  const original = JSON.parse(
    await readFile(new URL("./releases/browser-upgrade.json", import.meta.url)),
  );
  for (const key of [
    "watches",
    "volumeWatch",
    "volumeRecovery",
    "recoveryBindingSha256",
  ])
    assert.deepEqual(
      intent[key],
      original[key],
      "Historical evidence contract changed",
    );
  const manifests = [];
  const archives = new Map();
  const cached = {
    ...github,
    archive: async (artifact) => {
      if (!archives.has(artifact.id))
        archives.set(artifact.id, await github.archive(artifact));
      return archives.get(artifact.id);
    },
  };
  for (const [candidate, build] of [
    [intent.baseline, intent.baselineBuild],
    [intent.candidate, intent.build],
  ]) {
    await verifyBuild(
      {
        schemaVersion: 1,
        sourceRevision: candidate.runtimeIdentity.sourceRevision,
        baseline: candidate,
        candidate,
        build,
      },
      cached,
      { verifyImage: (image) => verifyRegistryImage(image, { token }) },
    );
    manifests.push(
      JSON.parse(archives.get(build.artifactId)["runner-source.json"]).files,
    );
  }
  const before = new Map(manifests[0].map((file) => [file.path, file.sha256]));
  const after = new Map(manifests[1].map((file) => [file.path, file.sha256]));
  const changed = [...new Set([...before.keys(), ...after.keys()])]
    .filter((path) => before.get(path) !== after.get(path))
    .sort();
  assert.deepEqual(
    changed,
    [
      "showcase/scripts/railway-envs.ts",
      "tools/intelligence-smoke/rich-threads/application/mastra-backend.mjs",
      "tools/intelligence-smoke/rich-threads/driver.integration.mjs",
      "tools/intelligence-smoke/rich-threads/lifecycle/railway/project.json",
      "tools/intelligence-smoke/rich-threads/lifecycle/railway/recovery.test.mjs",
      "tools/intelligence-smoke/rich-threads/lifecycle/railway/runner/application-template.mjs",
      "tools/intelligence-smoke/rich-threads/lifecycle/railway/runner/application-template.test.mjs",
      "tools/intelligence-smoke/rich-threads/lifecycle/railway/runner/deployment.mjs",
      "tools/intelligence-smoke/rich-threads/lifecycle/railway/runner/deployment.test.mjs",
      "tools/intelligence-smoke/rich-threads/lifecycle/railway/volume-create-fixture.mjs",
      "tools/intelligence-smoke/rich-threads/lifecycle/railway/volume-create-recovery.test.mjs",
    ].sort(),
    "Unexpected source change in application transition",
  );

  // The application pin comes from the independently retained Mastra-fix build.
  const applicationArtifact = await github.artifact(12884012749);
  assert.equal(
    applicationArtifact.digest,
    "sha256:714a11b837cbdbe70691d7f91aa6bb6a925a574fd69a409b5dbaaf396a9e9840",
  );
  assert.equal(applicationArtifact.workflow_run?.id, 40843670703);
  const applicationRun = await github.run(40843670703, 1);
  validateRun(applicationRun, {
    runId: 40843670703,
    runAttempt: 1,
    sourceRevision: "51ccd04cf11a137d19ae7d416bddf6146b51bf96",
    workflowPath: ".github/workflows/intelligence-rich-threads-build.yml",
  });
  validateArtifactTime(applicationArtifact, applicationRun);
  const applicationArchive = await cached.archive(applicationArtifact);
  assert.equal(
    JSON.parse(applicationArchive["image-candidates.json"]).application,
    APPLICATION_IMAGE,
  );
  await verifyApplicationImage(APPLICATION_IMAGE, { token });

  const build = intent.harness.build;
  assert.equal(
    build.workflowPath,
    ".github/workflows/intelligence-harness-policy-build.yml",
  );
  const run = await github.run(build.runId, build.runAttempt);
  validateRun(run, { ...build, sourceRevision: intent.harness.sourceRevision });
  assert.equal(
    sha256(
      await github.workflow(build.workflowPath, intent.harness.sourceRevision),
    ),
    build.workflowSha256,
  );
  assert.equal(
    build.workflowSha256,
    sha256(await readFile(build.workflowPath)),
    "Harness builder differs from reviewed implementation",
  );
  const artifact = await github.artifact(build.artifactId);
  assert.equal(artifact.name, "harness-policy-candidate");
  assert.equal(artifact.expired, false);
  assert.equal(artifact.workflow_run?.id, build.runId);
  assert.equal(artifact.workflow_run?.head_sha, intent.harness.sourceRevision);
  assert.equal(artifact.digest, `sha256:${build.artifactSha256}`);
  validateArtifactTime(artifact, run);
  const archive = await cached.archive(artifact);
  assert.deepEqual(JSON.parse(archive["harness-policy-candidate.json"]), {
    sourceRevision: intent.harness.sourceRevision,
    image: intent.harness.image,
    policySha256: APPLICATION_POLICY,
  });
  await verifyApplicationImage(intent.harness.image, { token });
}
