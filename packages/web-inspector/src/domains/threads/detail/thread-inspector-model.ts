import type { ThreadDebuggerMetadata } from "../../../shared/thread-debugger/types.js";
import type { ApiAgentEvent } from "./event-adapter.js";

export const EMPTY_INSPECTOR_MESSAGES: ReadonlyArray<{
  id?: string;
  role: string;
  contentText: string;
}> = [];
import type { ConversationItem } from "./message-adapter.js";

export type ThreadDetailsTab = "timeline" | "state" | "raw-events";
export type ThreadDetailsPanelCacheSlot =
  | ThreadDetailsTab
  | "timeline-fallback";

export type ThreadActivityCounts = {
  messages: number;
  toolCalls: number;
  generativeUi: number;
};

export type ThreadMetadataPill = {
  label: string;
  value: string;
  wrap?: boolean;
};

export function toggleSetValue(values: Set<string>, id: string): Set<string> {
  const next = new Set(values);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function addSetValues(values: Set<string>, ids: string[]): Set<string> {
  return new Set([...values, ...ids]);
}

export function removeSetValues(
  values: Set<string>,
  ids: string[],
): Set<string> {
  const next = new Set(values);
  for (const id of ids) next.delete(id);
  return next;
}

export function addEventSourceIndexes(
  events: ApiAgentEvent[],
): ApiAgentEvent[] {
  return events.map((event, index) =>
    event.sourceIndex == null ? { ...event, sourceIndex: index + 1 } : event,
  );
}

export function countThreadActivity(
  conversation: ConversationItem[],
): ThreadActivityCounts {
  let messages = 0;
  let toolCalls = 0;
  let generativeUi = 0;
  for (const item of conversation) {
    if (item.type === "user" || item.type === "assistant") messages++;
    if (item.type === "tool_call") toolCalls++;
    if (item.type === "generative-ui") generativeUi++;
  }
  return { messages, toolCalls, generativeUi };
}

export function formatThreadTime(
  dateString: string | null | undefined,
): string {
  if (!dateString) return "—";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function formatThreadDuration(
  metadata: ThreadDebuggerMetadata | null,
): string {
  if (!metadata?.createdAt || !metadata.updatedAt) return "—";
  const milliseconds =
    new Date(metadata.updatedAt).getTime() -
    new Date(metadata.createdAt).getTime();
  if (milliseconds < 0) return "—";
  if (milliseconds < 1000) return `${milliseconds}ms`;
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

export function createThreadMetadataPills(options: {
  metadata: ThreadDebuggerMetadata | null;
  fallbackName: string | null | undefined;
  threadId: string | null;
}): ThreadMetadataPill[] {
  const pills: ThreadMetadataPill[] = [
    {
      label: "Name",
      value: options.metadata?.name ?? options.fallbackName ?? "Untitled",
    },
    { label: "ID", value: options.metadata?.id ?? options.threadId ?? "—" },
  ];
  for (const fact of [
    { label: "Agent", value: options.metadata?.agentId },
    { label: "Created", value: options.metadata?.createdAt },
    { label: "Updated", value: options.metadata?.updatedAt },
  ]) {
    if (fact.value == null || fact.value === "") continue;
    pills.push({
      label: fact.label,
      value:
        fact.label === "Created" || fact.label === "Updated"
          ? formatThreadTime(fact.value)
          : fact.value,
    });
  }
  return pills;
}
