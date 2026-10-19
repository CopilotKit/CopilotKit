import {
  equal,
  requireThat,
  validateIdentity,
  sha256,
  STAGING,
  POLICY,
} from "./contract.mjs";

export const SECOND_BASELINE = Object.freeze({
  image:
    "ghcr.io/copilotkit/rich-thread-runner@sha256:8db845b5d2b427317524254ff58b3e18db69046b9e75d950b6dc967c004a0019",
  runtimeIdentity: {
    protocolVersion: 1,
    sourceRevision: "d979e36a7950633baf557b22003f82c8dfaf865d",
    sourceManifestSha256:
      "3d8ef61c2d350551ea98d3bc5578dc8e50c57bbfa15d19a507830036c8ebb03a",
    compatibilitySha256:
      "aab9a65e46977db4bbe2cef4f6dd7303f8a0160ec0668198f6a8998e254f5121",
    policySha256: POLICY,
  },
});
export const SECOND_TEMPLATE =
  "ba76d57e7311faf9b9cb988851b23f34ad1e17285bdd2208e3680fdf527a03c9";
export const ORIGINAL_WATCH = Object.freeze({
  operationId: "github-655515393-39238052933",
  lifecycleRunId: "rich-f091f87b-e90b-4dd1-bef2-6ae873a774a3",
  runnerRunId: "run-7d05705a-0b83-4cdb-9d32-9f054ae24d11",
  oldJournalSha256:
    "7e9f0ef079ce1c504d6614623413f95ac2908bef009b33a77aec1fbad4d17025",
});
export const SECOND_RECOVERY = Object.freeze({
  version: 2,
  kind: "bounded-environment-retry",
  projectId: STAGING.projectId,
  runnerRunId: "run-7d2602d4-8b10-40b9-aaff-3c6a0029afad",
  lifecycleRunId: "rich-f6c38ef4-145e-44d0-8075-1e56e5818fe5",
  sourceEnvironmentId: "f15bc318-d863-4d1d-9717-74d2aeaed0c8",
  journalSha256:
    "4ee64b72b1264639e80b24c62bebdd265bca9613e96158b20ae0592c0157ba5e",
  intentSha256:
    "c15014aaba7dc2c7844a574bfee62e22fd9cc063af319d6e58615f9a7c13f3d2",
  leaseSha256:
    "3ea5195c1704ba358daf5af0eecab04a423f4c759dfa7c8e0426ee910894a3b0",
  originalWatchSha256:
    "6f0ab4d064ed5f58785c54e21ca88d068466763b7e4e8b8d5a90619e11180451",
  deploymentOperationSha256:
    "77d96842e4a124abf5fc961ea3cfdaf876facfed1227d4ac8e128f190510b2bd",
  decision: {
    reference: "ran-2026-10-19-second-incident-recovery",
    text: "They need to make a new request. When they receive response of whatever, they use CLI to verify that the env is there.",
  },
  permanentRunner: {
    projectId: STAGING.projectId,
    environmentId: STAGING.environmentId,
    serviceId: STAGING.serviceId,
    volumeId: STAGING.volumeId,
  },
  providerHandoff: {
    deploymentId: "41d9b023-1870-444f-8889-c369e26faa54",
    imageDigest: SECOND_BASELINE.image.split("@")[1],
    volumeInstanceId: STAGING.volumeInstanceId,
    deploymentStopped: true,
  },
});

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
export const bindingDigest = (value) =>
  sha256(JSON.stringify(canonical(value)));
export function originalWatchBinding(value) {
  return Object.fromEntries(
    Object.keys(ORIGINAL_WATCH).map((key) => [key, value?.[key]]),
  );
}
export function operationBinding(value) {
  return Object.fromEntries(
    [
      "version",
      "kind",
      "operationId",
      "baselineIdentity",
      "targetIdentity",
      "templateSha256",
      "status",
    ].map((key) => [key, value?.[key]]),
  );
}
export function validateSecondRecovery(recovery, baseline, candidate) {
  requireThat(
    equal(recovery, SECOND_RECOVERY),
    "Unknown second recovery authorization",
  );
  requireThat(
    equal(baseline, SECOND_BASELINE),
    "Second recovery baseline mismatch",
  );
  validateIdentity(candidate.runtimeIdentity);
  requireThat(
    candidate.image !== baseline.image &&
      candidate.runtimeIdentity.sourceRevision !==
        baseline.runtimeIdentity.sourceRevision,
    "New second recovery candidate required",
  );
}
export function secondRecoveryAuthorization(release, operationId) {
  validateSecondRecovery(release.recovery, release.baseline, release.candidate);
  requireThat(
    /^github-655515393-\d+$/.test(operationId),
    "Invalid recovery owner",
  );
  return {
    ...release.recovery,
    operationId,
    baselineIdentity: release.baseline.runtimeIdentity,
    targetIdentity: release.candidate.runtimeIdentity,
    templateSha256: SECOND_TEMPLATE,
  };
}
