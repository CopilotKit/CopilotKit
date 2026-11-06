import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it } from "vitest";
import type { Attachment } from "@copilotkit/shared";

import { provideCopilotChatLabels } from "../../../chat-config";
import { CopilotChatAttachmentQueue } from "../copilot-chat-attachment-queue";
import { CopilotChatAttachmentRenderer } from "../copilot-chat-attachment-renderer";

const image: Attachment = {
  id: "img",
  type: "image",
  source: { type: "url", value: "https://example.com/cat.png" },
  filename: "cat.png",
  status: "ready",
};

const video: Attachment = {
  id: "vid",
  type: "video",
  source: { type: "url", value: "https://example.com/clip.mp4" },
  filename: "clip.mp4",
  status: "ready",
};

const lightbox = () =>
  document.querySelector<HTMLElement>(".cpk-attachment-lightbox");

function renderQueue(attachments: Attachment[]) {
  const fixture = TestBed.createComponent(CopilotChatAttachmentQueue);
  fixture.componentRef.setInput("attachments", attachments);
  fixture.detectChanges();
  document.body.appendChild(fixture.nativeElement);
  return fixture;
}

function escape(): void {
  document.body.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
}

describe("attachment lightbox", () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    document.body.innerHTML = "";
  });

  it("opens a queued image in a modal dialog", () => {
    const fixture = renderQueue([image]);
    const trigger = (fixture.nativeElement as HTMLElement).querySelector(
      "button.cpk-attachment-lightbox-trigger",
    ) as HTMLButtonElement;
    expect(trigger.querySelector("img")?.getAttribute("alt")).toBe("cat.png");

    trigger.click();

    const dialog = lightbox()!;
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute("role")).toBe("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("cat.png");
    const preview = dialog.querySelector(
      "img.cpk-attachment-queue-lightbox-image",
    );
    expect(preview?.getAttribute("src")).toBe(image.source.value);
  });

  it("moves focus to the close button and returns it on Escape", async () => {
    const fixture = renderQueue([image]);
    const trigger = (fixture.nativeElement as HTMLElement).querySelector(
      "button.cpk-attachment-lightbox-trigger",
    ) as HTMLButtonElement;
    trigger.focus();
    trigger.click();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));

    const close = lightbox()!.querySelector(
      ".cpk-attachment-lightbox-close-button",
    ) as HTMLButtonElement;
    expect(close.getAttribute("aria-label")).toBe("Close preview");
    expect(document.activeElement).toBe(close);

    escape();
    expect(lightbox()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on the close button and the backdrop, not on the content", () => {
    const fixture = renderQueue([image]);
    const trigger = (fixture.nativeElement as HTMLElement).querySelector(
      "button.cpk-attachment-lightbox-trigger",
    ) as HTMLButtonElement;

    trigger.click();
    (
      lightbox()!.querySelector(
        ".cpk-attachment-lightbox-close-button",
      ) as HTMLButtonElement
    ).click();
    expect(lightbox()).toBeNull();

    trigger.click();
    (lightbox()!.querySelector("img") as HTMLImageElement).click();
    expect(lightbox()).not.toBeNull();
    lightbox()!.click();
    expect(lightbox()).toBeNull();
  });

  it("plays a queued video in the lightbox from its play button", () => {
    TestBed.configureTestingModule({
      providers: [
        provideCopilotChatLabels({
          attachmentPlayVideoButtonLabel: "Video abspielen",
        }),
      ],
    });
    const fixture = renderQueue([video]);
    const play = (fixture.nativeElement as HTMLElement).querySelector(
      "button.cpk-attachment-queue-video-play-button",
    ) as HTMLButtonElement;
    expect(play.getAttribute("aria-label")).toBe("Video abspielen");
    expect(
      play.querySelector(".cpk-attachment-queue-video-play-icon"),
    ).not.toBeNull();

    play.click();
    const player = lightbox()!.querySelector(
      "video.cpk-attachment-queue-lightbox-video",
    ) as HTMLVideoElement;
    expect(player.getAttribute("src")).toBe(video.source.value);
    expect(player.hasAttribute("controls")).toBe(true);
    expect(player.hasAttribute("autoplay")).toBe(true);
  });

  it("opens an image from a sent message", () => {
    const fixture = TestBed.createComponent(CopilotChatAttachmentRenderer);
    fixture.componentRef.setInput("type", "image");
    fixture.componentRef.setInput("source", image.source);
    fixture.detectChanges();

    (
      (fixture.nativeElement as HTMLElement).querySelector(
        "button.cpk-attachment-lightbox-trigger",
      ) as HTMLButtonElement
    ).click();
    expect(
      lightbox()?.querySelector("img.cpk-attachment-renderer-lightbox-image"),
    ).not.toBeNull();
  });

  it("links a sent document to its file, like React", () => {
    const fixture = TestBed.createComponent(CopilotChatAttachmentRenderer);
    fixture.componentRef.setInput("type", "document");
    fixture.componentRef.setInput("source", {
      type: "url",
      value: "https://example.com/report.pdf",
      mimeType: "application/pdf",
    });
    fixture.componentRef.setInput("filename", "report.pdf");
    fixture.detectChanges();

    const link = (fixture.nativeElement as HTMLElement).querySelector(
      "a.cpk-attachment-renderer-document",
    )!;
    expect(link.getAttribute("href")).toBe("https://example.com/report.pdf");
    expect(link.getAttribute("download")).toBe("report.pdf");
    expect(link.getAttribute("aria-label")).toBe("report.pdf");
  });
});
