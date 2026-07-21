import { describe, expect, it } from "vitest";

import {
  createMultimodalMessage,
  dedupeUserMessageMedia,
  populateChatComposer,
  rewriteMessagesForLegacyConverter,
  validateSampleBytes,
} from "./media-model";

describe("Angular media showcase model", () => {
  it("builds a modern multimodal user message with file metadata", () => {
    expect(
      createMultimodalMessage(
        {
          filename: "sample.pdf",
          mimeType: "application/pdf",
          autoPrompt: "describe this PDF",
        },
        "cGRm",
        42,
        "message-1",
      ),
    ).toEqual({
      id: "message-1",
      role: "user",
      content: [
        { type: "text", text: "describe this PDF" },
        {
          type: "document",
          source: {
            type: "data",
            value: "cGRm",
            mimeType: "application/pdf",
          },
          metadata: { filename: "sample.pdf", size: 42 },
        },
      ],
    });
  });

  it("rejects LFS pointers and invalid sample signatures", () => {
    const pointer = new TextEncoder().encode(
      "version https://git-lfs.github.com/spec/v1",
    );
    expect(() =>
      validateSampleBytes(pointer, "image/png", "sample.png"),
    ).toThrow(/Git LFS pointer/);
    expect(() =>
      validateSampleBytes(
        new Uint8Array([0, 1, 2, 3]),
        "image/png",
        "sample.png",
      ),
    ).toThrow(/valid image\/png signature/);
  });

  it("appends exactly one legacy binary mirror for LangGraph", () => {
    const message = createMultimodalMessage(
      {
        filename: "sample.png",
        mimeType: "image/png",
        autoPrompt: "describe this image",
      },
      "aW1hZ2U=",
      7,
      "message-2",
    );
    const rewritten = rewriteMessagesForLegacyConverter([message]);
    expect(rewritten?.[0]?.content).toHaveLength(3);
    expect(rewritten?.[0]?.content?.[2]).toEqual({
      type: "binary",
      mimeType: "image/png",
      data: "aW1hZ2U=",
    });
    expect(rewriteMessagesForLegacyConverter(rewritten ?? [])).toBeNull();
  });

  it("deduplicates round-tripped media and restores PDF document type", () => {
    const messages = [
      {
        id: "message-3",
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "data",
              value: "cGRm",
              mimeType: "application/pdf",
            },
          },
          {
            type: "image",
            source: {
              type: "data",
              value: "cGRm",
              mimeType: "application/pdf",
            },
          },
        ],
      },
    ];

    expect(dedupeUserMessageMedia(messages)?.[0]?.content).toEqual([
      {
        type: "document",
        source: {
          type: "data",
          value: "cGRm",
          mimeType: "application/pdf",
        },
      },
    ]);
  });

  it("fills the real chat textarea and emits an input event", () => {
    const root = document.createElement("div");
    const textarea = document.createElement("textarea");
    textarea.dataset["testid"] = "copilot-chat-textarea";
    root.append(textarea);
    let emitted = false;
    textarea.addEventListener("input", () => {
      emitted = true;
    });

    expect(populateChatComposer(root, "What is the weather in Tokyo?")).toBe(
      true,
    );
    expect(textarea.value).toBe("What is the weather in Tokyo?");
    expect(emitted).toBe(true);
  });
});
