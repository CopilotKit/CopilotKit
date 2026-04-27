import { describe, it, expect } from "vitest";
import { advanceState, initialState } from "./AnimatedCopilotDemo";
import { SCRIPT } from "./AnimatedCopilotDemo.script";

describe("AnimatedCopilotDemo timeline reducer", () => {
  it("starts empty", () => {
    expect(initialState.messages).toHaveLength(0);
    expect(initialState.typedInputText).toBe("");
    expect(initialState.isAssistantTyping).toBe(false);
    expect(initialState.pageEffectColor).toBeNull();
  });

  it("appends a user message on submit-user-message", () => {
    const after = advanceState(initialState, [
      { at: 0, action: "type-input", text: "hello" },
      { at: 1, action: "submit-user-message" },
    ]);
    expect(after.messages).toHaveLength(1);
    expect(after.messages[0].role).toBe("user");
    expect(after.typedInputText).toBe("");
  });

  it("appends an assistant message", () => {
    const after = advanceState(initialState, [
      { at: 0, action: "assistant-message", text: "hi" },
    ]);
    expect(after.messages).toHaveLength(1);
    expect(after.messages[0].role).toBe("assistant");
  });

  it("toggles assistant-typing", () => {
    const a = advanceState(initialState, [{ at: 0, action: "assistant-typing", on: true }]);
    expect(a.isAssistantTyping).toBe(true);
    const b = advanceState(a, [{ at: 1, action: "assistant-typing", on: false }]);
    expect(b.isAssistantTyping).toBe(false);
  });

  it("attaches a tool call to the most recent assistant message", () => {
    const after = advanceState(initialState, [
      { at: 0, action: "assistant-message", text: "ok" },
      { at: 1, action: "tool-call", name: "setBackground", args: { color: "#fff" } },
    ]);
    const last = after.messages[after.messages.length - 1];
    expect(last.role).toBe("assistant");
    expect(last.toolCalls).toHaveLength(1);
    expect(last.toolCalls?.[0].function.name).toBe("setBackground");
  });

  it("sets page-effect color", () => {
    const after = advanceState(initialState, [{ at: 0, action: "page-effect", color: "#abc" }]);
    expect(after.pageEffectColor).toBe("#abc");
  });

  it("resets back to empty on reset", () => {
    const dirty = advanceState(initialState, [
      { at: 0, action: "assistant-message", text: "hi" },
      { at: 1, action: "page-effect", color: "#abc" },
    ]);
    const after = advanceState(dirty, [{ at: 2, action: "reset" }]);
    expect(after).toEqual(initialState);
  });

  it("the full SCRIPT replays without throwing and ends in a reset", () => {
    const final = advanceState(initialState, [...SCRIPT]);
    expect(final).toEqual(initialState);
  });
});
