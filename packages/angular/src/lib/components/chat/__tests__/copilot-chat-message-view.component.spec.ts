import {
  Component,
  EnvironmentInjector,
  input,
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
  standalone: true,
  template: `
    <div data-testid="custom-reasoning">{{ message().content }}</div>
  `,
})
class TestReasoningMessage {
  readonly message = input.required<ReasoningMessage>();
}

@Component({
  standalone: true,
  template: `
    <div data-testid="transcript-children">{{ messages().length }} messages</div>
  `,
})
class TestTranscriptChildren {
  readonly messages = input<Message[]>([]);
}

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
  it("renders transcript children after the message collection", () => {
    const fixture = TestBed.createComponent(CopilotChatMessageView);
    fixture.componentRef.setInput("messages", [userMessage]);
    fixture.componentRef.setInput("childrenComponent", TestTranscriptChildren);
    fixture.detectChanges();

    const children = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLElement>('[data-testid="transcript-children"]');
    expect(children?.textContent).toContain("1 messages");
  });

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
      imports: [MessageViewHostComponent],
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

  it("renders canonical cross-frontend message markers", () => {
    const fixture = TestBed.createComponent(MessageViewHostComponent);
    fixture.componentInstance.messages = [userMessage, assistantMessage];
    fixture.detectChanges();

    const assistant = fixture.nativeElement.querySelector(
      '[data-testid="copilot-assistant-message"]',
    );
    expect(assistant?.getAttribute("data-message-role")).toBe("assistant");
    expect(
      fixture.nativeElement.querySelector('[data-message-role="user"]'),
    ).not.toBeNull();
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

  it("renders a custom reasoning-message component with the reasoning context", () => {
    const fixture = TestBed.createComponent(CopilotChatMessageView);
    fixture.componentRef.setInput("messages", [userMessage, reasoningMessage]);
    fixture.componentRef.setInput(
      "reasoningMessageComponent",
      TestReasoningMessage,
    );
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[data-testid="custom-reasoning"]')
        ?.textContent,
    ).toContain("I should choose the right renderer.");
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="copilot-chat-reasoning-message"]',
      ),
    ).toBeNull();
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

/**
 * `transformMessages` reshapes the list before anything downstream sees it:
 * row keys and rendering all work off its output. Tool-result lookups
 * deliberately keep using the untransformed `messages` input, so a transform
 * that hides tool results does not strip them from tool cards. The cursor
 * and the reasoning message's "latest" check also read the rendered list,
 * not the raw `messages` input (#1959).
 */
