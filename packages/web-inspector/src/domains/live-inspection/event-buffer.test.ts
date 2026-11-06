import { describe, expect, it } from "vitest";
import {
  MAX_AGENT_EVENTS,
  MAX_TOTAL_EVENTS,
  recordEvent,
} from "./event-buffer.js";
import { createLiveInspectionState } from "./state.js";

describe("live event buffer", () => {
  it("keeps newest events first and enforces both event bounds", () => {
    const state = createLiveInspectionState();

    for (let index = 1; index <= MAX_AGENT_EVENTS + 1; index += 1) {
      recordEvent(state, "alpha", "CUSTOM_EVENT", { index }, () => index);
    }

    expect(state.agentEvents.get("alpha")).toHaveLength(MAX_AGENT_EVENTS);
    expect(state.agentEvents.get("alpha")?.[0]).toMatchObject({
      id: `alpha:${MAX_AGENT_EVENTS + 1}`,
      timestamp: MAX_AGENT_EVENTS + 1,
      payload: { index: MAX_AGENT_EVENTS + 1 },
    });

    for (let index = 0; index < MAX_TOTAL_EVENTS; index += 1) {
      recordEvent(state, `agent-${index}`, "RAW_EVENT", index, () => index);
    }

    expect(state.flattenedEvents).toHaveLength(MAX_TOTAL_EVENTS);
    expect(state.flattenedEvents[0]?.payload).toBe(MAX_TOTAL_EVENTS - 1);
  });

  it("normalizes wrapped event payloads before recording them", () => {
    const state = createLiveInspectionState();

    recordEvent(state, "alpha", "RAW_EVENT", {
      event: { type: "raw" },
      buffer: "partial",
    });

    expect(state.flattenedEvents[0]?.payload).toEqual({
      event: { type: "raw" },
      buffer: "partial",
    });
  });
});
