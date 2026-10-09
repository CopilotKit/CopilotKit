import type { DisplayValue } from "../../shared/display/types.js";

export type InspectorAgentEventType =
  | "RUN_STARTED"
  | "RUN_FINISHED"
  | "RUN_ERROR"
  | "STEP_STARTED"
  | "STEP_FINISHED"
  | "TEXT_MESSAGE_START"
  | "TEXT_MESSAGE_CONTENT"
  | "TEXT_MESSAGE_END"
  | "TOOL_CALL_START"
  | "TOOL_CALL_ARGS"
  | "TOOL_CALL_END"
  | "TOOL_CALL_RESULT"
  | "STATE_SNAPSHOT"
  | "STATE_DELTA"
  | "MESSAGES_SNAPSHOT"
  | "RAW_EVENT"
  | "CUSTOM_EVENT"
  | "REASONING_START"
  | "REASONING_MESSAGE_START"
  | "REASONING_MESSAGE_CONTENT"
  | "REASONING_MESSAGE_END"
  | "REASONING_END"
  | "REASONING_ENCRYPTED_VALUE"
  | "ACTIVITY_SNAPSHOT"
  | "ACTIVITY_DELTA";

export const AGENT_EVENT_TYPES: readonly InspectorAgentEventType[] = [
  "RUN_STARTED",
  "RUN_FINISHED",
  "RUN_ERROR",
  "STEP_STARTED",
  "STEP_FINISHED",
  "TEXT_MESSAGE_START",
  "TEXT_MESSAGE_CONTENT",
  "TEXT_MESSAGE_END",
  "TOOL_CALL_START",
  "TOOL_CALL_ARGS",
  "TOOL_CALL_END",
  "TOOL_CALL_RESULT",
  "STATE_SNAPSHOT",
  "STATE_DELTA",
  "MESSAGES_SNAPSHOT",
  "RAW_EVENT",
  "CUSTOM_EVENT",
  "REASONING_START",
  "REASONING_MESSAGE_START",
  "REASONING_MESSAGE_CONTENT",
  "REASONING_MESSAGE_END",
  "REASONING_END",
  "REASONING_ENCRYPTED_VALUE",
  "ACTIVITY_SNAPSHOT",
  "ACTIVITY_DELTA",
];

export type InspectorToolCall = {
  id?: string;
  toolName?: string;
  status?: string;
  function?: {
    name?: string;
    arguments?: DisplayValue | string;
  };
  arguments?: DisplayValue | string;
};

export type InspectorMessage = {
  id?: string;
  role: string;
  contentText: string;
  contentRaw?: DisplayValue;
  toolCalls: InspectorToolCall[];
  toolCallId?: string;
  activityType?: string;
};

export type InspectorToolDefinition = {
  agentId: string;
  name: string;
  description?: string;
  parameters?: unknown;
  type: "handler" | "renderer";
};

export type InspectorEvent = {
  id: string;
  agentId: string;
  type: InspectorAgentEventType;
  timestamp: number;
  payload: DisplayValue;
};

export type InspectorContextEntry = {
  description?: string;
  value: unknown;
};

export type EventColumnResize = {
  col: number;
  startX: number;
  startW: number;
};

export interface LiveInspectionState {
  agentSubscriptions: Map<string, () => void>;
  agentEvents: Map<string, InspectorEvent[]>;
  agentMessages: Map<string, InspectorMessage[]>;
  liveMessageVersion: Map<string, number>;
  agentStates: Map<string, DisplayValue>;
  flattenedEvents: InspectorEvent[];
  eventCounter: number;
  contextStore: Record<string, InspectorContextEntry>;
  contextOptions: Array<{ key: string; label: string }>;
  selectedContext: string;
  cachedTools: InspectorToolDefinition[];
  toolSignature: string;
  capabilitiesVersion: number;
  eventFilterText: string;
  eventTypeFilter: InspectorAgentEventType | "all";
  eventColumnWidths: number[];
  eventColumnResize: EventColumnResize | null;
  expandedEventIds: Set<string>;
  expandedToolIds: Set<string>;
  expandedContextIds: Set<string>;
}

export type LiveInspectionPanelKind = "context" | "event" | "tool";

export const AGENT_SCOPE_TRIGGER_ID = "cpk-live-agent-scope-trigger";
export const AGENT_SCOPE_POPUP_ID = "cpk-live-agent-scope-popup";

export function liveInspectionPanelId(
  kind: LiveInspectionPanelKind,
  key: string,
): string {
  const encodedKey = Array.from(key, (character) =>
    character.codePointAt(0)?.toString(36),
  ).join("-");
  return `cpk-live-${kind}-${encodedKey || "empty"}-panel`;
}

export function createLiveInspectionState(): LiveInspectionState {
  return {
    agentSubscriptions: new Map(),
    agentEvents: new Map(),
    agentMessages: new Map(),
    liveMessageVersion: new Map(),
    agentStates: new Map(),
    flattenedEvents: [],
    eventCounter: 0,
    contextStore: {},
    contextOptions: [{ key: "all-agents", label: "All Agents" }],
    selectedContext: "all-agents",
    cachedTools: [],
    toolSignature: "",
    capabilitiesVersion: 0,
    eventFilterText: "",
    eventTypeFilter: "all",
    eventColumnWidths: [100, 80, 150],
    eventColumnResize: null,
    expandedEventIds: new Set(),
    expandedToolIds: new Set(),
    expandedContextIds: new Set(),
  };
}
