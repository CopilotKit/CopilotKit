import type { AbstractAgent, AgentSubscriber } from "@ag-ui/client";
import { normalizeDisplayValue } from "../../shared/display/display-value.js";
import type {
  InspectorAgentEventType,
  InspectorMessage,
  InspectorToolCall,
  LiveInspectionState,
} from "./state.js";

export type LiveAgentAdapterActions = Readonly<{
  recordEvent: (
    agentId: string,
    type: InspectorAgentEventType,
    payload: unknown,
  ) => void;
  requestUpdate: () => void;
  refreshTools: () => void;
  refreshThreads: (agentId: string) => void;
  canRefreshThreads: () => boolean;
}>;

function textFromUnknownContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return typeof part.text === "string" ? part.text : "";
        }
        return "";
      })
      .join("");
  }
  if (content && typeof content === "object" && "text" in content) {
    return typeof content.text === "string" ? content.text : "";
  }
  return "";
}

function normalizeMessageContent(content: unknown): string {
  const extracted = textFromUnknownContent(content);
  if (extracted) return extracted;
  if (content === null || content === undefined) return "";
  if (typeof content === "object") {
    try {
      return JSON.stringify(normalizeDisplayValue(content));
    } catch {
      return "";
    }
  }
  return String(content);
}

function normalizeToolCalls(raw: unknown): InspectorToolCall[] {
  if (!Array.isArray(raw)) return [];
  const calls: InspectorToolCall[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const fn = "function" in entry ? entry.function : undefined;
    const functionName =
      fn &&
      typeof fn === "object" &&
      "name" in fn &&
      typeof fn.name === "string"
        ? fn.name
        : "toolName" in entry && typeof entry.toolName === "string"
          ? entry.toolName
          : undefined;
    const args =
      fn && typeof fn === "object" && "arguments" in fn
        ? fn.arguments
        : "arguments" in entry
          ? entry.arguments
          : undefined;
    const call: InspectorToolCall = {
      id: "id" in entry && typeof entry.id === "string" ? entry.id : undefined,
      toolName:
        "toolName" in entry && typeof entry.toolName === "string"
          ? entry.toolName
          : functionName,
      status:
        "status" in entry && typeof entry.status === "string"
          ? entry.status
          : undefined,
    };
    if (functionName) {
      call.function = {
        name: functionName,
        arguments: normalizeDisplayValue(args),
      };
    }
    calls.push(call);
  }
  return calls;
}

function normalizeAgentMessage(message: unknown): InspectorMessage | null {
  if (!message || typeof message !== "object") return null;
  const content = "content" in message ? message.content : undefined;
  return {
    id:
      "id" in message && typeof message.id === "string"
        ? message.id
        : undefined,
    role:
      "role" in message && typeof message.role === "string"
        ? message.role
        : "unknown",
    contentText: normalizeMessageContent(content),
    contentRaw:
      content !== undefined ? normalizeDisplayValue(content) : undefined,
    toolCalls: normalizeToolCalls(
      "toolCalls" in message ? message.toolCalls : undefined,
    ),
    toolCallId:
      "toolCallId" in message && typeof message.toolCallId === "string"
        ? message.toolCallId
        : undefined,
    activityType:
      "activityType" in message && typeof message.activityType === "string"
        ? message.activityType
        : undefined,
  };
}

export function normalizeAgentMessages(
  messages: unknown,
): InspectorMessage[] | null {
  if (!Array.isArray(messages)) return null;
  const normalized: InspectorMessage[] = [];
  for (const message of messages) {
    const item = normalizeAgentMessage(message);
    if (item) normalized.push(item);
  }
  return normalized;
}

export function readAgentThreadId(agent: AbstractAgent): string | undefined {
  return typeof agent.threadId === "string" ? agent.threadId : undefined;
}

export function syncAgentMessages(
  state: LiveInspectionState,
  agent: AbstractAgent,
  requestUpdate: () => void,
): void {
  if (!agent.agentId) return;
  try {
    const messages = normalizeAgentMessages(agent.messages);
    if (messages) state.agentMessages.set(agent.agentId, messages);
    else state.agentMessages.delete(agent.agentId);
    const threadId = readAgentThreadId(agent);
    if (threadId) {
      state.liveMessageVersion.set(
        threadId,
        (state.liveMessageVersion.get(threadId) ?? 0) + 1,
      );
    }
    requestUpdate();
  } catch (error) {
    console.error(
      `[CopilotKit Inspector] Failed to sync messages for agent "${agent.agentId}":`,
      error,
    );
  }
}

export function syncAgentState(
  state: LiveInspectionState,
  agent: AbstractAgent,
  requestUpdate: () => void,
): void {
  if (!agent.agentId) return;
  try {
    if (agent.state === undefined || agent.state === null) {
      state.agentStates.delete(agent.agentId);
    } else {
      state.agentStates.set(agent.agentId, normalizeDisplayValue(agent.state));
    }
    requestUpdate();
  } catch (error) {
    console.error(
      `[CopilotKit Inspector] Failed to sync state for agent "${agent.agentId}":`,
      error,
    );
  }
}

