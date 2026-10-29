import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

export const HARNESS_SCOPE = Object.freeze({
  projectId: "6f8c6bff-a80d-4f8f-b78d-50b32bcf4479",
  environmentId: "8edfef02-ea09-4a20-8689-261f21cc2849",
  serviceId: "3a14bfed-0537-4d71-897b-7c593dca161d",
});
export const HARNESS_BASELINE = Object.freeze({
  id: "848cff51-2936-48e5-9671-09a7cd6ba552",
  image:
    "ghcr.io/copilotkit/showcase-harness@sha256:797a40e2f7d7ae1ef5a55210a2e5de407aa831eae9e9fc708a9964c2f4fe970a",
  status: "SUCCESS",
});

/**
 * Preparation library, never invoked on import. Caller binds reviewed config and
 * exact operation owner. journal.claim must durably create an exclusive claim;
 * journal.save must durably replace it before resolving. A retained incomplete
 * receipt is a recovery blocker, not permission to resend any mutation.
 * Provider calls MUST NOT retry mutations. setImage changes only source.image.
 * inspect reads LIVE config, staged patch, mounted volumes and deployment metadata.
 */
export async function rolloutHarnessPolicy({
  operationId,
  targetImage,
  baselineConfig,
  provider,
  journal,
  assertCandidateDrained,
  previousReceipt = /** @type {Record<string, unknown> | undefined} */ (
    undefined
  ),
  timeoutMs = 120_000,
}) {
  assert.match(operationId, /^github-655515393-\d+$/);
  assert.match(
    targetImage,
    /^ghcr\.io\/copilotkit\/showcase-harness@sha256:[a-f0-9]{64}$/,
  );
  assert.notEqual(targetImage, HARNESS_BASELINE.image);
  assert.equal(
    baselineConfig?.source?.image,
    "ghcr.io/copilotkit/showcase-harness:latest",
  );
  assert.equal(typeof assertCandidateDrained, "function");
  assert.equal(typeof journal.claim, "function");
  assert.equal(typeof journal.save, "function");
  assert.ok(
    Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 120_000,
  );
  const binding = {
    schemaVersion: 1,
    operationId,
    scope: HARNESS_SCOPE,
    baseline: HARNESS_BASELINE,
    baselineConfig,
    targetImage,
  };
  if (previousReceipt) {
    const { phase, deploymentId, ...previousBinding } = previousReceipt;
    assert.deepEqual(
      previousBinding,
      binding,
      "Harness rollout receipt binding differs",
    );
    assert.equal(
      phase,
      "verified",
      "Incomplete harness mutation receipt; do not resend, retain drain",
    );
    assert.match(deploymentId, /^[a-f0-9-]{36}$/);
  }
  const signal = AbortSignal.timeout(timeoutMs);
  async function bounded(fn) {
    signal.throwIfAborted();
    let listener;
    const aborted = new Promise((_, reject) => {
      listener = () =>
        reject(new Error("Harness rollout deadline; retain receipt and drain"));
      signal.addEventListener("abort", listener, { once: true });
    });
    try {
      return await Promise.race([Promise.resolve().then(fn), aborted]);
    } finally {
      signal.removeEventListener("abort", listener);
    }
  }
  const targetConfig = structuredClone(baselineConfig);
  targetConfig.source.image = targetImage;
  const guard = () => bounded(() => assertCandidateDrained(signal));
  async function inspect(config) {
    await guard();
    const state = await bounded(() => provider.inspect(HARNESS_SCOPE, signal));
    for (const [key, value] of Object.entries(HARNESS_SCOPE))
      assert.equal(state[key], value, "Harness scope differs");
    assert.equal(
      state.staged,
      null,
      "Staged harness/environment changes must be resolved separately",
    );
    assert.deepEqual(state.volumes, [], "Harness volume inventory changed");
    assert.deepEqual(state.config, config, "Harness configuration changed");
    return state.latestDeployment;
  }
  let deploymentId = previousReceipt?.deploymentId;
  if (!previousReceipt) {
    assert.deepEqual(
      await inspect(baselineConfig),
      HARNESS_BASELINE,
      "Harness baseline drifted",
    );
    // claim is exclusive across repeated invocations and includes full reviewed binding.
    await bounded(() =>
      journal.claim({ ...binding, phase: "source-requested" }),
    );
    await guard();
    assert.equal(
      await bounded(() =>
        provider.setImage(HARNESS_SCOPE, targetImage, signal),
      ),
      true,
      "Harness source update unconfirmed; do not resend",
    );
    assert.deepEqual(
      await inspect(targetConfig),
      HARNESS_BASELINE,
      "Unexpected automatic deployment; stop before explicit deploy",
    );
    await bounded(() =>
      journal.save({ ...binding, phase: "deploy-requested" }),
    );
    await guard();
    deploymentId = await bounded(() => provider.deploy(HARNESS_SCOPE, signal));
    assert.match(deploymentId, /^[a-f0-9-]{36}$/);
    assert.notEqual(
      deploymentId,
      HARNESS_BASELINE.id,
      "Provider returned baseline deployment",
    );
    await bounded(() =>
      journal.save({ ...binding, phase: "deploy-acknowledged", deploymentId }),
    );
  }
  while (true) {
    const deployed = await inspect(targetConfig);
    assert.equal(
      deployed.id,
      deploymentId,
      "Different harness deployment became latest",
    );
    if (deployed.status === "SUCCESS" || deployed.image != null)
      assert.equal(
        deployed.image,
        targetImage,
        "Harness deployment image differs",
      );
    if (deployed.status === "SUCCESS") {
      await guard();
      const result = { ...binding, phase: "verified", deploymentId };
      if (!previousReceipt) await bounded(() => journal.save(result));
      return result;
    }
    assert.ok(
      ["WAITING", "QUEUED", "INITIALIZING", "BUILDING", "DEPLOYING"].includes(
        deployed.status,
      ),
      "Harness deployment failed or requires intervention",
    );
    await bounded(() => delay(1000, undefined, { signal }));
  }
}
