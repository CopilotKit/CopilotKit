import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/vue";
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

  it("renders uploading overlay for uploading attachments", () => {
    const { getByTestId } = render(CopilotChatAttachmentQueue, {
      props: {
        attachments: [
          createAttachment({
            id: "uploading-1",
            type: "image",
            status: "uploading",
            source: { type: "url", value: "https://example.com/image.png" },
          }),
        ],
      },
    });

    expect(
      getByTestId("copilot-chat-attachment-uploading-overlay"),
    ).not.toBeNull();
  });

  it("renders ready attachments through CopilotChatAttachmentRenderer", () => {
    const { getByTestId, getByText } = render(CopilotChatAttachmentQueue, {
      props: {
        attachments: [
          createAttachment({
            id: "ready-1",
            type: "image",
            filename: "image.png",
            status: "ready",
            source: { type: "url", value: "https://example.com/image.png" },
          }),
        ],
      },
    });

    expect(
      getByTestId("copilot-chat-attachment-renderer-image"),
    ).not.toBeNull();
    expect(getByText("image.png")).not.toBeNull();
  });

  it("emits remove-attachment with the correct id", async () => {
    const { getByLabelText, emitted } = render(CopilotChatAttachmentQueue, {
      props: {
        attachments: [
          createAttachment({
            id: "remove-me",
            filename: "remove.txt",
            source: { type: "url", value: "https://example.com/remove.txt" },
          }),
        ],
      },
    });

    await fireEvent.click(getByLabelText("Remove attachment"));

    expect(emitted()["remove-attachment"]).toEqual([["remove-me"]]);
  });
});
