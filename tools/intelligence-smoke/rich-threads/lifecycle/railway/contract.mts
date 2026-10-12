import { createRequire } from "node:module";
// Registry and publisher live in the repository's CJS package; use one module instance.
// The command must enable tsx so their original TypeScript remains the source of truth.
const require = createRequire(import.meta.url);
export const policy =
  require("../../../../../showcase/scripts/railway-envs.ts").DISPOSABLE_LIFECYCLE_POLICY;
export const {
  parseRunRecordsSnapshot,
  parseRailwayLifecyclePolicy,
} = require("../../../../../showcase/harness/src/shared/railway-lifecycle.ts");
export const {
  publishSnapshot,
} = require("../../../../railway-disposable-proof/snapshot-publisher.ts");
