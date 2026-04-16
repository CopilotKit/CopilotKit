import { describe, it, expect } from "vitest";
import {
  getEventCategory,
  getEventColors,
  allCategories,
  type EventCategory,
} from "../colors";

describe("getEventCategory", () => {
  it('returns "lifecycle" for RUN_STARTED', () => {
    expect(getEventCategory("RUN_STARTED")).toBe("lifecycle");
  });

  it('returns "tool" for TOOL_CALL_START', () => {
    expect(getEventCategory("TOOL_CALL_START")).toBe("tool");
  });

  it('returns "unknown" for an unmapped event type', () => {
    expect(getEventCategory("UNKNOWN_TYPE")).toBe("unknown");
    expect(getEventCategory("")).toBe("unknown");
    expect(getEventCategory("NOT_A_REAL_EVENT")).toBe("unknown");
  });
});

describe("getEventColors", () => {
  it("returns purple colors for lifecycle events", () => {
    const colors = getEventColors("RUN_STARTED");
    expect(colors.bg).toContain("purple");
    expect(colors.text).toContain("purple");
    expect(colors.border).toContain("purple");
  });

  it("returns red colors for error events", () => {
    const colors = getEventColors("RUN_ERROR");
    expect(colors.bg).toContain("red");
    expect(colors.text).toContain("red");
    expect(colors.border).toContain("red");
  });

  it("returns gray colors for unknown events", () => {
    const colors = getEventColors("UNKNOWN_TYPE");
    expect(colors.bg).toContain("gray");
    expect(colors.text).toContain("gray");
    expect(colors.border).toContain("gray");
  });
});

describe("allCategories", () => {
  it("covers every event type mapped in eventTypeToCategory", () => {
    const allEventTypes = allCategories.flatMap((c) => c.eventTypes);
    const knownTypes = [
      "RUN_STARTED",
      "RUN_FINISHED",
      "RUN_ERROR",
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_END",
      "TEXT_MESSAGE_CHUNK",
      "TOOL_CALL_START",
      "TOOL_CALL_ARGS",
      "TOOL_CALL_END",
      "TOOL_CALL_CHUNK",
      "TOOL_CALL_RESULT",
      "REASONING_START",
      "REASONING_MESSAGE_START",
      "REASONING_MESSAGE_CONTENT",
      "REASONING_MESSAGE_END",
      "REASONING_END",
      "STATE_SNAPSHOT",
      "STATE_DELTA",
      "ACTIVITY_SNAPSHOT",
      "ACTIVITY_DELTA",
    ];

    for (const eventType of knownTypes) {
      expect(allEventTypes).toContain(eventType);
    }
  });

  it("has unique categories with non-empty eventTypes", () => {
    const categories = allCategories.map((c) => c.category);
    expect(new Set(categories).size).toBe(categories.length);

    for (const entry of allCategories) {
      expect(entry.eventTypes.length).toBeGreaterThan(0);
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });

  it("maps every listed event type to the expected category", () => {
    for (const { category, eventTypes } of allCategories) {
      for (const eventType of eventTypes) {
        expect(getEventCategory(eventType)).toBe(category);
      }
    }
  });
});
