import type {
  InspectorAgentEventType,
  InspectorEvent,
  LiveInspectionState,
} from "../state.js";

export function eventsForSelectedContext(
  state: LiveInspectionState,
): InspectorEvent[] {
  return state.selectedContext === "all-agents"
    ? state.flattenedEvents
    : (state.agentEvents.get(state.selectedContext) ?? []);
}

export function stringifyEventPayload(
  payload: unknown,
  pretty = false,
): string {
  try {
    if (payload === undefined) return "undefined";
    if (typeof payload === "string") return payload;
    return JSON.stringify(payload, null, pretty ? 2 : 0) ?? "";
  } catch (error) {
    console.warn("Failed to stringify inspector payload", error);
    return String(payload);
  }
}

export function extractEventFromPayload(payload: unknown): unknown {
  if (payload && typeof payload === "object" && "event" in payload) {
    return payload.event;
  }
  return payload;
}

export function filterEvents(
  events: readonly InspectorEvent[],
  filterText: string,
  typeFilter: InspectorAgentEventType | "all",
): InspectorEvent[] {
  const query = filterText.trim().toLowerCase();
  return events.filter((event) => {
    if (typeFilter !== "all" && event.type !== typeFilter) return false;
    if (!query) return true;
    return (
      event.type.toLowerCase().includes(query) ||
      event.agentId.toLowerCase().includes(query) ||
      stringifyEventPayload(event.payload).toLowerCase().includes(query)
    );
  });
}

export function eventBadgeClasses(type: string): string {
  const base =
    "font-mono text-[10px] font-semibold inline-flex items-center rounded-sm px-1.5 py-0.5 border";
  if (type === "RUN_ERROR") {
    return `${base} bg-rose-50 text-rose-800 border-rose-200`;
  }
  if (type.startsWith("TOOL_CALL")) {
    return `${base} bg-emerald-50 text-gray-900 border-emerald-200`;
  }
  if (
    type.startsWith("TEXT_MESSAGE") ||
    type.startsWith("REASONING") ||
    type.startsWith("STATE") ||
    type.startsWith("MESSAGES")
  ) {
    return `${base} bg-violet-50 text-gray-900 border-violet-200`;
  }
  return `${base} bg-gray-100 text-gray-900 border-gray-200`;
}

export function clearEvents(state: LiveInspectionState): void {
  if (state.selectedContext === "all-agents") {
    state.agentEvents.clear();
    state.flattenedEvents = [];
  } else {
    state.agentEvents.delete(state.selectedContext);
    state.flattenedEvents = state.flattenedEvents.filter(
      (event) => event.agentId !== state.selectedContext,
    );
  }
  state.expandedEventIds.clear();
}

export function resetEventFilters(state: LiveInspectionState): void {
  state.eventFilterText = "";
  state.eventTypeFilter = "all";
}

export function resizeEventColumn(
  state: LiveInspectionState,
  column: number,
  width: number,
): void {
  state.eventColumnWidths = state.eventColumnWidths.map((current, index) =>
    index === column ? Math.max(40, width) : current,
  );
}
