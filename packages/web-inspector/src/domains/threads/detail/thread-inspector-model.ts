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

export const THREAD_INSPECTOR_PROPERTIES = {
  threadId: { attribute: false },
  showThreadTitle: { type: Boolean, attribute: false },
  provider: { attribute: false },
  thread: { attribute: false },
  runtimeUrl: { attribute: false },
  headers: { attribute: false },
  threadInspectionAvailable: { attribute: false },
  agentStateInput: { attribute: false },
  agentEventsInput: { attribute: false },
  agentMessagesInput: { attribute: false },
  liveMessageVersion: { attribute: false },
  viewInAppMode: { attribute: false },
  viewInAppError: { attribute: false },
  tryFromHereAvailable: { attribute: false },
  tryFromHereBusy: { attribute: false },
  tryFromHereError: { attribute: false },
  focusMessageId: { attribute: false },
  focusRequestId: { attribute: false },
  _tab: { state: true },
  _fetchedMetadata: { state: true },
  _conversation: { state: true },
  _fetchedEvents: { state: true },
  _fetchedState: { state: true },
  _loadingMessages: { state: true },
  _loadingEvents: { state: true },
  _loadingState: { state: true },
  _messagesError: { state: true },
  _messageRefreshError: { state: true },
  _showEventTimeline: { state: true },
  _eventsError: { state: true },
  _stateError: { state: true },
  _expandedTools: { state: true },
  _expandedMessages: { state: true },
  _expandedTimelineDetails: { state: true },
  _expandedRawEvents: { state: true },
  _showDetailPanel: { state: true },
  _detailPanelWidth: { state: true },
  _eventsNotAvailable: { state: true },
  _stateNotAvailable: { state: true },
  _panelInitializing: { state: true },
  _activatedTabs: { state: true },
};
