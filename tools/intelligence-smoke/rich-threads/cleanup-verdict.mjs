const retentionMs = 48 * 60 * 60 * 1000;
const text = (value) => typeof value === "string" && value.length > 0;
const timestamp = (value) =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

/** Validate exported cleanup evidence without treating provider retention as absence. */
export function activeCleanupVerified(cleanup) {
  if (
    !cleanup ||
    cleanup.activeResourcesAbsent !== true ||
    cleanup.deadlineExceeded !== false ||
    !timestamp(cleanup.verifiedAt) ||
    !Array.isArray(cleanup.retainedVolumes)
  )
    return false;
  if (
    cleanup.retentionReconciledAt !== undefined &&
    (!timestamp(cleanup.retentionReconciledAt) ||
      Date.parse(cleanup.retentionReconciledAt) <
        Date.parse(cleanup.verifiedAt))
  )
    return false;
  if (cleanup.status === "passed")
    return (
      cleanup.physicalDeletionComplete === true &&
      cleanup.retainedVolumes.length === 0
    );
  if (
    cleanup.status !== "passed-pending-provider-deletion" ||
    cleanup.physicalDeletionComplete !== false ||
    cleanup.retainedVolumes.length === 0
  )
    return false;
  if (
    new Set(cleanup.retainedVolumes.map((item) => item?.volumeId)).size !==
    cleanup.retainedVolumes.length
  )
    return false;
  return cleanup.retainedVolumes.every((item) => {
    if (
      !item ||
      ![
        "volumeId",
        "projectId",
        "environmentId",
        "serviceId",
        "mountPath",
      ].every((key) => text(item[key])) ||
      !timestamp(item.firstVerifiedAt) ||
      !timestamp(item.retentionDeadlineAt) ||
      item.overdue !== false
    )
      return false;
    const first = Date.parse(item.firstVerifiedAt);
    const deadline = Date.parse(item.retentionDeadlineAt);
    const verified = Date.parse(cleanup.verifiedAt);
    const latest = Date.parse(
      cleanup.retentionReconciledAt ?? cleanup.verifiedAt,
    );
    if (
      deadline - first !== retentionMs ||
      verified < first ||
      latest >= deadline
    )
      return false;
    const { receipt, evidence } = item;
    if (
      !receipt ||
      receipt.requestSent !== true ||
      !evidence ||
      !["volumeId", "projectId", "environmentId"].every(
        (key) => receipt[key] === item[key] && evidence[key] === item[key],
      ) ||
      !timestamp(receipt.startedAt) ||
      Date.parse(receipt.startedAt) > first ||
      !["acknowledged", "unknown", "pending"].includes(receipt.outcome) ||
      receipt.response === false
    )
      return false;
    if (
      receipt.outcome === "acknowledged" &&
      (receipt.response !== true ||
        !timestamp(receipt.returnedAt) ||
        Date.parse(receipt.returnedAt) < Date.parse(receipt.startedAt) ||
        Date.parse(receipt.returnedAt) > verified)
    )
      return false;
    if (
      evidence.state !== "pending-detached" ||
      evidence.inventoryComplete !== true ||
      !timestamp(evidence.observedAt) ||
      Date.parse(evidence.observedAt) < first ||
      Date.parse(evidence.observedAt) > latest ||
      !Array.isArray(evidence.instances) ||
      evidence.instances.length === 0 ||
      !Array.isArray(evidence.environmentReferences) ||
      !Array.isArray(evidence.inspectedEnvironmentIds) ||
      !evidence.inspectedEnvironmentIds.every(text)
    )
      return false;
    const detached = (instance) =>
      instance &&
      text(instance.id) &&
      instance.volumeId === item.volumeId &&
      instance.environmentId === item.environmentId &&
      instance.mountPath === item.mountPath &&
      instance.serviceId === null &&
      instance.isPendingDeletion === true;
    return (
      evidence.instances.every(detached) &&
      evidence.environmentReferences.every(
        (instance) =>
          detached(instance) &&
          evidence.inspectedEnvironmentIds.includes(instance.environmentId),
      )
    );
  });
}

/** The report status and its full evidence must agree; a marker alone cannot pass. */
export function reportCleanupVerified(report) {
  if (Array.isArray(report?.cleanupEvidence)) {
    const items = report.cleanupEvidence;
    if (
      !items.length ||
      !items.every(
        (item) => text(item?.runId) && activeCleanupVerified(item),
      ) ||
      new Set(items.map((item) => item.runId)).size !== items.length
    )
      return false;
    const status = items.some((item) => !item.physicalDeletionComplete)
      ? "passed-pending-provider-deletion"
      : "passed";
    return report.cleanup === status;
  }
  return (
    report?.cleanup === report?.cleanupEvidence?.status &&
    activeCleanupVerified(report?.cleanupEvidence)
  );
}
