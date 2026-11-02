import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

export const STAGING = Object.freeze({
  projectId: "6f8c6bff-a80d-4f8f-b78d-50b32bcf4479",
  environmentId: "8edfef02-ea09-4a20-8689-261f21cc2849",
  serviceId: "4922b45b-6981-4559-be2f-fbbca9123323",
  instanceId: "f96bf2d4-f4f0-41b6-a7e9-547f33c38961",
  volumeId: "2a70e47d-85d4-4a8a-b17b-b6788c91b1c7",
  volumeInstanceId: "f3187181-2fb7-4d3e-a9dc-c80eac894895",
  mountPath: "/data",
});
export const RUNNER_URL =
  "https://showcase-intelligence-test-runner-staging.up.railway.app";
export const POLICY =
  "7eb39aa628b77c30efa88a00c4ad0695de89ac2bb919e7e25f550a4ab2f2c765";
const approvedPolicies = new Set([
  POLICY,
  "4ded223bb02ea0cdf7ffed4fb8f78b70fbb50c9f74ae82d34addfc94f712c751",
]);
export const REPOSITORY = "CopilotKit/CopilotKit";
export const REPOSITORY_ID = 655515393;
export const BUILD_WORKFLOW =
  ".github/workflows/intelligence-rich-threads-build.yml";
export const DEPLOY_WORKFLOW =
  ".github/workflows/intelligence-rich-threads-deploy.yml";
export const DEV_DEPLOY_WORKFLOW =
  ".github/workflows/intelligence-rich-threads-dev.yml";
export const IMAGE =
  /^ghcr\.io\/copilotkit\/rich-thread-runner@sha256:[a-f0-9]{64}$/;
export const SHA256 = /^[a-f0-9]{64}$/;
export const REVISION = /^[a-f0-9]{40}$/;
/** Throw a constant message so remote response data never enters logs. */
export function requireThat(condition, message = "Deployment proof rejected") {
  if (!condition) throw new Error(message);
}
/** Hash exact bytes, not parsed/reserialized artifact contents. */
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
/** Compare complete JSON identities independent of key order. */
export const equal = isDeepStrictEqual;
/** Validate all fields of the immutable runner identity. */
export function validateIdentity(value) {
  requireThat(
    value &&
      equal(
        Object.keys(value).sort(),
        [
          "protocolVersion",
          "sourceRevision",
          "sourceManifestSha256",
          "compatibilitySha256",
          "policySha256",
        ].sort(),
      ),
    "Invalid runtime identity",
  );
  requireThat(
    value.protocolVersion === 1 &&
      REVISION.test(value.sourceRevision) &&
      SHA256.test(value.sourceManifestSha256) &&
      SHA256.test(value.compatibilitySha256) &&
      approvedPolicies.has(value.policySha256),
    "Invalid runtime identity",
  );
}
/** Restrict ordinary updates to scenario/assertion changes with the same cleanup policy. */
export function compatible(baseline, candidate) {
  validateIdentity(baseline);
  validateIdentity(candidate);
  requireThat(
    baseline.compatibilitySha256 === candidate.compatibilitySha256 &&
      baseline.policySha256 === candidate.policySha256,
    "Incompatible runner update",
  );
}
/** Check the fixed retained volume after every provider transition. */
export function validateVolume(state) {
  for (const key of ["volumeId", "volumeInstanceId", "mountPath"])
    requireThat(state[key] === STAGING[key], "Staging volume mismatch");
}