export function unsubscribeFromAgent(
  state: LiveInspectionState,
  agentId: string,
): void {
  state.agentSubscriptions.get(agentId)?.();
  state.agentSubscriptions.delete(agentId);
}

export function subscribeToAgent(
  state: LiveInspectionState,
  agent: AbstractAgent,
  actions: LiveAgentAdapterActions,
): void {
  if (!agent.agentId) return;
  const agentId = agent.agentId;
  unsubscribeFromAgent(state, agentId);
  const record = (type: InspectorAgentEventType, payload: unknown) =>
    actions.recordEvent(agentId, type, payload);
  const syncMessages = () =>
    syncAgentMessages(state, agent, actions.requestUpdate);
  const syncState = () => syncAgentState(state, agent, actions.requestUpdate);
  const subscriber: AgentSubscriber = {
    onRunStartedEvent: ({ event }) => record("RUN_STARTED", event),
    onRunFinishedEvent: (params) => {
      record("RUN_FINISHED", {
        event: params.event,
        result: "result" in params ? params.result : undefined,
      });
      if (actions.canRefreshThreads()) actions.refreshThreads(agentId);
    },
    onRunErrorEvent: ({ event }) => record("RUN_ERROR", event),
    onStepStartedEvent: ({ event }) => record("STEP_STARTED", event),
    onStepFinishedEvent: ({ event }) => record("STEP_FINISHED", event),
    onTextMessageStartEvent: ({ event }) => record("TEXT_MESSAGE_START", event),
    onTextMessageContentEvent: ({ event, textMessageBuffer }) =>
      record("TEXT_MESSAGE_CONTENT", { event, textMessageBuffer }),
    onTextMessageEndEvent: ({ event, textMessageBuffer }) =>
      record("TEXT_MESSAGE_END", { event, textMessageBuffer }),
    onToolCallStartEvent: ({ event }) => record("TOOL_CALL_START", event),
    onToolCallArgsEvent: (params) =>
      record("TOOL_CALL_ARGS", {
        event: params.event,
        toolCallBuffer: params.toolCallBuffer,
        toolCallName: params.toolCallName,
        partialToolCallArgs: params.partialToolCallArgs,
      }),
    onToolCallEndEvent: ({ event, toolCallArgs, toolCallName }) =>
      record("TOOL_CALL_END", { event, toolCallArgs, toolCallName }),
    onToolCallResultEvent: ({ event }) => record("TOOL_CALL_RESULT", event),
    onStateSnapshotEvent: ({ event }) => {
      record("STATE_SNAPSHOT", event);
      syncState();
    },
    onStateDeltaEvent: ({ event }) => {
      record("STATE_DELTA", event);
      syncState();
    },
    onMessagesSnapshotEvent: ({ event }) => {
      record("MESSAGES_SNAPSHOT", event);
      syncMessages();
    },
    onMessagesChanged: syncMessages,
    onStateChanged: syncState,
    onRawEvent: ({ event }) => record("RAW_EVENT", event),
    onCustomEvent: ({ event }) => record("CUSTOM_EVENT", event),
    onReasoningStartEvent: ({ event }) => record("REASONING_START", event),
    onReasoningMessageStartEvent: ({ event }) =>
      record("REASONING_MESSAGE_START", event),
    onReasoningMessageContentEvent: ({ event, reasoningMessageBuffer }) =>
      record("REASONING_MESSAGE_CONTENT", { event, reasoningMessageBuffer }),
    onReasoningMessageEndEvent: ({ event, reasoningMessageBuffer }) =>
      record("REASONING_MESSAGE_END", { event, reasoningMessageBuffer }),
    onReasoningEndEvent: ({ event }) => record("REASONING_END", event),
    onReasoningEncryptedValueEvent: ({ event }) =>
      record("REASONING_ENCRYPTED_VALUE", event),
    onActivitySnapshotEvent: ({ event }) => {
      record("ACTIVITY_SNAPSHOT", event);
      syncMessages();
    },
    onActivityDeltaEvent: ({ event }) => {
      record("ACTIVITY_DELTA", event);
      syncMessages();
    },
  };
  state.agentSubscriptions.set(
    agentId,
    agent.subscribe(subscriber).unsubscribe,
  );
  syncMessages();
  syncState();
  if (!state.agentEvents.has(agentId)) state.agentEvents.set(agentId, []);
}

export function teardownAgentSubscriptions(state: LiveInspectionState): void {
  for (const unsubscribe of state.agentSubscriptions.values()) unsubscribe();
  state.agentSubscriptions.clear();
  state.agentEvents.clear();
  state.agentMessages.clear();
  state.agentStates.clear();
  state.flattenedEvents = [];
  state.eventCounter = 0;
}
