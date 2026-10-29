import assert from "node:assert/strict";
import {
  prepareApplicationTemplate,
  templateSha256,
} from "./template-transition.mjs";
import { validateIdentity, IMAGE } from "./contract.mjs";

export const APPLICATION_RUNNER_IMAGE =
  "ghcr.io/copilotkit/rich-thread-runner@sha256:dc57bd8e200627bff7e08462355bd3a523831263d20ff364850f1d92c4d2c2f2";
export const APPLICATION_BUILD = Object.freeze({
  runId: 40866670319,
  runAttempt: 1,
  workflowPath: ".github/workflows/intelligence-rich-threads-build.yml",
  workflowSha256:
    "4337e0e43f7598ff19171ad3a73a250e404e7a8e138ae149cb30e75bda6224bf",
  artifactId: 12894546840,
  artifactSha256:
    "76b87f53e4d30708854de26529eb0f5d8e119df5c9aea9a07d9b963e2cfb11c4",
});
export const APPLICATION_IMAGE =
  "ghcr.io/copilotkit/rich-thread-application@sha256:5ccbaec60d1faf55333dbdebb2a8043bfbbd967d48adb85d3bc618fd4f02a862";
export const APPLICATION_POLICY =
  "818e0ac6b3bef851f39c44a109cdc529cc98da104aeedce8ac84f66db543ff22";
export const APPLICATION_BASELINE_POLICY =
  "4ded223bb02ea0cdf7ffed4fb8f78b70fbb50c9f74ae82d34addfc94f712c751";
export const APPLICATION_RUNTIME = Object.freeze({
  protocolVersion: 1,
  sourceRevision: "f50337ab5e3411953667fd077e2dca14c381ca11",
  sourceManifestSha256:
    "c96dc9ba6c5aac1b72c278781bafa2ee413fb281f21c9b69a901fd22d0ba548a",
  compatibilitySha256:
    "9793eca34f9c6c6df32697da80ffd661d7bfa764087eb1fc5fab35fda4d37014",
  policySha256:
    "818e0ac6b3bef851f39c44a109cdc529cc98da104aeedce8ac84f66db543ff22",
});
export const HARNESS_SERVICE = "3a14bfed-0537-4d71-897b-7c593dca161d";

/** A release file must bind real built images; missing future pins are never defaults. */
export function validateApplicationRelease(intent) {
  assert.equal(intent.version, 1);
  assert.equal(intent.kind, "application-credentials-v1");
  assert.equal(
    intent.baseline.runtimeIdentity.sourceRevision,
    "a918ae011663c426a426243bcbc6c183f52f8d97",
  );
  assert.equal(
    intent.baseline.image,
    "ghcr.io/copilotkit/rich-thread-runner@sha256:0130216d2378373b0c98f55669ca1c9e0299f0f26e468c39261511e30793b4df",
  );
  assert.equal(
    intent.removalBaseline.deploymentId,
    "27d5bc36-0513-46fa-9d51-d1c14cad47dc",
  );
  assert.equal(intent.removalBaseline.image, intent.baseline.image);
  assert.equal(intent.baselineOperationId, "github-655515393-40804148983");
  assert.equal(
    intent.baselineTemplateSha256,
    "020fbeb669a5a0fa0d3da5f120348770721a2c2f9c4e997bccae01792c6a8020",
  );
  assert.match(intent.targetTemplateSha256, /^[a-f0-9]{64}$/);
  assert.notEqual(intent.targetTemplateSha256, intent.baselineTemplateSha256);
  for (const item of [intent.baseline, intent.candidate]) {
    assert.match(item.image, IMAGE);
    validateIdentity(item.runtimeIdentity);
  }
  assert.equal(
    intent.baseline.runtimeIdentity.policySha256,
    APPLICATION_BASELINE_POLICY,
  );
  assert.equal(
    intent.candidate.runtimeIdentity.policySha256,
    APPLICATION_POLICY,
  );
  assert.equal(
    intent.sourceRevision,
    intent.candidate.runtimeIdentity.sourceRevision,
  );
  assert.deepEqual(
    intent.candidate.runtimeIdentity,
    APPLICATION_RUNTIME,
    "Unreviewed application runtime",
  );
  assert.deepEqual(intent.build, APPLICATION_BUILD);
  assert.equal(intent.candidate.image, APPLICATION_RUNNER_IMAGE);
  assert.deepEqual(intent.templateTransition, {
    kind: "application-credentials-v1",
    applicationBefore:
      "ghcr.io/copilotkit/rich-thread-application@sha256:6b6d757e8c5c605c384673a4e8418cd7cd275de2b8b068ebb21856a1032fc71d",
    applicationAfter: APPLICATION_IMAGE,
  });
  assert.equal(intent.harness.serviceId, HARNESS_SERVICE);
  assert.equal(
    intent.harness.baselineConfigSha256,
    "a44da66a6e3866cf30a0f1d93ddacad9168e344a22fc098aa4e12e53fe8dd3de",
  );
  assert.equal(
    intent.harness.baseline.deploymentId,
    "848cff51-2936-48e5-9671-09a7cd6ba552",
  );
  assert.equal(
    intent.harness.baseline.image,
    "ghcr.io/copilotkit/showcase-harness@sha256:797a40e2f7d7ae1ef5a55210a2e5de407aa831eae9e9fc708a9964c2f4fe970a",
  );
  assert.match(
    intent.harness.image,
    /^ghcr\.io\/copilotkit\/showcase-harness@sha256:[a-f0-9]{64}$/,
  );
  assert.notEqual(intent.harness.image, intent.harness.baseline.image);
  assert.equal(intent.harness.policySha256, APPLICATION_POLICY);
  assert.match(intent.harness.sourceRevision, /^[a-f0-9]{40}$/);
  assert.match(intent.harness.build.workflowSha256, /^[a-f0-9]{64}$/);
  assert.ok(
    Number.isSafeInteger(intent.harness.build.runId) &&
      intent.harness.build.runId > 0,
  );
}

/** Resolve once and keep only in memory for this single attempt. Never refresh during replay. */
export function freezeApplicationTemplate(intent, variables) {
  validateApplicationRelease(intent);
  const baseline = JSON.parse(variables.RICH_TEMPLATE_JSON);
  const { template, receipt } = prepareApplicationTemplate({
    baseline,
    baselineSha256: intent.baselineTemplateSha256,
    applicationBefore: intent.templateTransition.applicationBefore,
    applicationAfter: intent.templateTransition.applicationAfter,
    credential: variables.OPENAI_API_KEY,
  });
  assert.equal(
    receipt.targetTemplateSha256,
    intent.targetTemplateSha256,
    "Resolved credential or reviewed template changed",
  );
  const bytes = JSON.stringify(template);
  const credential = variables.OPENAI_API_KEY;
  return {
    receipt,
    bytes,
    verify(currentVariables) {
      if (currentVariables) {
        assert.equal(
          templateSha256(JSON.parse(currentVariables.RICH_TEMPLATE_JSON)),
          intent.baselineTemplateSha256,
          "Configured baseline changed",
        );
        assert.ok(
          currentVariables.OPENAI_API_KEY === credential,
          "Referenced credential changed",
        );
      }
      assert.equal(
        templateSha256(JSON.parse(bytes)),
        intent.targetTemplateSha256,
        "Frozen candidate changed",
      );
    },
  };
}
