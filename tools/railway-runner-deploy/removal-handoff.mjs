import { requireThat } from "./contract.mjs";

/** Independently prove removal before any configuration or replacement deployment. */
export async function verifyRemovedHandoff({
  railway,
  scope,
  baseline,
  configuredImages,
  clock = Date.now,
}) {
  const exactRemoved = (row) =>
    row?.id === baseline.deploymentId &&
    row.image === baseline.image &&
    row.status === "REMOVED";
  const old = await railway.readDeploymentStatus(baseline.deploymentId);
  requireThat(exactRemoved(old), "Original deployment has not been removed");
  const rows = await railway.handoffInventory();
  requireThat(
    Array.isArray(rows) &&
      rows.filter((row) => row.id === baseline.deploymentId).length === 1 &&
      rows.some(exactRemoved),
    "Handoff baseline inventory missing",
  );
  requireThat(
    rows.every((row) => row.status === "REMOVED"),
    "Competing deployment prevents handoff",
  );
  // Read after inventory so a newly active/latest competitor cannot cross this gate.
  const provider = await railway.inspect({
    allowNoActive: true,
    allowMissingLatest: true,
  });
  requireThat(
    provider.active === null &&
      (provider.latest === null || exactRemoved(provider.latest)) &&
      configuredImages.includes(provider.configuredImage),
    "Removed baseline configuration changed",
  );
  requireThat(
    ["volumeId", "volumeInstanceId", "mountPath"].every(
      (key) => provider[key] === scope[key],
    ) && provider.isPendingDeletion !== true,
    "Retained volume mismatch",
  );
  return {
    provider,
    removalProof: {
      version: 1,
      method: "deploymentRemove",
      deploymentId: baseline.deploymentId,
      status: "REMOVED",
      image: baseline.image,
      projectId: scope.projectId,
      environmentId: scope.environmentId,
      serviceId: scope.serviceId,
      volumeId: provider.volumeId,
      volumeInstanceId: provider.volumeInstanceId,
      mountPath: provider.mountPath,
      observedAt: new Date(clock()).toISOString(),
    },
  };
}
