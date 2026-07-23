import { Injectable, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { CopilotChatView } from "../copilot-chat-view";
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

  it("sizes the default scroll view as the flex child that owns vertical scrolling", () => {
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

    const element = fixture.nativeElement as HTMLElement;
    const scrollViewHost = element.querySelector(
      "copilot-chat-view-scroll-view",
    );
    const scrollContainer = scrollViewHost?.querySelector("div");

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
});
