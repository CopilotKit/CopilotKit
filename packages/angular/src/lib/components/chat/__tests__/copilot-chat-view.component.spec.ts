import { Component, Injectable, input, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { beforeEach, describe, expect, it } from "vitest";
import { CopilotChatView } from "../copilot-chat-view";
import { CopilotChatToolCallsView } from "../copilot-chat-tool-calls-view";
import { ChatState } from "../../../chat-state";
import { provideCopilotKit } from "../../../config";
import type { Message } from "@ag-ui/core";

@Injectable()
class ChatStateStub extends ChatState {
  readonly inputValue = signal("");

  submitInput(value: string): void {
    this.inputValue.set(value);
  }

  changeInput(value: string): void {
    this.inputValue.set(value);
  }
}

@Component({
  selector: "test-input-container",
  template: `
    <div data-testid="custom-input-container"></div>
  `,
})
class TestInputContainer {
  readonly showSuggestions = input(false);
}

@Component({
  selector: "test-disclaimer",
  template: `
    <a href="#terms">Terms</a>
  `,
})
class TestDisclaimer {}

/** Lets the scroll view's mount hook run so its interactive branch renders. */
const mounted = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("CopilotChatView", () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: () => undefined,
    });
    TestBed.configureTestingModule({
      imports: [CopilotChatView],
      providers: [
        provideCopilotKit({
          licenseKey: "ck_pub_00000000000000000000000000000000",
        }),
        { provide: ChatState, useClass: ChatStateStub },
      ],
    });
  });

  it("renders the React-parity welcome screen for empty stateless chats", () => {
    const fixture = TestBed.createComponent(CopilotChatView);

    fixture.componentRef.setInput("messages", []);
    fixture.componentRef.setInput("hasExplicitThreadId", false);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(
      element.querySelector('[data-testid="copilot-welcome-screen"]'),
    ).not.toBeNull();
    expect(element.textContent).toContain("How can I help you today?");
  });

  it("docks suggestions above the input in a conversation and under the greeting on the welcome screen", () => {
    const chatState = TestBed.inject(ChatState);
    chatState.suggestions.set([
      { title: "Draft a reply", message: "Draft a reply", isLoading: false },
    ]);

    const welcome = TestBed.createComponent(CopilotChatView);
    welcome.componentRef.setInput("messages", []);
    welcome.detectChanges();
    const welcomeEl = welcome.nativeElement as HTMLElement;
    // Greeting, cards, then the input: one centered block.
    const content = welcomeEl.querySelector(".copilotKitWelcomeScreenContent");
    const [greeting, cards, input] = Array.from(content?.children ?? []);
    expect(greeting?.textContent).toContain("How can I help you today?");
    expect(
      cards?.querySelector(
        '[data-testid="copilot-suggestions"][data-appearance="cards"]',
      ),
    ).not.toBeNull();
    expect(input?.querySelector("copilot-chat-input")).not.toBeNull();

    const chat = TestBed.createComponent(CopilotChatView);
    chat.componentRef.setInput("messages", [
      { id: "u1", role: "user", content: "Hi" },
      { id: "a1", role: "assistant", content: "Hello!" },
    ] satisfies Message[]);
    chat.detectChanges();
    const chatEl = chat.nativeElement as HTMLElement;
    expect(
      chatEl.querySelector(
        'copilot-chat-view-input-container [data-testid="copilot-suggestions"][data-appearance="pills"]',
      ),
    ).not.toBeNull();
    expect(
      chatEl.querySelector(
        'copilot-chat-view-scroll-view [data-testid="copilot-suggestions"]',
      ),
    ).toBeNull();

    chat.componentRef.setInput("isRunning", true);
    chat.detectChanges();
    expect(
      chatEl.querySelector('[data-testid="copilot-suggestions"]'),
    ).toBeNull();
  });

  it("plays the intro on the welcome screen only, unless turned off", () => {
    const welcome = TestBed.createComponent(CopilotChatView);
    welcome.componentRef.setInput("messages", []);
    welcome.detectChanges();
    const welcomeEl = welcome.nativeElement as HTMLElement;
    expect(welcomeEl.hasAttribute("data-intro")).toBe(true);
    expect(welcomeEl.querySelectorAll(".cpk-intro")).toHaveLength(2);
    expect(welcomeEl.querySelector(".cpk-intro-stagger")).not.toBeNull();

    // No intro on the conversation: header, message list and docked input.
    const chat = TestBed.createComponent(CopilotChatView);
    chat.componentRef.setInput("messages", [
      { id: "u1", role: "user", content: "Hi" },
    ] satisfies Message[]);
    chat.detectChanges();
    expect(
      (chat.nativeElement as HTMLElement).querySelector(
        ".cpk-intro, .cpk-intro-stagger",
      ),
    ).toBeNull();

    welcome.componentRef.setInput("introAnimation", false);
    welcome.detectChanges();
    expect(welcomeEl.hasAttribute("data-intro")).toBe(false);
  });

  it("suppresses the welcome screen when a thread is explicitly selected", () => {
    const fixture = TestBed.createComponent(CopilotChatView);

    fixture.componentRef.setInput("messages", []);
    fixture.componentRef.setInput("hasExplicitThreadId", true);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(
      element.querySelector('[data-testid="copilot-welcome-screen"]'),
    ).toBeNull();
  });

  it("sizes the default scroll view as the flex child that owns vertical scrolling", async () => {
    const fixture = TestBed.createComponent(CopilotChatView);
    const messages: Message[] = [
      {
        id: "user-1",
        role: "user",
        content: "Hello",
      },
    ];

    fixture.componentRef.setInput("messages", messages);
    fixture.detectChanges();
    // Flush the scroll view's mount hook so the interactive branch renders
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const scrollViewHost = element.querySelector(
      "copilot-chat-view-scroll-view",
    );
    const scrollContainer = scrollViewHost?.querySelector("[cdkScrollable]");

    expect(scrollViewHost?.classList.contains("cpk:flex-1")).toBe(true);
    expect(scrollViewHost?.classList.contains("cpk:min-h-0")).toBe(true);
    expect(scrollContainer?.classList.contains("cpk:flex-1")).toBe(true);
    expect(scrollContainer?.classList.contains("cpk:min-h-0")).toBe(true);
    expect(scrollContainer?.classList.contains("cpk:overflow-y-auto")).toBe(
      true,
    );
  });

  it("reserves React-parity bottom space in the scroll content", async () => {
    const fixture = TestBed.createComponent(CopilotChatView);
    const messages: Message[] = [
      {
        id: "user-1",
        role: "user",
        content: "Hello",
      },
    ];

    fixture.componentRef.setInput("messages", messages);
    fixture.detectChanges();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const scrollContent = Array.from(
      element.querySelectorAll("copilot-chat-view-scroll-view div"),
    ).find((node) => node.style.paddingBottom !== "");

    expect(scrollContent?.style.paddingBottom).toBe("32px");
  });

  it("sizes the mounted scroll wrapper to its container, not the viewport", async () => {
    const fixture = TestBed.createComponent(CopilotChatView);
    const messages: Message[] = [
      {
        id: "user-1",
        role: "user",
        content: "Hello",
      },
    ];

    fixture.componentRef.setInput("messages", messages);
    fixture.detectChanges();
    // Flush the scroll view's hasMounted timer so the mounted branch renders
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const wrapper = element.querySelector(
      "copilot-chat-view-scroll-view > div",
    );

    // A viewport-based height (calc(100vh - 9rem)) overshoots any embedded
    // container; the wrapper must track the panel it is placed in instead.
    expect(wrapper?.className).toContain("cpk:h-full");
    expect(wrapper?.className).toContain("cpk:max-h-full");
    expect(wrapper?.className).not.toContain("100vh");
  });

  it("measures the floating input after transitioning from welcome screen to chat", async () => {
    // Regression: measurement used to run once in ngAfterViewInit. When the
    // chat mounted on the welcome screen (no input overlay in the DOM), all
    // retries expired and inputContainerHeight stayed 0 forever — messages
    // hid under the floating input and the scroll-to-bottom button sat on
    // top of it.
    const fixture = TestBed.createComponent(CopilotChatView);
    fixture.componentRef.setInput("messages", []);
    fixture.componentRef.setInput("hasExplicitThreadId", false);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(
      element.querySelector('[data-testid="copilot-welcome-screen"]'),
    ).not.toBeNull();

    // jsdom reports offsetHeight as 0; give elements a real footprint so the
    // measurement can succeed once the overlay exists.
    const originalOffsetHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetHeight",
    );
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        return 132;
      },
    });

    try {
      const messages: Message[] = [
        {
          id: "user-1",
          role: "user",
          content: "Hello",
        },
      ];
      fixture.componentRef.setInput("messages", messages);
      fixture.detectChanges();

      // Flush the deferred measurement (scheduled at 0ms when the overlay
      // branch mounts) plus the scroll view's hasMounted timer.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
      fixture.detectChanges();

      const scrollContent = Array.from(
        element.querySelectorAll<HTMLElement>(
          "copilot-chat-view-scroll-view div",
        ),
      ).find((node) => node.style.paddingBottom !== "");

      // measured input height (132) + default reserve (32)
      expect(scrollContent?.style.paddingBottom).toBe("164px");

      // Returning to the welcome screen and starting a new chat re-measures
      // when the overlay mounts again.
      fixture.componentRef.setInput("messages", []);
      fixture.detectChanges();
      fixture.componentRef.setInput("messages", messages);
      fixture.detectChanges();
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
      fixture.detectChanges();

      const remeasured = Array.from(
        element.querySelectorAll<HTMLElement>(
          "copilot-chat-view-scroll-view div",
        ),
      ).find((node) => node.style.paddingBottom !== "");
      expect(remeasured?.style.paddingBottom).toBe("164px");
    } finally {
      if (originalOffsetHeight) {
        Object.defineProperty(
          HTMLElement.prototype,
          "offsetHeight",
          originalOffsetHeight,
        );
      } else {
        delete (HTMLElement.prototype as any).offsetHeight;
      }
    }
  });

  it("keeps suggestions in the scroll view when a custom input container replaces the default", async () => {
    const chatState = TestBed.inject(ChatState);
    chatState.suggestions.set([
      { title: "Draft a reply", message: "Draft a reply", isLoading: false },
    ]);
    const fixture = TestBed.createComponent(CopilotChatView);
    fixture.componentRef.setInput("messages", [
      { id: "u1", role: "user", content: "Hi" },
    ] satisfies Message[]);
    fixture.componentRef.setInput(
      "inputContainerComponent",
      TestInputContainer,
    );
    fixture.detectChanges();
    await mounted();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(
      element.querySelector('[data-testid="custom-input-container"]'),
    ).not.toBeNull();
    // Rendered once, below the messages; the custom container isn't asked to.
    expect(
      element.querySelectorAll('[data-testid="copilot-suggestions"]'),
    ).toHaveLength(1);
    expect(
      element.querySelector(
        'copilot-chat-view-scroll-view [data-testid="copilot-suggestions"]',
      ),
    ).not.toBeNull();
    expect(
      fixture.debugElement
        .query(By.directive(TestInputContainer))
        .componentInstance.showSuggestions(),
    ).toBe(false);
  });

  it("keeps a custom disclaimer clickable inside the click-through input overlay", () => {
    const fixture = TestBed.createComponent(CopilotChatView);
    fixture.componentRef.setInput("messages", [
      { id: "u1", role: "user", content: "Hi" },
    ] satisfies Message[]);
    fixture.componentRef.setInput("disclaimerComponent", TestDisclaimer);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const overlay = element.querySelector(
      '[data-testid="copilot-input-overlay"]',
    )!;
    expect(overlay.className).toContain("cpk:pointer-events-none");
    const link = overlay.querySelector('a[href="#terms"]')!;
    expect(link.closest(".cpk\\:pointer-events-auto")).not.toBeNull();
  });

  it("keeps a custom scroll-to-bottom button clickable", async () => {
    const fixture = TestBed.createComponent(CopilotChatView);
    fixture.componentRef.setInput("messages", [
      { id: "u1", role: "user", content: "Hi" },
    ] satisfies Message[]);
    fixture.componentRef.setInput("autoScroll", false);
    fixture.componentRef.setInput(
      "scrollToBottomButtonComponent",
      TestDisclaimer,
    );
    fixture.detectChanges();
    await mounted();
    const scrollView = fixture.debugElement.query(
      By.css("copilot-chat-view-scroll-view"),
    ).componentInstance;
    scrollView.showScrollButton.set(true);
    fixture.detectChanges();

    const button = (fixture.nativeElement as HTMLElement).querySelector(
      'copilot-chat-view-scroll-view a[href="#terms"]',
    )!;
    expect(button.closest(".cpk\\:pointer-events-none")).not.toBeNull();
    expect(button.closest(".cpk\\:pointer-events-auto")).not.toBeNull();
  });

  it("leaves tool-call statuses alone while the agent runs", async () => {
    const fixture = TestBed.createComponent(CopilotChatView);
    fixture.componentRef.setInput("messages", [
      { id: "u1", role: "user", content: "Weather?" },
      {
        id: "a1",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "tc1",
            type: "function",
            function: { name: "weather", arguments: '{"city":"Par' },
          },
        ],
      },
    ] satisfies Message[]);
    fixture.componentRef.setInput("isRunning", true);
    fixture.componentRef.setInput("showCursor", true);
    fixture.detectChanges();
    await mounted();
    fixture.detectChanges();

    const toolCalls = fixture.debugElement.query(
      By.directive(CopilotChatToolCallsView),
    ).componentInstance as CopilotChatToolCallsView;
    expect(toolCalls.isLoading()).toBe(false);
  });

  it("forwards inlineCursor and userMessageMarkdown to the transcript", async () => {
    const fixture = TestBed.createComponent(CopilotChatView);
    fixture.componentRef.setInput("messages", [
      { id: "u1", role: "user", content: "Use `map()`\nplease" },
      { id: "a1", role: "assistant", content: "Writing" },
    ] satisfies Message[]);
    fixture.componentRef.setInput("isRunning", true);
    fixture.componentRef.setInput("showCursor", true);
    fixture.detectChanges();
    await mounted();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const bubble = () =>
      element.querySelector("copilot-chat-user-message-renderer")!;
    expect(element.querySelector("[data-streaming-cursor]")).not.toBeNull();
    expect(bubble().querySelector("code")).not.toBeNull();

    fixture.componentRef.setInput("inlineCursor", false);
    fixture.componentRef.setInput("userMessageMarkdown", false);
    fixture.detectChanges();
    expect(element.querySelector("[data-streaming-cursor]")).toBeNull();
    expect(
      element.querySelector('[data-testid="copilot-loading-cursor"]'),
    ).not.toBeNull();
    expect(bubble().querySelector("code")).toBeNull();
    expect(bubble().className).toContain("cpk:whitespace-pre-wrap");
    expect(bubble().textContent).toBe("Use `map()`\nplease");
  });

  it("forwards composer settings to the input on both screens", async () => {
    const fixture = TestBed.createComponent(CopilotChatView);
    fixture.componentRef.setInput("messages", []);
    fixture.componentRef.setInput("inputLayout", "stacked");
    fixture.componentRef.setInput("highlightMarkdown", false);
    fixture.componentRef.setInput("textAreaMaxRows", 3);
    fixture.detectChanges();
    TestBed.tick();

    const element = fixture.nativeElement as HTMLElement;
    const check = () => {
      const input = fixture.debugElement.query(
        By.css("copilot-chat-input"),
      ).componentInstance;
      expect(input.layout()).toBe("stacked");
      expect(input.highlightMarkdown()).toBe(false);
      expect(input.textAreaMaxRows()).toBe(3);
      expect(
        element.querySelector('[data-testid="copilot-chat-textarea-preview"]'),
      ).toBeNull();
    };
    check();

    fixture.componentRef.setInput("messages", [
      { id: "u1", role: "user", content: "Hi" },
    ] satisfies Message[]);
    fixture.detectChanges();
    TestBed.tick();
    check();
  });
});
