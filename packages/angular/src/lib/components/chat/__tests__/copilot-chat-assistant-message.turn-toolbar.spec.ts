import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@ag-ui/core";

import { getAssistantTurn } from "../assistant-turn";
import { CopilotChatMessageView } from "../copilot-chat-message-view";
import { provideCopilotKit } from "../../../config";

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

describe("assistant toolbar scope", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    TestBed.resetTestingModule();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    TestBed.configureTestingModule({
      imports: [CopilotChatMessageView],
      providers: [provideCopilotKit({})],
    });
  });

  afterEach(() => writeText.mockClear());

  const render = (inputs: Record<string, unknown> = {}) => {
    const fixture = TestBed.createComponent(CopilotChatMessageView);
    fixture.componentRef.setInput("messages", messages);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    return {
      toolbars: () =>
        Array.from(
          element.querySelectorAll('[data-testid="copilot-assistant-toolbar"]'),
        ) as HTMLElement[],
    };
  };

  it("shows one toolbar per reply by default, copying the whole reply", async () => {
    const { toolbars } = render();
    expect(toolbars()).toHaveLength(2);

    toolbars()[0]!.querySelector("button")!.click();
    await vi.waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "Let me look that up.\n\nHere is the plan.",
      ),
    );
  });

  it("hides the latest reply's toolbar while it is still running", () => {
    expect(render({ isRunning: true }).toolbars()).toHaveLength(1);
    expect(render({ isLoading: true }).toolbars()).toHaveLength(1);
  });

  it('keeps every toolbar visible while running with toolbarScope="message"', () => {
    const { toolbars } = render({
      isRunning: true,
      assistantMessageToolbarScope: "message",
    });
    expect(toolbars()).toHaveLength(3);
  });

  it('gives every assistant message a toolbar with toolbarScope="message"', () => {
    const { toolbars } = render({ assistantMessageToolbarScope: "message" });
    // a2 has no text, so it has no toolbar in either scope.
    expect(toolbars()).toHaveLength(3);
  });
});
