import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  validateApplicationRelease,
  APPLICATION_IMAGE,
  APPLICATION_POLICY,
  APPLICATION_RUNTIME,
  APPLICATION_RUNNER_IMAGE,
  APPLICATION_BUILD,
  HARNESS_SERVICE,
} from "./application-release.mjs";
import {
  verifyApplicationImage,
  verifyApplicationProvenance,
} from "./application-provenance.mjs";
import { sha256 } from "./contract.mjs";

async function release() {
  const old = JSON.parse(
    await readFile(new URL("./releases/browser-upgrade.json", import.meta.url)),
  );
  return {
    ...old,
    version: 1,
    kind: "application-credentials-v1",
    baseline: old.candidate,
    baselineBuild: old.build,
    removalBaseline: {
      deploymentId: "27d5bc36-0513-46fa-9d51-d1c14cad47dc",
      image: old.candidate.image,
    },
    baselineOperationId: "github-655515393-40804148983",
    targetTemplateSha256: "5".repeat(64),
    sourceRevision: APPLICATION_RUNTIME.sourceRevision,
    build: { ...APPLICATION_BUILD },
    candidate: {
      image: APPLICATION_RUNNER_IMAGE,
      runtimeIdentity: { ...APPLICATION_RUNTIME },
    },
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
      image: `ghcr.io/copilotkit/showcase-harness@sha256:${"c".repeat(64)}`,
      policySha256: APPLICATION_POLICY,
      sourceRevision: "a".repeat(40),
      build: { runId: 1, workflowSha256: "d".repeat(64) },
    },
  };
}
test("release rejects missing build pins and any unreviewed baseline, policy or service", async () => {
  validateApplicationRelease(await release());
  for (const mutate of [
    (value) => {
      value.candidate = null;
    },
    (value) => {
      value.harness.image = "ghcr.io/copilotkit/showcase-harness:latest";
    },
    (value) => {
      value.harness.serviceId = "other";
    },
    (value) => {
      value.harness.baseline.deploymentId = "other";
    },
    (value) => {
      value.candidate.runtimeIdentity.policySha256 =
        value.baseline.runtimeIdentity.policySha256;
    },
    (value) => {
      value.removalBaseline.deploymentId = "same-image-but-other-deployment";
    },
    (value) => {
      value.templateTransition.applicationAfter =
        value.templateTransition.applicationBefore;
    },
  ]) {
    const value = await release();
    mutate(value);
    assert.throws(() => validateApplicationRelease(value));
  }
});
test("provenance refuses an image absent from the ordinary gate before external reads", async () => {
  let calls = 0;
  const github = new Proxy(
    {},
    {
      get() {
        calls++;
        throw new Error("External read attempted");
      },
    },
  );
  await assert.rejects(
    verifyApplicationProvenance(await release(), github, "test-only"),
    /Ordinary image gate is not bound to the reviewed harness candidate/,
  );
  assert.equal(calls, 0);
});
test("application image verifier refuses foreign repositories before authentication", async () => {
  let calls = 0;
  await assert.rejects(
    verifyApplicationImage(`ghcr.io/foreign/image@sha256:${"a".repeat(64)}`, {
      token: "test-only",
      fetch: async () => {
        calls++;
      },
    }),
  );
  assert.equal(calls, 0);
});
test("application image verifier binds manifest bytes and uses authenticated fixed GHCR endpoints", async () => {
  const bytes = Buffer.from("reviewed-manifest"),
    calls = [];
  const image = `ghcr.io/copilotkit/showcase-harness@sha256:${sha256(bytes)}`;
  const fetch = async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1
      ? new Response(JSON.stringify({ token: "test-access" }))
      : new Response(bytes);
  };
  await verifyApplicationImage(image, { token: "test-only", fetch });
  assert.equal(calls.length, 2);
  assert.ok(
    calls.every(
      (call) =>
        new URL(call.url).hostname === "ghcr.io" &&
        call.options.redirect === "error",
    ),
  );
  await assert.rejects(
    verifyApplicationImage(image, {
      token: "test-only",
      fetch: async (url) =>
        new Response(
          url.includes("/token?")
            ? JSON.stringify({ token: "test" })
            : "different-manifest",
        ),
    }),
    /digest mismatch/,
  );
});
test("coordinated workflow exposes deployment only on main dispatch and build workflow has no Railway capability", async () => {
  const workflow = await readFile(
    new URL(
      "../../.github/workflows/intelligence-application-upgrade.yml",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    workflow,
    /github\.event_name == 'workflow_dispatch' && github\.repository == 'CopilotKit\/CopilotKit' && github\.ref == 'refs\/heads\/main'/,
  );
  assert.match(workflow, /group: intelligence-runner-staging-deploy/);
  assert.match(workflow, /application-upgrade-cli\.mjs --execute/);
  const build = await readFile(
    new URL(
      "../../.github/workflows/intelligence-harness-policy-build.yml",
      import.meta.url,
    ),
    "utf8",
  );
  assert.doesNotMatch(
    build,
    /RAILWAY_TOKEN|RICH_RUNNER_TOKEN|railway deploy|railway up|serviceInstanceDeploy/,
  );
  for (const value of [
    ...workflow.matchAll(/uses: [^\s]+@([^\s]+)/g),
    ...build.matchAll(/uses: [^\s]+@([^\s]+)/g),
  ])
    assert.match(value[1], /^[a-f0-9]{40}$/);
});
