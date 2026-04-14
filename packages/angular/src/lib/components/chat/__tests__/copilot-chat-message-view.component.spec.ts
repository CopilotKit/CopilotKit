import { EnvironmentInjector, runInInjectionContext } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotChatMessageView } from "../copilot-chat-message-view";
import type { Message } from "@ag-ui/core";

const assistantMessage: Message = {
  id: "assistant-1",
  role: "assistant",
  content: "Assistant reply",
};

const userMessage: Message = {
  id: "user-1",
  role: "user",
  content: "User prompt",
};

describe("CopilotChatMessageView", () => {
  let injector: EnvironmentInjector;
  let component: CopilotChatMessageView;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    injector = TestBed.inject(EnvironmentInjector);
    component = runInInjectionContext(injector, () => new CopilotChatMessageView());
    (component as any).messages = () => [userMessage, assistantMessage];
    (component as any).isLoading = () => false;
    (component as any).showCursor = () => false;
  });

  it("merges assistant props for slot overrides", () => {
    const props = component.mergeAssistantProps(assistantMessage);
    expect(props.message).toBe(assistantMessage);
    expect(props.messages).toEqual([userMessage, assistantMessage]);
    expect(props.isLoading).toBe(false);
  });

  it("merges user props", () => {
    const props = component.mergeUserProps(userMessage);
    expect(props.message).toBe(userMessage);
  });

  it("forwards assistant events", () => {
    const thumbsUpSpy = vi.fn();
    component.assistantMessageThumbsUp.subscribe(thumbsUpSpy);

    component.handleAssistantThumbsUp({ message: assistantMessage });
    expect(thumbsUpSpy).toHaveBeenCalledWith({ message: assistantMessage });
  });
});
