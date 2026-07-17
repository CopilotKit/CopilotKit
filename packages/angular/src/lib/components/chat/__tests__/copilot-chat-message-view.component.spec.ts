import {
  Component,
  EnvironmentInjector,
  runInInjectionContext,
  signal,
} from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotChatMessageView } from "../copilot-chat-message-view";
import type { ActivityMessage, Message, ReasoningMessage } from "@ag-ui/core";
import { CopilotKit } from "../../../copilotkit";
import { z } from "zod";
import { PrimaryActivityRenderer } from "../../activity/__tests__/activity-renderer-stubs";
import type { RenderActivityMessageConfig } from "../../../activity-renderer";

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

const reasoningMessage: ReasoningMessage = {
  id: "reasoning-1",
  role: "reasoning",
  content: "**Designing dashboard layout** I should choose the right renderer.",
};

@Component({
  imports: [CopilotChatMessageView],
  template: `
    <copilot-chat-message-view
      [messages]="messages"
      [isLoading]="isLoading"
      [showCursor]="showCursor"
    />
  `,
})
class MessageViewHostComponent {
  messages: Message[] = [];
  isLoading = false;
  showCursor = false;
}

type MessageViewTestHarness = CopilotChatMessageView & {
  messages: () => Message[];
  isLoading: () => boolean;
  showCursor: () => boolean;
};

describe("CopilotChatMessageView", () => {
  let injector: EnvironmentInjector;
  let component: CopilotChatMessageView;
  let harness: MessageViewTestHarness;
  const renderers = signal<RenderActivityMessageConfig[]>([]);
  const getAgent = vi.fn();

  beforeEach(() => {
    TestBed.resetTestingModule();
    renderers.set([]);
    getAgent.mockReset();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CopilotKit,
          useValue: {
            activityMessageRenderConfigs: renderers.asReadonly(),
            getAgent,
          },
        },
      ],
    });
    injector = TestBed.inject(EnvironmentInjector);
    component = runInInjectionContext(
      injector,
      () => new CopilotChatMessageView(),
    );
    harness = component as unknown as MessageViewTestHarness;
    harness.messages = () => [userMessage, assistantMessage];
    harness.isLoading = () => false;
    harness.showCursor = () => false;
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

  it("renders activity messages through the activity component", () => {
    const activity: ActivityMessage = {
      id: "activity-1",
      role: "activity",
      activityType: "a2ui-surface",
      content: {},
    };
    renderers.set([
      {
        activityType: "a2ui-surface",
        content: z.object({}),
        component: PrimaryActivityRenderer,
      },
    ]);

    const fixture = TestBed.createComponent(MessageViewHostComponent);
    fixture.componentInstance.messages = [activity];
    fixture.detectChanges();

    const rendered = fixture.nativeElement.querySelector<HTMLElement>(
      '[data-testid="primary-activity"]',
    );
    expect(rendered).not.toBeNull();
    expect(rendered?.getAttribute("data-activity-type")).toBe("a2ui-surface");
  });

  it("renders streaming reasoning messages", () => {
    const fixture = TestBed.createComponent(MessageViewHostComponent);
    fixture.componentInstance.messages = [userMessage, reasoningMessage];
    fixture.componentInstance.isLoading = true;
    fixture.detectChanges();

    const nativeElement: HTMLElement = fixture.nativeElement;
    const reasoningElement = nativeElement.querySelector<HTMLElement>(
      '[data-testid="copilot-chat-reasoning-message"]',
    );
    expect(reasoningElement).not.toBeNull();
    expect(nativeElement.textContent).toContain("Thinking…");
    expect(nativeElement.textContent).toContain(
      "I should choose the right renderer.",
    );
    expect(reasoningElement?.querySelector("strong")?.textContent).toBe(
      "Designing dashboard layout",
    );
    const header = reasoningElement?.querySelector<HTMLButtonElement>("button");
    const panel = reasoningElement?.querySelector<HTMLElement>(".cpk\\:grid");
    const chevron = reasoningElement?.querySelector<SVGElement>("svg");
    expect(header?.getAttribute("aria-expanded")).toBe("true");
    expect(panel?.style.gridTemplateRows).toBe("1fr");
    expect(chevron).not.toBeNull();
    expect(chevron?.classList.contains("cpk:size-3.5")).toBe(true);
    expect(chevron?.classList.contains("cpk:rotate-90")).toBe(true);
    expect(
      (reasoningElement?.textContent ?? "")
        .split("\n")
        .map((line) => line.trim()),
    ).not.toContain(">");

    header?.click();
    fixture.detectChanges();

    expect(header?.getAttribute("aria-expanded")).toBe("false");
    expect(panel?.style.gridTemplateRows).toBe("0fr");
    expect(chevron?.classList.contains("cpk:rotate-90")).toBe(false);
  });

  it("renders completed reasoning collapsed by default", () => {
    const fixture = TestBed.createComponent(MessageViewHostComponent);
    fixture.componentInstance.messages = [userMessage, reasoningMessage];
    fixture.detectChanges();

    const nativeElement: HTMLElement = fixture.nativeElement;
    const reasoningElement = nativeElement.querySelector<HTMLElement>(
      '[data-testid="copilot-chat-reasoning-message"]',
    );
    const header = reasoningElement?.querySelector<HTMLButtonElement>("button");
    const panel = reasoningElement?.querySelector<HTMLElement>(".cpk\\:grid");
    const chevron = reasoningElement?.querySelector<SVGElement>("svg");

    expect(nativeElement.textContent).toContain("Thought for a few seconds");
    expect(header?.getAttribute("aria-expanded")).toBe("false");
    expect(panel?.style.gridTemplateRows).toBe("0fr");
    expect(chevron?.classList.contains("cpk:size-3.5")).toBe(true);

    header?.click();
    fixture.detectChanges();

    expect(header?.getAttribute("aria-expanded")).toBe("true");
    expect(panel?.style.gridTemplateRows).toBe("1fr");
  });

  it("does not render the chat cursor while the latest message is reasoning", () => {
    const fixture = TestBed.createComponent(MessageViewHostComponent);
    fixture.componentInstance.messages = [reasoningMessage];
    fixture.componentInstance.isLoading = true;
    fixture.componentInstance.showCursor = true;
    fixture.detectChanges();

    const nativeElement: HTMLElement = fixture.nativeElement;
    expect(
      nativeElement.querySelector("copilot-chat-message-view-cursor"),
    ).toBeNull();
  });
});
