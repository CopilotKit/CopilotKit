import { EnvironmentInjector, Injectable, runInInjectionContext } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantMessage } from "../copilot-chat-assistant-message.types";
import { CopilotChatAssistantMessage } from "../copilot-chat-assistant-message";
import { CopilotChatViewHandlers } from "../copilot-chat-view-handlers";

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
    } as any,
  ],
};

describe("CopilotChatAssistantMessage", () => {
  let injector: EnvironmentInjector;
  let component: CopilotChatAssistantMessage;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: CopilotChatViewHandlers, useClass: ViewHandlersStub }],
    });

    injector = TestBed.inject(EnvironmentInjector);
    component = runInInjectionContext(injector, () => new CopilotChatAssistantMessage());
    (component as any).message = () => assistantMessage;
    (component as any).messages = () => [assistantMessage];
    (component as any).isLoading = () => false;
  });

  it("provides markdown renderer context", () => {
    expect(component.markdownRendererContext().content).toBe("Assistant message");
  });

  it("exposes tool call context", () => {
    const context = component.toolCallsViewContext();
    expect(context.message).toBe(assistantMessage);
    expect(context.messages).toEqual([assistantMessage]);
    expect(context.isLoading).toBe(false);
  });

  it("emits thumbs up events", () => {
    const thumbsUpSpy = vi.fn();
    component.thumbsUp.subscribe(thumbsUpSpy);

    component.handleThumbsUp();
    expect(thumbsUpSpy).toHaveBeenCalledWith({ message: assistantMessage });
  });
});
