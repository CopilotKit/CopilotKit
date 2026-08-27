import { normalizeDisplayValue } from "../../shared/display/display-value.js";
import type { InspectorEvent } from "./state.js";
import type { InspectorAgentEventType, LiveInspectionState } from "./state.js";

export const MAX_AGENT_EVENTS = 200;
export const MAX_TOTAL_EVENTS = 500;

export function appendBoundedEvent(
  events: readonly InspectorEvent[],
  event: InspectorEvent,
  limit: number,
): InspectorEvent[] {
  return [event, ...events].slice(0, Math.max(0, limit));
}

export function normalizeEventPayload(payload: unknown) {
  if (payload && typeof payload === "object" && "event" in payload) {
    const entries = Object.entries(payload).filter(([key]) => key !== "event");
    return normalizeDisplayValue(
      entries.length === 0
        ? payload.event
        : { event: payload.event, ...Object.fromEntries(entries) },
    );
  }
  return normalizeDisplayValue(payload);
}

export function recordEvent(
  state: LiveInspectionState,
  agentId: string,
  type: InspectorAgentEventType,
  payload: unknown,
  now: () => number = Date.now,
): void {
  const event = {
    id: `${agentId}:${++state.eventCounter}`,
    agentId,
    type,
    timestamp: now(),
    payload: normalizeEventPayload(payload),
  };
  state.agentEvents.set(
    agentId,
    appendBoundedEvent(
      state.agentEvents.get(agentId) ?? [],
      event,
      MAX_AGENT_EVENTS,
    ),
  );
  state.flattenedEvents = appendBoundedEvent(
    state.flattenedEvents,
    event,
    MAX_TOTAL_EVENTS,
  );
}
