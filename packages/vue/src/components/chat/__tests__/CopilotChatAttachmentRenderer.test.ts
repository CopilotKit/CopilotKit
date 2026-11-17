import { describe, expect, it } from "vitest";
import { fireEvent, render, within } from "@testing-library/vue";
import CopilotChatAttachmentRenderer from "../CopilotChatAttachmentRenderer.vue";

describe("CopilotChatAttachmentRenderer", () => {
  it("renders image attachments from source", () => {
    const { getByTestId } = render(CopilotChatAttachmentRenderer, {
      props: {
        type: "image",
        source: { type: "url", value: "https://example.com/image.png" },
      },
    });

    const image = getByTestId("copilot-chat-attachment-renderer-image");
    expect(image.getAttribute("src")).toBe("https://example.com/image.png");
  });

  it("shows image fallback on load error", async () => {
    const { getByTestId, queryByTestId } = render(
      CopilotChatAttachmentRenderer,
      {
        props: {
          type: "image",
          source: { type: "url", value: "https://example.com/broken.png" },
        },
      },
    );

    await fireEvent.error(
      getByTestId("copilot-chat-attachment-renderer-image"),
    );
    expect(
      getByTestId("copilot-chat-attachment-renderer-image-fallback"),
    ).not.toBeNull();
    expect(queryByTestId("copilot-chat-attachment-renderer-image")).toBeNull();
  });

  it("renders audio attachments with controls and optional filename", () => {
    const { getByTestId } = render(CopilotChatAttachmentRenderer, {
      props: {
        type: "audio",
        source: { type: "url", value: "https://example.com/audio.mp3" },
        filename: "audio.mp3",
      },
    });

    const audioContainer = getByTestId(
      "copilot-chat-attachment-renderer-audio",
    );
    const audio = audioContainer.querySelector("audio");
    expect(audio).not.toBeNull();
    expect(audio?.hasAttribute("controls")).toBe(true);
    expect(
      getByTestId("copilot-chat-attachment-renderer-audio-filename")
        .textContent,
    ).toContain("audio.mp3");
  });

  it("renders video attachments with controls", () => {
    const { getByTestId } = render(CopilotChatAttachmentRenderer, {
      props: {
        type: "video",
        source: { type: "url", value: "https://example.com/video.mp4" },
      },
    });

    const video = getByTestId("copilot-chat-attachment-renderer-video");
    expect(video.hasAttribute("controls")).toBe(true);
    expect(video.getAttribute("src")).toBe("https://example.com/video.mp4");
  });

  it("renders document attachments with icon and filename fallback chain", () => {
    const { getByTestId } = render(CopilotChatAttachmentRenderer, {
      props: {
        type: "document",
        source: {
          type: "url",
          value: "https://example.com/doc.pdf",
          mimeType: "application/pdf",
        },
        filename: "doc.pdf",
      },
    });

    expect(
      getByTestId("copilot-chat-attachment-renderer-document-label")
        .textContent,
    ).toContain("doc.pdf");
    expect(
      getByTestId("copilot-chat-attachment-renderer-document-icon").textContent,
    ).toBeTruthy();

    const second = render(CopilotChatAttachmentRenderer, {
      props: {
        type: "document",
        source: {
          type: "url",
          value: "https://example.com/doc.pdf",
          mimeType: "application/pdf",
        },
      },
    });
    expect(
      within(second.container).getByTestId(
        "copilot-chat-attachment-renderer-document-label",
      ).textContent,
    ).toContain("application/pdf");

    const third = render(CopilotChatAttachmentRenderer, {
      props: {
        type: "document",
        source: {
          type: "url",
          value: "https://example.com/doc.bin",
        },
      },
    });
    expect(
      within(third.container).getByTestId(
        "copilot-chat-attachment-renderer-document-label",
      ).textContent,
    ).toContain("Unknown type");
  });
});
