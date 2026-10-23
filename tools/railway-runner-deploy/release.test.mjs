import assert from "node:assert/strict";
import test from "node:test";
import { generateRelease } from "./release.mjs";
import { POLICY, sha256, BUILD_WORKFLOW } from "./contract.mjs";
test("generator records exact build provenance and verified supplied bootstrap identity", async () => {
  const manifest = Buffer.from(
    JSON.stringify({
      revision: "a".repeat(40),
      files: [{ path: "package.json", sha256: "b".repeat(64) }],
      compatibilityFiles: [{ path: "package.json", sha256: "b".repeat(64) }],
    }),
  );
  const identity = {
    protocolVersion: 1,
    sourceRevision: "a".repeat(40),
    sourceManifestSha256: sha256(manifest),
    compatibilitySha256: sha256(
      JSON.stringify(JSON.parse(manifest).compatibilityFiles),
    ),
    policySha256: POLICY,
  };
  const image = `ghcr.io/copilotkit/rich-thread-runner@sha256:${"c".repeat(64)}`;
  const run = {
    run_started_at: "2026-10-16T12:00:00Z",
    updated_at: "2026-10-16T13:00:00Z",
    id: 1,
    run_attempt: 2,
    head_sha: identity.sourceRevision,
    path: BUILD_WORKFLOW,
    status: "completed",
    conclusion: "success",
    repository: { id: 655515393, full_name: "CopilotKit/CopilotKit" },
    head_repository: { id: 655515393, full_name: "CopilotKit/CopilotKit" },
  };
  const artifact = {
    created_at: "2026-10-16T12:30:00Z",
    id: 3,
    name: "bounded-row1-image-candidates",
    expired: false,
    size_in_bytes: 100,
    digest: `sha256:${"d".repeat(64)}`,
    workflow_run: { id: 1, head_sha: run.head_sha },
  };
  const github = {
    run: async () => run,
    artifacts: async () => [artifact],
    artifact: async () => artifact,
    workflow: async () => Buffer.from("workflow"),
    archive: async () => ({
      "runner-identity.json": Buffer.from(JSON.stringify(identity)),
      "runner-source.json": manifest,
      "image-candidates.json": Buffer.from(
        JSON.stringify({ revision: run.head_sha, runner: image }),
      ),
    }),
  };
  const release = await generateRelease({
    buildRun: 1,
    bootstrapBaseline: { image, runtimeIdentity: identity },
    github,
    verifyImage: async () => {},
  });
  assert.equal(release.build.runAttempt, 2);
  assert.equal(release.build.artifactId, 3);
  assert.equal(release.build.artifactSha256, "d".repeat(64));
  assert.deepEqual(release.baseline, { image, runtimeIdentity: identity });
  await assert.rejects(
    generateRelease({
      buildRun: 1,
      baselineRun: 7,
      bootstrapBaseline: { image, runtimeIdentity: identity },
      github,
      verifyImage: async () => {},
    }),
  );
});

test("verified release replaces an existing output atomically without leftover temporary files", async () => {
  const { mkdtemp, writeFile, readFile, readdir, rm, mkdir } =
    await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { writeRelease } = await import("./release.mjs");
  const root = await mkdtemp(join(tmpdir(), "runner-release-output-"));
  try {
    const output = join(root, "staging.json");
    await writeFile(output, "previous release");
    await writeRelease(output, { schemaVersion: 1 });
    assert.deepEqual(JSON.parse(await readFile(output)), { schemaVersion: 1 });
    assert.deepEqual(await readdir(root), ["staging.json"]);
    const directory = join(root, "directory");
    await mkdir(directory);
    await assert.rejects(writeRelease(directory, { schemaVersion: 1 }));
    assert.deepEqual((await readdir(root)).sort(), [
      "directory",
      "staging.json",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
