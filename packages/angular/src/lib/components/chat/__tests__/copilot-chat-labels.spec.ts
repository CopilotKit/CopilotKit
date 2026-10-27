import { Component, type Type } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it } from "vitest";
import type { ReasoningMessage } from "@ag-ui/core";
import type { Attachment } from "@copilotkit/shared";

import { provideCopilotChatLabels } from "../../../chat-config";
import { CopilotPopup } from "../../modal/copilot-popup";
import { CopilotSidebar } from "../../modal/copilot-sidebar";
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
      ".copilotKitAttachmentQueueRemoveButton",
    );
    expect(button?.getAttribute("aria-label")).toBe("Anhang entfernen");
  });
});

@Component({ selector: "test-chat", template: "{{ label }}" })
class TestChat {
  protected readonly label = "Chat";
}

describe("popup and sidebar labels", () => {
  afterEach(() => {
    document.body.style.marginInlineStart = "";
    document.body.style.marginInlineEnd = "";
    TestBed.resetTestingModule();
  });

  // The launcher (toggle) and the header's close button of an open surface.
  async function render(surface: Type<CopilotPopup | CopilotSidebar>) {
    const fixture = TestBed.createComponent(surface);
    fixture.componentRef.setInput("chatComponent", TestChat);
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const names = () => ({
      toggle: element
        .querySelector(
          "[data-copilot-popup-toggle], [data-copilot-sidebar-toggle]",
        )
        ?.getAttribute("aria-label"),
      close: element
        .querySelector(
          ".copilot-modal-header button, .copilot-sidebar-header button",
        )
        ?.getAttribute("aria-label"),
    });
    return { fixture, names };
  }

  it.each([
    ["popup", CopilotPopup],
    ["sidebar", CopilotSidebar],
  ] as const)("names the %s buttons from labels", async (_, surface) => {
    TestBed.configureTestingModule({
      providers: [
        provideCopilotChatLabels({
          chatToggleOpenLabel: "Chat öffnen",
          chatToggleCloseLabel: "Chat schließen",
          modalHeaderCloseButtonLabel: "Schließen",
        }),
      ],
    });
    const { fixture, names } = await render(surface);
    expect(names()).toEqual({ toggle: "Chat schließen", close: "Schließen" });

    fixture.componentRef.setInput("open", false);
    fixture.detectChanges();
    expect(names().toggle).toBe("Chat öffnen");
  });

  it.each([
    ["popup", CopilotPopup, "chat"],
    ["sidebar", CopilotSidebar, "sidebar"],
  ] as const)(
    "keeps the %s's own English names when the labels are not set",
    async (_, surface, noun) => {
      const { fixture, names } = await render(surface);
      expect(names()).toEqual({
        toggle: `Close Copilot ${noun}`,
        close: `Close Copilot ${noun}`,
      });

      fixture.componentRef.setInput("open", false);
      fixture.detectChanges();
      expect(names().toggle).toBe(`Open Copilot ${noun}`);
    },
  );
});
