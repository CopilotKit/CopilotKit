import { describe, expect, it } from "vitest";
import { createLiveInspectionState } from "../state.js";
import type { InspectorEvent } from "../state.js";
import {
  clearEvents,
  eventsForSelectedContext,
  filterEvents,
  resizeEventColumn,
} from "./model.js";

function event(
  id: string,
  agentId: string,
  type: InspectorEvent["type"],
  payload: InspectorEvent["payload"],
): InspectorEvent {
  return { id, agentId, type, timestamp: 1, payload };
}

describe("live events model", () => {
  it("filters by event type, agent, and payload text", () => {
    const events = [
      event("alpha:2", "alpha", "RUN_ERROR", { message: "Network failed" }),
      event("beta:1", "beta", "RUN_STARTED", { runId: "run-1" }),
    ];

    expect(filterEvents(events, "network", "all")).toEqual([events[0]]);
    expect(filterEvents(events, "beta", "all")).toEqual([events[1]]);
    expect(filterEvents(events, "", "RUN_ERROR")).toEqual([events[0]]);
  });

  it("selects and clears only the active agent when scoped", () => {
    const state = createLiveInspectionState();
    const alpha = event("alpha:1", "alpha", "RUN_STARTED", {});
    const beta = event("beta:1", "beta", "RUN_STARTED", {});
    state.agentEvents.set("alpha", [alpha]);
    state.agentEvents.set("beta", [beta]);
    state.flattenedEvents = [beta, alpha];
    state.selectedContext = "alpha";
    state.expandedEventIds.add(alpha.id);

    expect(eventsForSelectedContext(state)).toEqual([alpha]);
    clearEvents(state);

    expect(state.agentEvents.has("alpha")).toBe(false);
    expect(state.agentEvents.get("beta")).toEqual([beta]);
    expect(state.flattenedEvents).toEqual([beta]);
    expect(state.expandedEventIds.size).toBe(0);
  });

  it("enforces the minimum event column width", () => {
    const state = createLiveInspectionState();

    resizeEventColumn(state, 1, 12);

    expect(state.eventColumnWidths).toEqual([100, 40, 150]);
  });
});