describe("CopilotChatMessageView transformMessages", () => {
  const hideWorker = (list: Message[]) =>
    list.filter((m) => (m as { name?: string }).name !== "math_expert");

  const supervisorTranscript = [
    { id: "u1", role: "user", content: "what is 2+2" },
    {
      id: "w-1",
      role: "assistant",
      name: "math_expert",
      content: "WORKER_SAYS_FOUR",
    },
    {
      id: "sup-2",
      role: "assistant",
      name: "supervisor",
      content: "SUPERVISOR_SAYS_FOUR",
    },
  ] as Message[];

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: CopilotKit,
          useValue: {
            activityMessageRenderConfigs: signal([]).asReadonly(),
            getAgent: vi.fn(),
          },
        },
      ],
    });
  });

  function renderView(inputs: Record<string, unknown>) {
    const fixture = TestBed.createComponent(CopilotChatMessageView);
    for (const [key, value] of Object.entries(inputs))
      fixture.componentRef.setInput(key, value);
    fixture.detectChanges();
    return fixture;
  }

  it("renders every message when no transform is given", () => {
    const fixture = renderView({ messages: supervisorTranscript });
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      "WORKER_SAYS_FOUR",
    );
  });

  it("hides langgraph-supervisor worker messages by name (#1959)", () => {
    const fixture = renderView({
      messages: supervisorTranscript,
      transformMessages: hideWorker,
    });
    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).not.toContain("WORKER_SAYS_FOUR");
    expect(text).toContain("SUPERVISOR_SAYS_FOUR");
    expect(text).toContain("what is 2+2");
  });

  it("hides a row when a later change adds its name", () => {
    const unnamed = supervisorTranscript.map((m) =>
      m.id === "w-1" ? { ...m, name: undefined } : m,
    ) as Message[];
    const fixture = renderView({
      messages: unnamed,
      transformMessages: hideWorker,
    });
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      "WORKER_SAYS_FOUR",
    );
    fixture.componentRef.setInput("messages", supervisorTranscript);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain(
      "WORKER_SAYS_FOUR",
    );
  });

  it("renders messages in the order the transform returns", () => {
    const fixture = renderView({
      messages: [
        { id: "u1", role: "user", content: "first message" },
        { id: "u2", role: "user", content: "second message" },
      ] as Message[],
      transformMessages: (list: Message[]) => [...list].toReversed(),
    });
    const html = (fixture.nativeElement as HTMLElement).innerHTML;
    expect(html.indexOf("second message")).toBeLessThan(
      html.indexOf("first message"),
    );
  });

  it("keeps the cursor when the last message is hidden", () => {
    const fixture = renderView({
      messages: supervisorTranscript.slice(0, 2),
      showCursor: true,
      transformMessages: hideWorker,
    });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).not.toContain("WORKER_SAYS_FOUR");
    expect(el.querySelector("copilot-chat-message-view-cursor")).not.toBeNull();
  });

  it("shows the cursor when the last rendered message isn't reasoning, even though the raw last message is", () => {
    const fixture = renderView({
      messages: [userMessage, reasoningMessage],
      isLoading: true,
      showCursor: true,
      transformMessages: (list: Message[]) =>
        list.filter((m) => m.role !== "reasoning"),
    });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector("copilot-chat-message-view-cursor")).not.toBeNull();
  });

  it("passes the full message list to a custom layout, and rendered elements", () => {
    const fixture = renderView({
      messages: supervisorTranscript,
      transformMessages: hideWorker,
    });
    const ctx = (
      fixture.componentInstance as unknown as {
        layoutContext: () => {
          messages: Message[];
          messageElements: Message[];
        };
      }
    ).layoutContext();
    expect(ctx.messages.length).toBe(3);
    expect(ctx.messageElements.map((m) => m.id)).toEqual(["u1", "sup-2"]);
  });

  it("keeps the full message list for row lookups when a transform hides messages", () => {
    const injector = TestBed.inject(EnvironmentInjector);
    const component = runInInjectionContext(
      injector,
      () => new CopilotChatMessageView(),
    );
    const harness = component as unknown as {
      messages: () => Message[];
      transformMessages: () => (messages: Message[]) => Message[];
    };
    const toolResult: Message = {
      id: "t-1",
      role: "tool",
      toolCallId: "call-1",
      content: "sunny",
    } as Message;
    harness.messages = () => [userMessage, assistantMessage, toolResult];
    harness.transformMessages = () => (list: Message[]) =>
      list.filter((m) => m.role !== "tool");

    const props = component.mergeAssistantProps(assistantMessage);
    expect(props.messages).toEqual([userMessage, assistantMessage, toolResult]);
  });

  it("keeps the reasoning message streaming only while it is last in the rendered list", () => {
    const fixture = renderView({
      messages: [userMessage, reasoningMessage],
      isLoading: true,
    });
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      "Thinking…",
    );

    fixture.componentRef.setInput("transformMessages", (list: Message[]) => [
      ...list,
      assistantMessage,
    ]);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain(
      "Thinking…",
    );
  });

  it("warns in development when the transform returns a duplicate id", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    renderView({
      messages: [userMessage, assistantMessage],
      transformMessages: (list: Message[]) => [...list, list[0]!],
    });

    expect(
      warn.mock.calls.some(([text]) =>
        String(text).includes(
          `more than one message with id "${userMessage.id}"`,
        ),
      ),
    ).toBe(true);
    warn.mockRestore();
  });

  it("warns only once for a duplicate id that persists across renders", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Defined once, so the re-render below reuses the same function reference.
    const appendFirst = (list: Message[]) => [...list, list[0]!];

    const fixture = renderView({
      messages: [userMessage, assistantMessage],
      transformMessages: appendFirst,
    });

    const countDuplicateWarnings = () =>
      warn.mock.calls.filter(([text]) =>
        String(text).includes(
          `more than one message with id "${userMessage.id}"`,
        ),
      ).length;

    expect(countDuplicateWarnings()).toBe(1);

    // A new messages array that still holds the same duplicate.
    fixture.componentRef.setInput("messages", [
      { ...userMessage },
      { ...assistantMessage },
    ]);
    fixture.detectChanges();

    expect(countDuplicateWarnings()).toBe(1);
    warn.mockRestore();
  });
});
