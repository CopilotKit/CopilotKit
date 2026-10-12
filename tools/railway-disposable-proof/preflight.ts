/** Offline prerequisites only. Never authorizes provisioning or contacts Railway. */
import { execFileSync } from "node:child_process";
import { DISPOSABLE_LIFECYCLE_POLICY } from "../../showcase/scripts/railway-envs";
import {
  parseRailwayLifecyclePolicy,
  parseRunRecordsSnapshot,
} from "../../showcase/harness/src/shared/railway-lifecycle";
const policy = parseRailwayLifecyclePolicy(DISPOSABLE_LIFECYCLE_POLICY);
if (!policy.ok) throw new Error(policy.issues.map((i) => i.code).join(","));
const snapshot = parseRunRecordsSnapshot(
  { schemaVersion: 1, runs: [] },
  policy.value,
  new Date(),
);
if (!snapshot.ok) throw new Error(snapshot.issues.map((i) => i.code).join(","));
const blocked = policy.value.approvedImages.length === 0;
console.log(
  JSON.stringify(
    {
      revision: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      recordedAt: new Date().toISOString(),
      evidenceKind: "offline-committed-policy-check",
      approvedImageCount: policy.value.approvedImages.length,
      emptySnapshotAccepted: true,
      liveAcceptance: "NOT_RUN",
      resourcesCreated: [],
      verdict: blocked
        ? "BLOCKED_NO_APPROVED_IMAGES"
        : "REQUIRES_DEPLOYED_CONSUMERS_AND_PROVIDER_VERIFICATION",
    },
    null,
    2,
  ),
);
process.exitCode = blocked ? 2 : 0;
