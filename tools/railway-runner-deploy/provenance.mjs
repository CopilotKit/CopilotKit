import {
  validateRecovery,
  RECOVERY_BASELINE_IMAGE,
} from "./recovery-contract.mjs";
import {
  BUILD_WORKFLOW,
  DEPLOY_WORKFLOW,
  IMAGE,
  REPOSITORY,
  REPOSITORY_ID,
  REVISION,
  SHA256,
  compatible,
  equal,
  requireThat,
  sha256,
  validateIdentity,
  validateVolume,
} from "./contract.mjs";

const positive = (value) => Number.isSafeInteger(value) && value > 0;
/** Reject malformed release records before making any provider call. */
export function validateRelease(release) {
  requireThat(
    release &&
      equal(
        Object.keys(release).sort(),
        [
          "schemaVersion",
          "sourceRevision",
          "build",
          "baseline",
          "candidate",
          ...(Object.hasOwn(release, "recovery") ? ["recovery"] : []),
        ].sort(),
      ),
    "Unknown release fields",
  );
  requireThat(
    release?.schemaVersion === 1 && REVISION.test(release.sourceRevision),
    "Invalid release record",
  );
  for (const item of [release.baseline, release.candidate]) {
    requireThat(
      item &&
        equal(Object.keys(item).sort(), ["image", "runtimeIdentity"]) &&
        IMAGE.test(item.image),
      "Immutable runner image required",
    );
    validateIdentity(item.runtimeIdentity);
  }
  if (Object.hasOwn(release, "recovery")) {
    requireThat(
      release.baseline.image === RECOVERY_BASELINE_IMAGE &&
        release.candidate.image !== RECOVERY_BASELINE_IMAGE,
      "Recovery image mismatch",
    );
    validateRecovery(
      release.recovery,
      release.baseline.runtimeIdentity,
      release.candidate.runtimeIdentity,
    );
  } else
    compatible(
      release.baseline.runtimeIdentity,
      release.candidate.runtimeIdentity,
    );
  requireThat(
    release.candidate.runtimeIdentity.sourceRevision === release.sourceRevision,
    "Candidate revision mismatch",
  );
  const build = release.build;
  requireThat(
    build &&
      equal(
        Object.keys(build).sort(),
        [
          "runId",
          "runAttempt",
          "workflowPath",
          "workflowSha256",
          "artifactId",
          "artifactSha256",
        ].sort(),
      ) &&
      positive(build.runId) &&
      positive(build.runAttempt) &&
      positive(build.artifactId) &&
      build.workflowPath === BUILD_WORKFLOW &&
      SHA256.test(build.workflowSha256) &&
      SHA256.test(build.artifactSha256),
    "Invalid build provenance",
  );
}
/** Require the actual repository, source repository, attempt and workflow to match. */
export function validateRun(
  run,
  { runId, runAttempt, sourceRevision, workflowPath, success = true },
) {
  requireThat(
    run?.id === runId &&
      run.run_attempt === runAttempt &&
      run.head_sha === sourceRevision &&
      run.path === workflowPath &&
      run.status === "completed" &&
      (!success || run.conclusion === "success"),
    "Build run provenance mismatch",
  );
  for (const repo of [run.repository, run.head_repository])
    requireThat(
      repo?.id === REPOSITORY_ID && repo.full_name === REPOSITORY,
      "Foreign repository refused",
    );
}
/** Reject a stale artifact from an earlier attempt of the same workflow run. */
export function validateArtifactTime(artifact, run) {
  const created = Date.parse(artifact.created_at),
    started = Date.parse(run.run_started_at),
    finished = Date.parse(run.updated_at);
  requireThat(
    Number.isFinite(created) &&
      Number.isFinite(started) &&
      Number.isFinite(finished) &&
      created >= started &&
      created <= finished,
    "Artifact does not belong to selected run attempt",
  );
}
/** Verify source manifest bytes and the exact frozen file list, treating archives as inert data. */
export function verifySource(archive, release) {
  const identity = JSON.parse(archive["runner-identity.json"]);
  requireThat(
    equal(identity, release.candidate.runtimeIdentity),
    "Artifact identity mismatch",
  );
  const bytes = archive["runner-source.json"];
  requireThat(
    sha256(bytes) === identity.sourceManifestSha256,
    "Source manifest digest mismatch",
  );
  const manifest = JSON.parse(bytes);
  requireThat(
    manifest.revision === release.sourceRevision &&
      Array.isArray(manifest.files) &&
      manifest.files.length > 0 &&
      manifest.files.length <= 1000,
    "Invalid source manifest",
  );
  let previous = "";
  for (const file of manifest.files) {
    requireThat(
      file &&
        typeof file.path === "string" &&
        file.path > previous &&
        /^(package\.json|tools\/intelligence-smoke\/rich-threads\/.+|tools\/railway-disposable-proof\/.+|showcase\/scripts\/railway-envs\.ts|showcase\/harness\/src\/shared\/railway-lifecycle[^/]*)$/.test(
          file.path,
        ) &&
        file.path
          .split("/")
          .every((part) => part && part !== "." && part !== "..") &&
        SHA256.test(file.sha256),
      "Unsafe source manifest",
    );
    previous = file.path;
  }
  const allowed = [
    "tools/intelligence-smoke/rich-threads/scenarios/row1.mjs",
    "tools/intelligence-smoke/rich-threads/rows/row1.mjs",
  ];
  const frozen = manifest.files.filter(
    ({ path }) =>
      !allowed.includes(path) &&
      ![".test.mjs", ".test.ts", ".md"].some((suffix) => path.endsWith(suffix)),
  );
  requireThat(
    equal(frozen, manifest.compatibilityFiles) &&
      sha256(JSON.stringify(frozen)) === identity.compatibilitySha256,
    "Compatibility manifest mismatch",
  );
  const images = JSON.parse(archive["image-candidates.json"]);
  requireThat(
    images.revision === release.sourceRevision &&
      images.runner === release.candidate.image,
    "Candidate image artifact mismatch",
  );
}
/** Prove the reviewed build attempt, workflow, artifact and registry digest before deployment. */
export async function verifyBuild(release, github, { verifyImage }) {
  validateRelease(release);
  const build = release.build;
  const run = await github.run(build.runId, build.runAttempt);
  validateRun(run, { ...build, sourceRevision: release.sourceRevision });
  requireThat(
    sha256(await github.workflow(BUILD_WORKFLOW, release.sourceRevision)) ===
      build.workflowSha256,
    "Build workflow digest mismatch",
  );
  const artifact = await github.artifact(build.artifactId);
  requireThat(
    artifact?.id === build.artifactId &&
      artifact.name === "bounded-row1-image-candidates" &&
      artifact.expired === false &&
      artifact.size_in_bytes > 0 &&
      artifact.size_in_bytes <= 8 * 1024 * 1024 &&
      artifact.digest === `sha256:${build.artifactSha256}` &&
      artifact.workflow_run?.id === build.runId &&
      artifact.workflow_run.head_sha === release.sourceRevision,
    "Build artifact provenance mismatch",
  );
  validateArtifactTime(artifact, run);
  verifySource(await github.archive(artifact), release);
  await verifyImage(release.candidate.image);
  return release;
}
/** Read a baseline from an explicit trusted deployment receipt, including verified rollbacks. */
export async function readBaselineReceipt(
  runId,
  github,
  { bootstrapSha } = {},
) {
  const run = await github.run(runId);
  validateRun(run, {
    runId,
    runAttempt: run.run_attempt,
    sourceRevision: run.head_sha,
    workflowPath: DEPLOY_WORKFLOW,
    success: false,
  });
  requireThat(
    run.head_branch === "main" ||
      (REVISION.test(bootstrapSha ?? "") &&
        run.head_sha === bootstrapSha &&
        run.head_branch === "fix/PNI-605-registry-activation"),
    "Untrusted baseline workflow",
  );
  const receipt = await github.receipt(run);
  requireThat(
    receipt?.schemaVersion === 1 &&
      receipt.operationId === `github-${REPOSITORY_ID}-${runId}` &&
      receipt.run?.id === runId &&
      receipt.run.attempt === run.run_attempt &&
      receipt.run.sha === run.head_sha &&
      receipt.run.workflowPath === DEPLOY_WORKFLOW &&
      SHA256.test(receipt.releaseSha256) &&
      ["deployed", "rolled-back", "unchanged"].includes(receipt.outcome),
    "Invalid baseline receipt",
  );
  const state = receipt.finalState;
  requireThat(
    state?.verified === true &&
      state.phase === "running" &&
      typeof state.deploymentId === "string" &&
      state.deploymentId.length > 0 &&
      SHA256.test(state.templateSha256) &&
      IMAGE.test(state.image),
    "Unverified baseline state",
  );
  validateVolume(state);
  validateIdentity(state.runtimeIdentity);
  return { image: state.image, runtimeIdentity: state.runtimeIdentity };
}
