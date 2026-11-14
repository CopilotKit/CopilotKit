import { equal, requireThat, STAGING, validateIdentity } from "./contract.mjs";

export const RECOVERY_BASELINE_IMAGE =
  "ghcr.io/copilotkit/rich-thread-runner@sha256:984f616acffebca0c393a54294b4366a33214221782a7192b4761bb84325e79d";

// This exception is one reviewed incident, not a general force-deploy switch.
export const BOUNDED_RECOVERY = Object.freeze({
  version: 1,
  kind: "bounded-environment-retry",
  projectId: STAGING.projectId,
  runnerRunId: "run-7d05705a-0b83-4cdb-9d32-9f054ae24d11",
  lifecycleRunId: "rich-f091f87b-e90b-4dd1-bef2-6ae873a774a3",
  intentSha256:
    "25ad2b74a34b749e7be7b7ad88d3c39e115717f1e48cd6fe2d0e7deb0280a406",
  leaseSha256:
    "976bd18df0558dfcdd515a87169b761ca2c3c36eb58f2928b89f6fbe8f4b5787",
  decision: {
    reference: "ran-2026-10-16-bounded-cli-retry",
    text: "They need to make a new request. When they receive response of whatever, they use CLI to verify that the env is there.",
  },
  permanentRunner: {
    projectId: STAGING.projectId,
    environmentId: STAGING.environmentId,
    serviceId: STAGING.serviceId,
    volumeId: STAGING.volumeId,
  },
});

export function validateRecovery(recovery, baseline, candidate) {
  requireThat(
    equal(recovery, BOUNDED_RECOVERY),
    "Unknown recovery authorization",
  );
  validateIdentity(baseline);
  validateIdentity(candidate);
  requireThat(
    baseline.sourceRevision === "1c9f51ca5d3180079e5a43369a3bb7573d46d806" &&
      baseline.sourceManifestSha256 ===
        "42f3f61c34d61f81948c66136cab2b784ed09822e1bf2a355049513ee45e7403" &&
      baseline.compatibilitySha256 ===
        "423d1f8af5c05530e4d31feba1d0f1c7ad0a215e52fa0748aee1690d5191a74a" &&
      baseline.policySha256 === candidate.policySha256 &&
      candidate.sourceRevision !== baseline.sourceRevision,
    "Recovery baseline or policy mismatch",
  );
}

export function recoveryAuthorization(release, operationId, templateSha256) {
  validateRecovery(
    release.recovery,
    release.baseline.runtimeIdentity,
    release.candidate.runtimeIdentity,
  );
  return {
    ...release.recovery,
    operationId,
    baselineIdentity: release.baseline.runtimeIdentity,
    targetIdentity: release.candidate.runtimeIdentity,
    templateSha256,
  };
}
