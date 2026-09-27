import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { vi } from "vitest";
import type { Message } from "@ag-ui/core";
import { CopilotChatMessageView } from "../CopilotChatMessageView";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { getAssistantTurn, getAssistantTurnKeys } from "../assistant-turn";

const mockWriteText = vi.fn();
Object.assign(navigator, { clipboard: { writeText: mockWriteText } });

beforeEach(() => mockWriteText.mockClear());

// One user message answered by three assistant messages (text, a tool call,
// then more text), followed by a second, single-message turn.
const messages: Message[] = [
  { id: "u1", role: "user", content: "Plan the launch" },
  { id: "a1", role: "assistant", content: "Let me look that up." },
  {
    id: "a2",
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "tc1",
        type: "function",
        function: { name: "search", arguments: "{}" },
      },
    ],
  },
  { id: "t1", role: "tool", toolCallId: "tc1", content: "3 results" },
  { id: "a3", role: "assistant", content: "Here is the plan." },
  { id: "u2", role: "user", content: "Thanks" },
  { id: "a4", role: "assistant", content: "Anytime." },
];

const renderView = (
  props: Partial<React.ComponentProps<typeof CopilotChatMessageView>> = {},
) =>
  render(
    <CopilotKitProvider>
      <CopilotChatConfigurationProvider threadId="turn-toolbar">
        <CopilotChatMessageView messages={messages} {...props} />
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>,
  );

describe("getAssistantTurn", () => {
  it("groups the assistant messages between two user messages", () => {
    expect(getAssistantTurn(messages, "a2")).toEqual({
      lastMessageId: "a3",
      content: "Let me look that up.\n\nHere is the plan.",
      isLatest: false,
    });
    expect(getAssistantTurn(messages, "a4")).toEqual({
      lastMessageId: "a4",
      content: "Anytime.",
      isLatest: true,
    });
  });

  it("returns undefined for non-assistant or unknown messages", () => {
    expect(getAssistantTurn(messages, "u1")).toBeUndefined();
    expect(getAssistantTurn(messages, "missing")).toBeUndefined();
  });
});

describe("getAssistantTurnKeys", () => {
  it("changes the last message's key when a later assistant message joins the turn", () => {
    const before = getAssistantTurnKeys(messages.slice(0, 3), false);
    const after = getAssistantTurnKeys(messages.slice(0, 5), false);
    expect(before.get("a2")).toMatch(/^last:/);
    expect(after.get("a2")).toBe("inner");
    expect(after.get("a3")).toMatch(/^last:/);
  });
});

describe("assistant toolbar scope", () => {
  it("shows one toolbar per reply by default, copying the whole reply", async () => {
    renderView();

    const toolbars = screen.getAllByTestId("copilot-assistant-toolbar");
    expect(toolbars).toHaveLength(2);

    fireEvent.click(
      within(toolbars[0]!).getByRole("button", { name: /copy/i }),
    );
    await waitFor(() =>
      expect(mockWriteText).toHaveBeenCalledWith(
        "Let me look that up.\n\nHere is the plan.",
      ),
    );
  });

  it("hides the latest reply's toolbar while it is still running", () => {
    renderView({ isRunning: true });
    expect(screen.getAllByTestId("copilot-assistant-toolbar")).toHaveLength(1);
  });

  it('gives every assistant message a toolbar with toolbarScope="message"', () => {
    renderView({ assistantMessage: { toolbarScope: "message" } });
    // a2 has no text, so it has no toolbar in either scope.
    expect(screen.getAllByTestId("copilot-assistant-toolbar")).toHaveLength(3);
  });
});
