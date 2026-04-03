import { describe, it, expect } from "vitest";
import type {
  UserMessage,
  InputContent,
  TextInputPart,
  ImageInputPart,
  AudioInputPart,
  VideoInputPart,
  DocumentInputPart,
  InputContentSource,
  InputContentDataSource,
  InputContentUrlSource,
} from "../message";

describe("shared message types", () => {
  it("UserMessage content accepts string", () => {
    const msg: UserMessage = { id: "1", role: "user", content: "hello" };
    expect(msg.content).toBe("hello");
  });

  it("UserMessage content accepts InputContent[]", () => {
    const msg: UserMessage = {
      id: "1",
      role: "user",
      content: [
        { type: "text", text: "hello" },
        {
          type: "image",
          source: { type: "data", value: "base64...", mimeType: "image/png" },
        },
      ],
    };
    expect(Array.isArray(msg.content)).toBe(true);
  });

  it("InputContent union covers all modalities", () => {
    const parts: InputContent[] = [
      { type: "text", text: "hi" },
      {
        type: "image",
        source: { type: "url", value: "https://example.com/img.png" },
      },
      {
        type: "audio",
        source: { type: "data", value: "base64...", mimeType: "audio/mp3" },
      },
      {
        type: "video",
        source: { type: "data", value: "base64...", mimeType: "video/mp4" },
      },
      {
        type: "document",
        source: {
          type: "data",
          value: "base64...",
          mimeType: "application/pdf",
        },
      },
    ];
    expect(parts).toHaveLength(5);
  });
});
