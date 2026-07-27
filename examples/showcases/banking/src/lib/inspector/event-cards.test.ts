import { describe, expect, it } from "vitest";
import { eventToCard } from "./event-cards";

describe("eventToCard", () => {
  it("maps lifecycle events", () => {
    expect(eventToCard({ type: "RUN_STARTED" })?.kind).toBe("lifecycle");
    expect(eventToCard({ type: "RUN_FINISHED" })?.kind).toBe("lifecycle");
  });

  it("maps a memory tool call to the memory kind", () => {
    const card = eventToCard({
      type: "TOOL_CALL_START",
      toolCallName: "recall_memory",
    });
    expect(card?.kind).toBe("memory");
    expect(card?.title).toMatch(/recall/i);
  });

  it("maps a banking HITL tool call to the hitl-gate kind", () => {
    const card = eventToCard({
      type: "TOOL_CALL_START",
      toolCallName: "approveTransaction",
    });
    expect(card?.kind).toBe("hitl-gate");
  });

  it("maps an unknown tool call to a generic tool-call", () => {
    const card = eventToCard({
      type: "TOOL_CALL_START",
      toolCallName: "somethingElse",
    });
    expect(card?.kind).toBe("tool-call");
  });

  it("returns null for noisy streaming events", () => {
    expect(eventToCard({ type: "TEXT_MESSAGE_CONTENT" })).toBeNull();
    expect(eventToCard({ type: "TOOL_CALL_ARGS" })).toBeNull();
  });
});
