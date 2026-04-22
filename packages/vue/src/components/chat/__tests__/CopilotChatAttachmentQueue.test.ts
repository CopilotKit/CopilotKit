import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/vue";
import type { Attachment } from "@copilotkit/shared";
import CopilotChatAttachmentQueue from "../CopilotChatAttachmentQueue.vue";

function createAttachment(partial: Partial<Attachment>): Attachment {
  return {
    id: partial.id ?? "attachment-id",
    type: partial.type ?? "document",
    source: partial.source ?? {
      type: "url",
      value: "https://example.com/file.txt",
      mimeType: "text/plain",
    },
    filename: partial.filename,
    status: partial.status ?? "ready",
    size: partial.size,
    metadata: partial.metadata,
    thumbnail: partial.thumbnail,
  };
}

describe("CopilotChatAttachmentQueue", () => {
  it("renders nothing for an empty queue", () => {
    const { queryByTestId } = render(CopilotChatAttachmentQueue, {
      props: {
        attachments: [],
      },
    });
    expect(queryByTestId("copilot-chat-attachment-queue")).toBeNull();
  });

  it("image thumbnail click opens lightbox", async () => {
    const { getByTestId } = render(CopilotChatAttachmentQueue, {
      props: {
        attachments: [
          createAttachment({
            id: "image-1",
            type: "image",
            status: "ready",
            source: { type: "url", value: "https://example.com/image.png" },
          }),
        ],
      },
    });

    await fireEvent.click(getByTestId("copilot-chat-attachment-image-button"));
    expect(
      screen.getByTestId("copilot-chat-attachment-lightbox-image"),
    ).not.toBeNull();
  });

  it("image lightbox closes on backdrop click", async () => {
    const { getByTestId, queryByTestId } = render(CopilotChatAttachmentQueue, {
      props: {
        attachments: [
          createAttachment({
            id: "image-2",
            type: "image",
            status: "ready",
            source: { type: "url", value: "https://example.com/image2.png" },
          }),
        ],
      },
    });

    await fireEvent.click(getByTestId("copilot-chat-attachment-image-button"));
    await fireEvent.click(
      screen.getByTestId("copilot-chat-attachment-lightbox"),
    );
    expect(queryByTestId("copilot-chat-attachment-lightbox")).toBeNull();
  });

  it("image lightbox closes on Escape", async () => {
    const { getByTestId, queryByTestId } = render(CopilotChatAttachmentQueue, {
      props: {
        attachments: [
          createAttachment({
            id: "image-3",
            type: "image",
            status: "ready",
            source: { type: "url", value: "https://example.com/image3.png" },
          }),
        ],
      },
    });

    await fireEvent.click(getByTestId("copilot-chat-attachment-image-button"));
    await fireEvent.keyDown(document, { key: "Escape" });
    expect(queryByTestId("copilot-chat-attachment-lightbox")).toBeNull();
  });

  it("video card shows play overlay and opens fullscreen video", async () => {
    const { getByTestId } = render(CopilotChatAttachmentQueue, {
      props: {
        attachments: [
          createAttachment({
            id: "video-1",
            type: "video",
            status: "ready",
            source: { type: "url", value: "https://example.com/video.mp4" },
          }),
        ],
      },
    });

    expect(getByTestId("copilot-chat-attachment-video-play")).not.toBeNull();
    await fireEvent.click(getByTestId("copilot-chat-attachment-video-play"));
    expect(
      screen.getByTestId("copilot-chat-attachment-lightbox-video"),
    ).not.toBeNull();
  });

  it("video thumbnail is preferred when attachment.thumbnail exists", () => {
    const { getByTestId, queryByTestId } = render(CopilotChatAttachmentQueue, {
      props: {
        attachments: [
          createAttachment({
            id: "video-2",
            type: "video",
            status: "ready",
            thumbnail: "https://example.com/thumb.jpg",
            source: { type: "url", value: "https://example.com/video2.mp4" },
          }),
        ],
      },
    });

    expect(
      getByTestId("copilot-chat-attachment-video-thumbnail"),
    ).not.toBeNull();
    expect(queryByTestId("copilot-chat-attachment-video-fallback")).toBeNull();
  });

  it("previewable PDF document opens iframe lightbox", async () => {
    const { getByTestId } = render(CopilotChatAttachmentQueue, {
      props: {
        attachments: [
          createAttachment({
            id: "doc-pdf",
            type: "document",
            status: "ready",
            source: {
              type: "url",
              value: "https://example.com/sample.pdf",
              mimeType: "application/pdf",
            },
          }),
        ],
      },
    });

    await fireEvent.click(
      getByTestId("copilot-chat-attachment-document-button"),
    );
    expect(
      screen.getByTestId("copilot-chat-attachment-lightbox-document-iframe"),
    ).not.toBeNull();
  });

  it("previewable base64 text document opens decoded text preview", async () => {
    const base64Text = btoa("hello attachment preview");
    const { getByTestId } = render(CopilotChatAttachmentQueue, {
      props: {
        attachments: [
          createAttachment({
            id: "doc-text",
            type: "document",
            status: "ready",
            source: {
              type: "data",
              value: base64Text,
              mimeType: "text/plain",
            },
          }),
        ],
      },
    });

    await fireEvent.click(
      getByTestId("copilot-chat-attachment-document-button"),
    );
    expect(
      screen.getByTestId("copilot-chat-attachment-lightbox-document-text")
        .textContent,
    ).toContain("hello attachment preview");
  });

  it("non-previewable document remains inert", async () => {
    const { getByTestId, queryByTestId } = render(CopilotChatAttachmentQueue, {
      props: {
        attachments: [
          createAttachment({
            id: "doc-bin",
            type: "document",
            status: "ready",
            filename: "archive.bin",
            size: 2048,
            source: {
              type: "url",
              value: "https://example.com/archive.bin",
              mimeType: "application/octet-stream",
            },
          }),
        ],
      },
    });

    await fireEvent.click(
      getByTestId("copilot-chat-attachment-document-button"),
    );
    expect(queryByTestId("copilot-chat-attachment-lightbox")).toBeNull();
  });

  it("audio/document cards preserve remove-button behavior", async () => {
    const { getAllByLabelText, emitted } = render(CopilotChatAttachmentQueue, {
      props: {
        attachments: [
          createAttachment({
            id: "audio-1",
            type: "audio",
            filename: "audio.mp3",
            status: "ready",
            source: { type: "url", value: "https://example.com/audio.mp3" },
          }),
          createAttachment({
            id: "doc-1",
            type: "document",
            filename: "doc.txt",
            status: "ready",
            source: {
              type: "url",
              value: "https://example.com/doc.txt",
              mimeType: "text/plain",
            },
          }),
        ],
      },
    });

    const buttons = getAllByLabelText("Remove attachment");
    await fireEvent.click(buttons[0]);
    await fireEvent.click(buttons[1]);
    expect(emitted()["remove-attachment"]).toEqual([["audio-1"], ["doc-1"]]);
  });

  it("uploading overlay coexists with richer card layout", () => {
    const { getByTestId, getAllByTestId } = render(CopilotChatAttachmentQueue, {
      props: {
        attachments: [
          createAttachment({
            id: "uploading-image",
            type: "image",
            status: "uploading",
            source: { type: "url", value: "https://example.com/loading.png" },
          }),
          createAttachment({
            id: "ready-document",
            type: "document",
            status: "ready",
            filename: "notes.txt",
            source: {
              type: "url",
              value: "https://example.com/notes.txt",
              mimeType: "text/plain",
            },
          }),
        ],
      },
    });

    expect(
      getByTestId("copilot-chat-attachment-uploading-overlay"),
    ).not.toBeNull();
    expect(getAllByTestId("copilot-chat-attachment-item").length).toBe(2);
  });
});
