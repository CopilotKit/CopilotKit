/** A saved approval without a native execution result. */
interface ApprovalDecision {
  requestId: string;
  toolCallId: string;
  approved: boolean;
  status: "waiting";
}

/** A native saved-head decision projection, or an explicit unavailable marker. */
export type ApprovalDecisions =
  | { version: 1; decisions: ApprovalDecision[] }
  | { error: true };

/** Accept only JSON object-shaped records at the custom event boundary. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Validate cpki.approval_decisions v1 without adding a runtime schema dependency. */
export function parseApprovalDecisions(value: unknown): ApprovalDecisions {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !Array.isArray(value.decisions)
  )
    return { error: true };
  const decisions: ApprovalDecision[] = [];
  const requests = new Set<string>();
  const calls = new Set<string>();
  for (const item of value.decisions) {
    if (
      !isRecord(item) ||
      typeof item.requestId !== "string" ||
      !item.requestId ||
      typeof item.toolCallId !== "string" ||
      !item.toolCallId ||
      typeof item.approved !== "boolean" ||
      item.status !== "waiting" ||
      requests.has(item.requestId) ||
      calls.has(item.toolCallId)
    )
      return { error: true };
    requests.add(item.requestId);
    calls.add(item.toolCallId);
    decisions.push({
      requestId: item.requestId,
      toolCallId: item.toolCallId,
      approved: item.approved,
      status: "waiting",
    });
  }
  return { version: 1, decisions };
}
