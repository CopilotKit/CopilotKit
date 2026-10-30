import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it } from "vitest";
import type { ReasoningMessage } from "@ag-ui/core";
import type { Attachment } from "@copilotkit/shared";

import { provideCopilotChatLabels } from "../../../chat-config";
import { CopilotChatAttachmentQueue } from "../copilot-chat-attachment-queue";
import { CopilotChatReasoningMessage } from "../copilot-chat-reasoning-message";

// Strings an app translates through provideCopilotChatLabels. Both used to be
// hard-coded English.
const germanLabels = provideCopilotChatLabels({
  reasoningMessageThinkingLabel: "Denkt nach…",
  attachmentRemoveButtonLabel: "Anhang entfernen",
});

describe("chat strings from labels", () => {
  afterEach(() => TestBed.resetTestingModule());

  it("uses the configured reasoning label while the model reasons", () => {
    TestBed.configureTestingModule({ providers: [germanLabels] });
    const message: ReasoningMessage = {
      id: "reasoning-1",
      role: "reasoning",
      content: "",
    };
    const fixture = TestBed.createComponent(CopilotChatReasoningMessage);
    fixture.componentRef.setInput("message", message);
    fixture.componentRef.setInput("messages", [message]);
    fixture.componentRef.setInput("isRunning", true);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";
    expect(text).toContain("Denkt nach…");
    expect(text).not.toContain("Thinking…");
  });

  it("names the attachment remove button", () => {
    TestBed.configureTestingModule({ providers: [germanLabels] });
    const attachment: Attachment = {
      id: "doc",
      type: "document",
      source: { type: "data", value: "AAAA", mimeType: "application/pdf" },
      filename: "doc.pdf",
      status: "ready",
    };
    const fixture = TestBed.createComponent(CopilotChatAttachmentQueue);
    fixture.componentRef.setInput("attachments", [attachment]);
    fixture.detectChanges();

    const button = (fixture.nativeElement as HTMLElement).querySelector(
      ".cpk-attachment-queue-remove-button",
    );
    expect(button?.getAttribute("aria-label")).toBe("Anhang entfernen");
  });
});
