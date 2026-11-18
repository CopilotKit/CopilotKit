import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it } from "vitest";
import type { ReasoningMessage } from "@ag-ui/core";
import { CopilotChatDefaultLabels } from "@copilotkit/core";
import type { Attachment } from "@copilotkit/shared";

import {
  COPILOT_CHAT_DEFAULT_LABELS,
  injectChatLabels,
  provideCopilotChatLabels,
} from "../../../chat-config";
import { CopilotChatAttachmentQueue } from "../copilot-chat-attachment-queue";
import { CopilotChatReasoningMessage } from "../copilot-chat-reasoning-message";
import { CopilotPopup } from "../../modal/copilot-popup";

@Component({ selector: "test-chat", template: "", standalone: true })
class EmptyChat {}

function labelsInScope() {
  return TestBed.runInInjectionContext(() => injectChatLabels());
}

// Strings an app translates through provideCopilotChatLabels. Both used to be
// hard-coded English.
const germanLabels = provideCopilotChatLabels({
  reasoningMessageThinkingLabel: "Denkt nach…",
  attachmentRemoveButtonLabel: "Anhang entfernen",
});

describe("chat labels", () => {
  afterEach(() => TestBed.resetTestingModule());

  it("defaults to the same text as React and Vue", () => {
    const labels = labelsInScope();
    expect(labels).toBe(CopilotChatDefaultLabels);
    expect(COPILOT_CHAT_DEFAULT_LABELS).toBe(CopilotChatDefaultLabels);
    expect(labels.chatInputToolbarAddButtonLabel).toBe("Add attachments");
    expect(labels.userMessageToolbarPreviousBranchLabel).toBe(
      "Previous branch",
    );
    expect(labels.userMessageToolbarNextBranchLabel).toBe("Next branch");
    expect(labels.chatInputToolbarStopButtonLabel).toBe("Stop");
  });

  it("keeps every other key when an app changes one", () => {
    TestBed.configureTestingModule({
      providers: [provideCopilotChatLabels({ chatInputPlaceholder: "Frag" })],
    });
    const labels = labelsInScope();
    expect(labels.chatInputPlaceholder).toBe("Frag");
    expect(Object.keys(labels).sort()).toEqual(
      Object.keys(CopilotChatDefaultLabels).sort(),
    );
    expect(labels.toolCallRunningLabel).toBe("Running {name}");
  });
});

describe("chat strings from labels", () => {
  afterEach(() => TestBed.resetTestingModule());

  it("fills the finished reasoning header from the duration labels", () => {
    TestBed.configureTestingModule({
      providers: [
        provideCopilotChatLabels({
          reasoningMessageThoughtForLabel: "Dachte {duration} nach",
          reasoningMessageDurationFewSeconds: "ein paar Sekunden",
        }),
      ],
    });
    const message: ReasoningMessage = {
      id: "reasoning-1",
      role: "reasoning",
      content: "Plan",
    };
    const fixture = TestBed.createComponent(CopilotChatReasoningMessage);
    fixture.componentRef.setInput("message", message);
    fixture.componentRef.setInput("messages", [message]);
    fixture.detectChanges();

    const header = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="reasoning-block"]',
    );
    expect(header?.textContent?.trim()).toBe("Dachte ein paar Sekunden nach");
  });

  it("names the popup toggle, close button and title", async () => {
    TestBed.configureTestingModule({
      providers: [
        provideCopilotChatLabels({
          chatToggleCloseLabel: "Chat schliessen",
          modalHeaderCloseButtonLabel: "Schliessen",
          modalHeaderTitle: "Assistent",
        }),
      ],
    });
    const fixture = TestBed.createComponent(CopilotPopup);
    fixture.componentRef.setInput("chatComponent", EmptyChat);
    fixture.detectChanges();
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;

    expect(
      root
        .querySelector("[data-copilot-popup-toggle]")
        ?.getAttribute("aria-label"),
    ).toBe("Chat schliessen");
    expect(
      root
        .querySelector(".cpk-modal-header-close-button")
        ?.getAttribute("aria-label"),
    ).toBe("Schliessen");
    expect(
      root.querySelector(".cpk-modal-header-title")?.textContent?.trim(),
    ).toBe("Assistent");
  });

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
