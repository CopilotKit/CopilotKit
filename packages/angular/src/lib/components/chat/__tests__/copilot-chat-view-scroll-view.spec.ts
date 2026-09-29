import { Component, input } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { CopilotChatViewScrollView } from "../copilot-chat-view-scroll-view";
import { provideCopilotKit } from "../../../config";
import type { Message } from "@ag-ui/core";

/**
 * A custom `messageView` slot component. Declaring a `transformMessages`
 * input lets `copilot-slot` bind it from `messageViewContext()` (#1959),
 * mirroring how a real custom message view would consume the transform.
 */
@Component({
  selector: "test-message-view",
  template: `
    <div data-testid="custom-message-view">{{ visibleContent() }}</div>
  `,
})
class TestMessageView {
  readonly messages = input<Message[]>([]);
  readonly transformMessages = input<
    ((messages: Message[]) => Message[]) | undefined
  >();

  visibleContent(): string {
    const transform = this.transformMessages();
    const list = transform ? transform(this.messages()) : this.messages();
    return list.map((m) => m.content).join(",");
  }
}

describe("CopilotChatViewScrollView transformMessages", () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: () => undefined,
    });
    TestBed.configureTestingModule({
      imports: [CopilotChatViewScrollView],
      providers: [
        provideCopilotKit({
          licenseKey: "ck_pub_00000000000000000000000000000000",
        }),
      ],
    });
  });

  it("includes transformMessages in messageViewContext()", () => {
    const fixture = TestBed.createComponent(CopilotChatViewScrollView);
    const transform = (list: Message[]) => list;
    fixture.componentRef.setInput("messages", []);
    fixture.componentRef.setInput("transformMessages", transform);
    fixture.detectChanges();

    expect(
      fixture.componentInstance.messageViewContext().transformMessages,
    ).toBe(transform);
  });

  it("forwards transformMessages to a custom messageView component", () => {
    const fixture = TestBed.createComponent(CopilotChatViewScrollView);
    const messages: Message[] = [
      { id: "u1", role: "user", content: "keep" } as Message,
      { id: "u2", role: "user", content: "drop" } as Message,
    ];
    fixture.componentRef.setInput("messages", messages);
    fixture.componentRef.setInput("messageView", TestMessageView);
    fixture.componentRef.setInput("transformMessages", (list: Message[]) =>
      list.filter((m) => m.content !== "drop"),
    );
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const custom = el.querySelector<HTMLElement>(
      '[data-testid="custom-message-view"]',
    );
    expect(custom?.textContent).toBe("keep");
  });
});
