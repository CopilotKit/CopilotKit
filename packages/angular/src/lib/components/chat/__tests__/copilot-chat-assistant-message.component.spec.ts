import { Injectable } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import type { ComponentFixture } from "@angular/core/testing";
import type { Message } from "@ag-ui/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantMessage } from "../copilot-chat-assistant-message.types";
import { CopilotChatAssistantMessage } from "../copilot-chat-assistant-message";
import { CopilotChatViewHandlers } from "../copilot-chat-view-handlers";
import { provideCopilotKit } from "../../../config";

@Injectable()
class ViewHandlersStub extends CopilotChatViewHandlers {
  constructor() {
    super();
    this.hasAssistantThumbsUpHandler.set(true);
  }
}

const assistantMessage: AssistantMessage = {
  id: "assistant-1",
  role: "assistant",
  content: "Assistant message",
  toolCalls: [
    {
      id: "call-1",
      type: "function",
      function: { name: "demo", arguments: "{}" },
    },
  ],
};

const userMessage: Message = { id: "user-1", role: "user", content: "Hi" };

describe("CopilotChatAssistantMessage", () => {
  let fixture: ComponentFixture<CopilotChatAssistantMessage>;

  /** Renders the message with `inputs` and returns whether a toolbar shows. */
  function hasToolbar(inputs: {
    message?: AssistantMessage;
    messages?: Message[];
    isLoading?: boolean;
  }) {
    fixture.componentRef.setInput(
      "message",
      inputs.message ?? assistantMessage,
    );
    fixture.componentRef.setInput(
      "messages",
      inputs.messages ?? [assistantMessage],
    );
    fixture.componentRef.setInput("isLoading", inputs.isLoading ?? false);
    fixture.detectChanges();
    return (
      fixture.nativeElement.querySelector(
        "[copilotChatAssistantMessageToolbar]",
      ) !== null
    );
  }

  /** Creates the component; `enableInspector` turns its shortcut on or off. */
  async function setUp({ enableInspector = false } = {}) {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [CopilotChatAssistantMessage],
      providers: [
        provideCopilotKit({ enableInspector }),
        { provide: CopilotChatViewHandlers, useClass: ViewHandlersStub },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(CopilotChatAssistantMessage);
    fixture.componentRef.setInput("message", assistantMessage);
    fixture.componentRef.setInput("messages", [assistantMessage]);
  }

  beforeEach(() => setUp());

  it("provides markdown renderer context", () => {
    expect(fixture.componentInstance.markdownRendererContext().content).toBe(
      "Assistant message",
    );
  });

  it("exposes stable cross-frontend message classes", () => {
    const { computedClass } = fixture.componentInstance;
    expect(computedClass()).toContain("copilotKitMessage");
    expect(computedClass()).toContain("copilotKitAssistantMessage");
  });

  it("exposes tool call context", () => {
    const context = fixture.componentInstance.toolCallsViewContext();
    expect(context.message).toBe(assistantMessage);
    expect(context.messages).toEqual([assistantMessage]);
    expect(context.isLoading).toBe(false);
  });

  it("emits thumbs up events", () => {
    const thumbsUpSpy = vi.fn();
    fixture.componentInstance.thumbsUp.subscribe(thumbsUpSpy);

    fixture.componentInstance.handleThumbsUp();
    expect(thumbsUpSpy).toHaveBeenCalledWith({ message: assistantMessage });
  });

  describe("toolbar", () => {
    it("shows for a finished message with text", () => {
      expect(hasToolbar({})).toBe(true);
    });

    it("hides while the latest message streams", () => {
      expect(hasToolbar({ isLoading: true })).toBe(false);
    });

    it("shows for an older message while the agent runs", () => {
      expect(
        hasToolbar({
          isLoading: true,
          messages: [assistantMessage, userMessage],
        }),
      ).toBe(true);
    });

    it("hides for a message without text", () => {
      expect(
        hasToolbar({ message: { ...assistantMessage, content: "  " } }),
      ).toBe(false);
    });

    it("shows without text for the Inspector shortcut", async () => {
      await setUp({ enableInspector: true });

      expect(
        hasToolbar({ message: { ...assistantMessage, content: "  " } }),
      ).toBe(true);
    });
  });
});
