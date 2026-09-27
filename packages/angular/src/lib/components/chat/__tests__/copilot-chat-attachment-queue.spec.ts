import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";
import type { Attachment } from "@copilotkit/shared";

import { CopilotChatAttachmentQueue } from "../copilot-chat-attachment-queue";

const audio: Attachment = {
  id: "audio-1",
  type: "audio",
  source: { type: "data", value: "UklGRg==", mimeType: "audio/wav" },
  filename: "voice-note.wav",
  size: 2048,
  status: "ready",
};

describe("CopilotChatAttachmentQueue", () => {
  it("renders audio as a chip with a play toggle instead of native controls", async () => {
    await TestBed.configureTestingModule({
      imports: [CopilotChatAttachmentQueue],
    }).compileComponents();
    const fixture = TestBed.createComponent(CopilotChatAttachmentQueue);
    fixture.componentRef.setInput("attachments", [audio]);
    fixture.detectChanges();

    const root: HTMLElement = fixture.nativeElement;
    const toggle = root.querySelector(
      ".copilotKitAttachmentQueueAudioButton",
    ) as HTMLButtonElement;
    expect(toggle.getAttribute("aria-label")).toBe("Play audio");
    expect(root.textContent).toContain("voice-note.wav");
    expect(root.textContent).toContain("2.0 KB");

    const player = root.querySelector("audio") as HTMLAudioElement;
    expect(player.hasAttribute("controls")).toBe(false);
    expect(player.hidden).toBe(true);
  });
});
