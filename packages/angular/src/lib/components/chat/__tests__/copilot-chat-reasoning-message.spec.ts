import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";

import { CopilotChatReasoningMessage } from "../copilot-chat-reasoning-message";

describe("CopilotChatReasoningMessage", () => {
  it("exposes the shared reasoning probe marker", async () => {
    await TestBed.configureTestingModule({
      imports: [CopilotChatReasoningMessage],
    }).compileComponents();
    const fixture = TestBed.createComponent(CopilotChatReasoningMessage);
    fixture.componentRef.setInput("message", {
      id: "reasoning-1",
      role: "reasoning",
      content: "I compared the available evidence.",
    });
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[data-testid="reasoning-block"]'),
    ).not.toBeNull();
  });

  it("falls back to comparing against the last entry of `messages` when `isLatest` is unset", async () => {
    await TestBed.configureTestingModule({
      imports: [CopilotChatReasoningMessage],
    }).compileComponents();
    const fixture = TestBed.createComponent(CopilotChatReasoningMessage);
    const message = {
      id: "reasoning-1",
      role: "reasoning" as const,
      content: "",
    };
    fixture.componentRef.setInput("message", message);
    fixture.componentRef.setInput("messages", [message]);
    fixture.componentRef.setInput("isRunning", true);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain("Thinking…");
  });

  it("lets an explicit `isLatest` override the `messages`-based fallback (#1959)", async () => {
    await TestBed.configureTestingModule({
      imports: [CopilotChatReasoningMessage],
    }).compileComponents();
    const fixture = TestBed.createComponent(CopilotChatReasoningMessage);
    const message = {
      id: "reasoning-1",
      role: "reasoning" as const,
      content: "",
    };
    // `messages` says this is the last message, but the message view passes
    // an explicit `isLatest: false` when `transformMessages` moved it off
    // the tail of the rendered list.
    fixture.componentRef.setInput("message", message);
    fixture.componentRef.setInput("messages", [message]);
    fixture.componentRef.setInput("isRunning", true);
    fixture.componentRef.setInput("isLatest", false);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain("Thinking…");
  });
});
