// mirrors OPENBOX_COPILOTKIT_RESULT_SCHEMA_VERSION from @openbox-ai/openbox-sdk/copilotkit (not imported: that subpath is Node-only and breaks the client bundle)
const OPENBOX_COPILOTKIT_RESULT_SCHEMA_VERSION = "openbox.copilotkit.result.v1";
import type { GovernanceVerdict } from "./types";

/** Governed tool names that produce OpenBox result tool-messages. */
export const GOVERNED_TOOL_NAMES = [
  "openbox_governed_action",
  "openbox_governed_approval_action",
  "openbox_resume_governed_action",
] as const;

/** Local result-content parser (kept dependency-free so this module stays in the client bundle). Returns {} for any non-object input. */
export function parseFeedToolResult(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

/** True when a parsed record is an OpenBox CopilotKit result envelope. */
export function isOpenBoxResultRecord(
  record: Record<string, unknown>,
): boolean {
  return record.schemaVersion === OPENBOX_COPILOTKIT_RESULT_SCHEMA_VERSION;
}

/**
 * Adapted from the SDK-internal verdictFromResult (NOT exported by the SDK).
 * Maps a raw result envelope to the feed badge verdict; note `approval_pending`
 * is shown as `approval` (a pending-approval state), not `block`.
 */
export function verdictFromResultRecord(
  result: Record<string, unknown>,
): GovernanceVerdict {
  if (
    result.status === "approval_required" ||
    result.status === "approval_pending"
  )
    return "approval";
  if (result.status === "rejected") return "rejected";
  if (result.status === "error" || result.verdict === "error") return "error";
  if (result.status === "halted" || result.verdict === "halt") return "halt";
  if (result.status === "constrained" || result.verdict === "constrain")
    return "constrain";
  if (
    typeof result.redactionSummary === "string" &&
    result.redactionSummary.length > 0 &&
    (result.status === "executed" || result.verdict === "allow")
  ) {
    return "constrain";
  }
  if (result.status === "executed" || result.verdict === "allow")
    return "allow";
  if (result.status === "blocked" || result.verdict === "block") return "block";
  if (result.verdict === "require_approval") return "approval";
  return "reviewing";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Extract tool calls from an assistant message across the known shapes. */
export function extractToolCalls(
  message: Record<string, unknown>,
): Record<string, unknown>[] {
  if (Array.isArray(message.toolCalls)) return message.toolCalls.map(asRecord);
  if (Array.isArray(message.tool_calls))
    return message.tool_calls.map(asRecord);
  const additional = asRecord(message.additional_kwargs);
  if (Array.isArray(additional.tool_calls))
    return additional.tool_calls.map(asRecord);
  return [];
}

export function toolCallName(toolCall: Record<string, unknown>): string {
  const fn = asRecord(toolCall.function);
  return textValue(toolCall.name ?? fn.name);
}

/**
 * Mirror of the SDK-internal findOpenBoxResult (NOT exported by the SDK).
 * For a tool message returns its content; for an assistant message that
 * called a governed tool, resolves the matching tool message content from
 * the state snapshot by tool_call_id.
 */
export function findOpenBoxResultContent(
  message: Record<string, unknown>,
  stateSnapshot: unknown,
): string | null {
  const kind = textValue(message.role ?? message.type);
  if (kind === "tool") {
    const content = message.content;
    return typeof content === "string" ? content : null;
  }
  if (kind !== "assistant" && kind !== "ai") return null;
  const toolCalls = extractToolCalls(message);
  const governedIds = new Set(
    toolCalls
      .filter((tc) =>
        (GOVERNED_TOOL_NAMES as readonly string[]).includes(toolCallName(tc)),
      )
      .map((tc) => textValue(tc.id))
      .filter(Boolean),
  );
  if (governedIds.size === 0) return null;
  const snapshot = asRecord(stateSnapshot);
  const snapshotMessages = Array.isArray(snapshot.messages)
    ? snapshot.messages.map(asRecord)
    : [];
  const toolMessage = snapshotMessages.find((item) => {
    if (item.type !== "tool" && item.role !== "tool") return false;
    const toolCallId = textValue(item.tool_call_id ?? item.toolCallId);
    return Boolean(toolCallId) && governedIds.has(toolCallId);
  });
  const content = toolMessage?.content;
  return typeof content === "string" ? content : null;
}
