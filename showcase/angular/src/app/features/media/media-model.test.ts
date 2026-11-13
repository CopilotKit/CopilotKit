import { describe, expect, it } from "vitest";

import {
  createMultimodalMessage,
  dedupeUserMessageMedia,
  validateSampleBytes,
  VOICE_WEATHER_TOOL_NAMES,
} from "./media-model";

describe("Angular media showcase model", () => {
  it("scopes voice rendering to the two explicit weather tool spellings", () => {
    expect(VOICE_WEATHER_TOOL_NAMES).toEqual(["get_weather", "get-weather"]);
    expect(VOICE_WEATHER_TOOL_NAMES).not.toContain("*");
  });

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

  it("builds a modern-only media message with no legacy binary part", () => {
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
    expect(message.content).toHaveLength(2);
    expect(
      message.content?.some(
        (part) => (part as { type?: string }).type === "binary",
      ),
    ).toBe(false);
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
});
