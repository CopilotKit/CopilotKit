import { describe, expect, it, vi } from "vitest";
import type { Message } from "@ag-ui/core";
import {
  ɵcreateMessageViewModel,
  ɵduplicateMessagesWarning,
} from "../message-view";
import type { ɵMessageViewInput } from "../message-view";

const rendererNames = {
  named: new Set<string>(),
  groupedNames: new Set<string>(),
  wildcard: true,
  wildcardGroups: true,
};

const user: Message = { id: "u1", role: "user", content: "Find flights" };
const toolCaller: Message = {
  id: "a1",
  role: "assistant",
  content: "",
  toolCalls: [
    {
      id: "call-1",
      type: "function",
      function: { name: "search", arguments: "{}" },
    },
  ],
};
const toolResult: Message = {
  id: "t1",
  role: "tool",
  toolCallId: "call-1",
  content: "3 flights",
};
const answer: Message = { id: "a2", role: "assistant", content: "Here." };
const reasoning: Message = {
  id: "r1",
  role: "reasoning",
  content: "thinking",
};

function input(overrides: Partial<ɵMessageViewInput> = {}) {
  const messages = overrides.messages ?? [user, toolCaller, toolResult, answer];
  return {
    display: "grouped" as const,
    messages,
    rendered: messages,
    isRunning: false,
    rendererNames,
    now: 0,
    ...overrides,
  };
}

describe("ɵMessageViewModel cursor", () => {
  it.each([
    { name: "while running", isRunning: true, last: answer, expected: true },
    { name: "when idle", isRunning: false, last: answer, expected: false },
    {
      name: "after a reasoning message",
      isRunning: true,
      last: reasoning,
      expected: false,
    },
  ])("shows the cursor $name: $expected", ({ isRunning, last, expected }) => {
    const view = ɵcreateMessageViewModel();

    const state = view.update(input({ isRunning, messages: [user, last] }));

    expect(state.showCursor).toBe(expected);
  });

  it("reads the last rendered message, not the last raw one", () => {
    const view = ɵcreateMessageViewModel();

    const state = view.update(
      input({
        isRunning: true,
        messages: [user, reasoning],
        rendered: [user],
      }),
    );

    expect(state.showCursor).toBe(true);
  });

  it("shows a pending work summary instead of the cursor in the turn display", () => {
    const view = ɵcreateMessageViewModel();

    const state = view.update(
      input({ display: "turn", isRunning: true, messages: [user] }),
    );

    expect(state.showCursor).toBe(false);
    expect(state.pendingWorkSummary).toBe(true);
  });
});

describe("ɵMessageViewModel layouts", () => {
  it("lays out nothing for the separate display", () => {
    const view = ɵcreateMessageViewModel();

    expect(view.update(input({ display: "separate" })).layouts.size).toBe(0);
  });

  it("keeps the layouts map while the inputs stay the same", () => {
    const view = ɵcreateMessageViewModel();
    const same = input();

    const first = view.update(same).layouts;
    const second = view.update({ ...same, now: 5 }).layouts;
    const changed = view.update({
      ...same,
      rendered: [...same.rendered],
    }).layouts;

    expect(second).toBe(first);
    expect(changed).not.toBe(first);
  });

  it("maps a reply to its first message in the turn display", () => {
    const view = ɵcreateMessageViewModel();

    const state = view.update(input({ display: "turn" }));

    expect([...state.turnByFirstMessage.keys()]).toEqual(["a1"]);
    expect(state.latestTurnKey).toBe("u1");
  });
});

describe("ɵMessageViewModel turn work", () => {
  it("opens the latest reply's work while it runs and folds it after", () => {
    const view = ɵcreateMessageViewModel();

    const running = view.update(
      input({
        display: "turn",
        isRunning: true,
        messages: [user, toolCaller, toolResult],
      }),
    );
    const done = view.update(input({ display: "turn" }));

    expect(running.workOpen.get("a1")).toBe(true);
    expect(done.workOpen.get("a1")).toBe(false);
  });

  it("toggles a reply's work by hand and notifies", () => {
    const view = ɵcreateMessageViewModel();
    const listener = vi.fn();
    view.subscribe(listener);
    view.update(input({ display: "turn" }));

    view.toggleTurn("u1");
    const state = view.update(input({ display: "turn" }));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(view.isTurnOpen("u1")).toBe(true);
    expect(state.workOpen.get("a1")).toBe(true);
  });

  it("times a reply it watched start from the user's message", () => {
    const view = ɵcreateMessageViewModel();

    view.update(
      input({ display: "turn", isRunning: true, messages: [user], now: 1000 }),
    );
    view.update(input({ display: "turn", now: 4000 }));

    expect(view.getWorkTime("u1")).toEqual({
      elapsedMs: 3000,
      workingSince: undefined,
    });
  });
});

describe("ɵduplicateMessagesWarning", () => {
  it("names how many messages were merged", () => {
    expect(ɵduplicateMessagesWarning(5, 3)).toBe(
      "CopilotChatMessageView: Merged 2 message(s) with duplicate IDs.",
    );
  });

  it("is null when nothing was merged", () => {
    expect(ɵduplicateMessagesWarning(3, 3)).toBeNull();
  });
});
