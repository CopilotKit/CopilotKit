/** Non-terminal Railway deployment states shared by deployment verification. */
export const IN_PROGRESS_DEPLOY_STATUSES: ReadonlySet<string> = new Set([
  "QUEUED",
  "BUILDING",
  "INITIALIZING",
  "DEPLOYING",
  "WAITING",
  "NEEDS_APPROVAL",
]);
