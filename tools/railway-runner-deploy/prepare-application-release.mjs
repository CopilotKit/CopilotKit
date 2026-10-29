import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createGithub } from "./github.mjs";
import { sha256 } from "./contract.mjs";
import { verifyApplicationProvenance } from "./application-provenance.mjs";
import {
  APPLICATION_IMAGE,
  APPLICATION_POLICY,
  HARNESS_SERVICE,
} from "./application-release.mjs";

/** Assemble a nonsecret release only after both immutable candidate builds exist. */
async function main() {
  const { values } = parseArgs({
    options: {
      "harness-build": { type: "string" },
      "template-sha": { type: "string" },
      output: { type: "string" },
    },
  });
  assert.match(values["harness-build"], /^\d+$/);
  assert.match(values["template-sha"], /^[a-f0-9]{64}$/);
  assert.ok(values.output);
  const github = createGithub({ token: process.env.GITHUB_TOKEN });
  const previous = JSON.parse(
    await readFile(new URL("./releases/browser-upgrade.json", import.meta.url)),
  );
  async function candidate(runId, artifactName) {
    const run = await github.run(runId, 1);
    const artifacts = (await github.artifacts(runId)).filter(
      (item) => item.name === artifactName,
    );
    assert.equal(artifacts.length, 1, "Unique candidate artifact required");
    const artifact = await github.artifact(artifacts[0].id);
    assert.match(artifact.digest, /^sha256:[a-f0-9]{64}$/);
    return {
      run,
      archive: await github.archive(artifact),
      build: {
        runId,
        runAttempt: 1,
        workflowPath: run.path,
        workflowSha256: sha256(await github.workflow(run.path, run.head_sha)),
        artifactId: artifact.id,
        artifactSha256: artifact.digest.slice(7),
      },
    };
  }
  const runner = await candidate(40866670319, "bounded-row1-image-candidates");
  const harness = await candidate(
    Number(values["harness-build"]),
    "harness-policy-candidate",
  );
  const runtimeIdentity = JSON.parse(runner.archive["runner-identity.json"]);
  const harnessIdentity = JSON.parse(
    harness.archive["harness-policy-candidate.json"],
  );
  const release = {
    ...previous,
    version: 1,
    kind: "application-credentials-v1",
    sourceRevision: runtimeIdentity.sourceRevision,
    baseline: previous.candidate,
    baselineBuild: previous.build,
    baselineOperationId: "github-655515393-40804148983",
    removalBaseline: {
      deploymentId: "27d5bc36-0513-46fa-9d51-d1c14cad47dc",
      image: previous.candidate.image,
    },
    candidate: {
      image: JSON.parse(runner.archive["image-candidates.json"]).runner,
      runtimeIdentity,
    },
    build: runner.build,
    targetTemplateSha256: values["template-sha"],
    templateTransition: {
      kind: "application-credentials-v1",
      applicationBefore:
        "ghcr.io/copilotkit/rich-thread-application@sha256:6b6d757e8c5c605c384673a4e8418cd7cd275de2b8b068ebb21856a1032fc71d",
      applicationAfter: APPLICATION_IMAGE,
    },
    harness: {
      serviceId: HARNESS_SERVICE,
      baselineConfigSha256:
        "a44da66a6e3866cf30a0f1d93ddacad9168e344a22fc098aa4e12e53fe8dd3de",
      baseline: {
        deploymentId: "848cff51-2936-48e5-9671-09a7cd6ba552",
        image:
          "ghcr.io/copilotkit/showcase-harness@sha256:797a40e2f7d7ae1ef5a55210a2e5de407aa831eae9e9fc708a9964c2f4fe970a",
      },
      image: harnessIdentity.image,
      sourceRevision: harnessIdentity.sourceRevision,
      policySha256: APPLICATION_POLICY,
      build: harness.build,
    },
  };
  await verifyApplicationProvenance(release, github, process.env.GITHUB_TOKEN);
  const bytes = JSON.stringify(release, null, 2) + "\n";
  await writeFile(values.output, bytes, { flag: "wx", mode: 0o600 });
  console.log(
    JSON.stringify({
      path: values.output,
      sha256: sha256(bytes),
      deploymentAuthorized: false,
    }),
  );
}
main().catch(() => {
  console.error(
    "Release preparation refused; require successful reviewed candidate builds and exact template digest.",
  );
  process.exitCode = 1;
});
