import { EventType } from "@ag-ui/client";
import type {
  ActivitySnapshotEvent,
  BaseEvent,
  ToolCallResultEvent,
} from "@ag-ui/client";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Restore only the public activity saved by MCP Apps middleware in a result.
 * No tool discovery, execution, resource fetching, or server configuration is
 * needed. Legacy text-only results cannot recover missing app context.
 */
function readActivity(content: string): ActivitySnapshotEvent | undefined {
  let envelope: unknown;
  try {
    envelope = JSON.parse(content);
  } catch {
    return undefined;
  }
  if (
    !isRecord(envelope) ||
    envelope.type !== "ag-ui:mcp-app-result" ||
    envelope.version !== 1
  )
    return;
  const activity = envelope.activity;
  if (
    !isRecord(activity) ||
    typeof activity.messageId !== "string" ||
    !activity.messageId
  )
    return;
  const data = activity.content;
  if (
    !isRecord(data) ||
    typeof data.resourceUri !== "string" ||
    !data.resourceUri ||
    typeof data.serverHash !== "string" ||
    !data.serverHash ||
    (data.serverId !== undefined && typeof data.serverId !== "string") ||
    !isRecord(data.result) ||
    !Array.isArray(data.result.content) ||
    !isRecord(data.toolInput)
  )
    return;
  return {
    type: EventType.ACTIVITY_SNAPSHOT,
    messageId: activity.messageId,
    activityType: "mcp-apps",
    // Allowlist routing fields: importing a result does not grant authority to
    // supply server URLs, credentials, or a cached resource to the renderer.
    content: {
      result: data.result,
      resourceUri: data.resourceUri,
      serverHash: data.serverHash,
      ...(data.serverId !== undefined ? { serverId: data.serverId } : {}),
      toolInput: data.toolInput,
    },
    replace: true,
  };
}

/** @internal Idempotently project saved MCP activities without changing results. */
export function restoreMCPAppsActivities(
  events: readonly BaseEvent[],
): BaseEvent[] {
  const activityIds = new Set(
    events.flatMap((event) =>
      event.type === EventType.ACTIVITY_SNAPSHOT
        ? [(event as ActivitySnapshotEvent).messageId]
        : [],
    ),
  );
  return events.flatMap((event) => {
    if (event.type !== EventType.TOOL_CALL_RESULT) return [event];
    const content = (event as ToolCallResultEvent).content;
    if (typeof content !== "string") return [event];
    const activity = readActivity(content);
    if (!activity || activityIds.has(activity.messageId)) return [event];
    activityIds.add(activity.messageId);
    return [event, activity];
  });
}
