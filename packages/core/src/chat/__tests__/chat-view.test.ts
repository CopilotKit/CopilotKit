import { describe, expect, it } from "vitest";
import type { Message } from "@ag-ui/core";
import { ɵcreateLastUserMessageTracker, ɵgetChatViewState } from "../chat-view";
import type { ɵChatViewStateInput } from "../chat-view";

function viewState(overrides: Partial<ɵChatViewStateInput> = {}) {
  return ɵgetChatViewState({
    messageCount: 0,
    suggestionCount: 2,
    isRunning: false,
    isConnecting: false,
    hasExplicitThreadId: false,
    welcomeScreenEnabled: true,
    inputContainerHeight: 100,
    ...overrides,
  });
}

describe("ɵgetChatViewState", () => {
  it("shows the welcome screen and suggestions for an empty idle chat", () => {
    expect(viewState()).toEqual({
      hasSuggestions: true,
      showWelcomeScreen: true,
      paddingBottom: 104,
    });
  });

  it.each([
    { name: "while connecting", overrides: { isConnecting: true } },
    { name: "when turned off", overrides: { welcomeScreenEnabled: false } },
    { name: "for a picked thread", overrides: { hasExplicitThreadId: true } },
    { name: "with messages", overrides: { messageCount: 1 } },
  ])("hides the welcome screen $name", ({ overrides }) => {
    expect(viewState(overrides).showWelcomeScreen).toBe(false);
  });

  it.each([
    { name: "while running", overrides: { isRunning: true } },
    { name: "while connecting", overrides: { isConnecting: true } },
    { name: "without suggestions", overrides: { suggestionCount: 0 } },
  ])("hides suggestions $name and pads 32px", ({ overrides }) => {
    const state = viewState(overrides);

    expect(state.hasSuggestions).toBe(false);
    expect(state.paddingBottom).toBe(132);
  });
});

describe("ɵcreateLastUserMessageTracker", () => {
  const user = (id: string): Message => ({ id, role: "user", content: id });
  const reply: Message = { id: "a1", role: "assistant", content: "hi" };

  it("does not count the messages the chat starts with as a send", () => {
    const tracker = ɵcreateLastUserMessageTracker([user("u1")]);

    expect(tracker.update([user("u1"), reply])).toEqual({
      id: "u1",
      sendNonce: 0,
    });
  });

  it("counts each new user message and keeps the state between sends", () => {
    const tracker = ɵcreateLastUserMessageTracker([]);

    const first = tracker.update([user("u1")]);
    const same = tracker.update([user("u1"), reply]);
    const second = tracker.update([user("u1"), reply, user("u2")]);

    expect(first).toEqual({ id: "u1", sendNonce: 1 });
    expect(same).toBe(first);
    expect(second).toEqual({ id: "u2", sendNonce: 2 });
  });

  it("does not count a message that returns after a clear", () => {
    const tracker = ɵcreateLastUserMessageTracker([user("u1")]);

    tracker.update([]);
    const restored = tracker.update([user("u1")]);

    expect(restored).toEqual({ id: "u1", sendNonce: 0 });
  });
});
