import type { AbstractAgent } from "@ag-ui/client";
import type { InspectorMessage, LiveInspectionState } from "../state.js";

export const EMPTY_INSPECTOR_MESSAGES: InspectorMessage[] = [];

export function latestStateForAgent(
  state: LiveInspectionState,
  agentId: string,
) {
  if (state.agentStates.has(agentId))
    return state.agentStates.get(agentId) ?? null;
  return (
    state.agentEvents
      .get(agentId)
      ?.find((event) => event.type === "STATE_SNAPSHOT")?.payload ?? null
  );
}

export function latestMessagesForAgent(
  state: LiveInspectionState,
  agentId: string,
): InspectorMessage[] | null {
  return state.agentMessages.get(agentId) ?? null;
}

export function liveAgentMessagesForThread(
  state: LiveInspectionState,
  thread: { id: string; agentId: string },
  getAgent: ((agentId: string) => AbstractAgent | undefined) | undefined,
): InspectorMessage[] {
  const messages =
    state.agentMessages.get(thread.agentId) ?? EMPTY_INSPECTOR_MESSAGES;
  if (!getAgent) return messages;
  const agent = getAgent(thread.agentId);
  const agentThreadId =
    agent && typeof agent.threadId === "string" ? agent.threadId : undefined;
  return agentThreadId === thread.id ? messages : EMPTY_INSPECTOR_MESSAGES;
}

export function agentStatus(
  state: LiveInspectionState,
  agentId: string,
): "running" | "idle" | "error" {
  const events = state.agentEvents.get(agentId) ?? [];
  const runEvent = events.find(
    (event) =>
      event.type === "RUN_STARTED" ||
      event.type === "RUN_FINISHED" ||
      event.type === "RUN_ERROR",
  );
  if (!runEvent || runEvent.type === "RUN_FINISHED") return "idle";
  if (runEvent.type === "RUN_ERROR") return "error";
  return events.some(
    (event) =>
      event.type === "RUN_FINISHED" && event.timestamp > runEvent.timestamp,
  )
    ? "idle"
    : "running";
}

export function agentStats(state: LiveInspectionState, agentId: string) {
  const events = state.agentEvents.get(agentId) ?? [];
  const messages = state.agentMessages.get(agentId);
  return {
    totalEvents: events.length,
    lastActivity: events[0]?.timestamp ?? null,
    messages: messages?.length ?? 0,
    toolCalls: messages
      ? messages.reduce(
          (count, message) => count + (message.toolCalls?.length ?? 0),
          0,
        )
      : events.filter((event) => event.type === "TOOL_CALL_END").length,
    errors: events.filter((event) => event.type === "RUN_ERROR").length,
  };
}

export function hasRenderableState(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed !== "{}";
  }
  return true;
}
