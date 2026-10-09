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
});
