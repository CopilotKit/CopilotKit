import { describe, it, expect } from "vitest";
import { convertMessagesToVercelAISDKMessages } from "../index";
import type { Message, InputContent } from "@ag-ui/client";
import type { UserModelMessage } from "ai";

/**
 * Helper: build a user message with the given content parts and convert it.
 * Returns the converted UserModelMessage for assertion.
 */
function convertUserContent(content: string | InputContent[]) {
  const messages: Message[] = [{ id: "1", role: "user", content }];
  const result = convertMessagesToVercelAISDKMessages(messages);
  return result[0] as UserModelMessage;
}

/** Shorthand factories for AG-UI input parts */
function dataSource(value: string, mimeType: string) {
  return { type: "data" as const, value, mimeType };
}

function urlSource(value: string, mimeType?: string) {
  return { type: "url" as const, value, ...(mimeType ? { mimeType } : {}) };
}

describe("convertMessagesToVercelAISDKMessages — multimodal", () => {
  it("passes through plain string user content", () => {
    const result = convertUserContent("Hello");
    expect(result).toEqual({ role: "user", content: "Hello" });
  });

  it("converts text-only InputContent[] to parts array", () => {
    const result = convertUserContent([{ type: "text", text: "Hello world" }]);
    expect(result.role).toBe("user");
    expect(result.content).toEqual([{ type: "text", text: "Hello world" }]);
  });

  it("converts ImageInputPart with data source to ImagePart", () => {
    const result = convertUserContent([
      { type: "text", text: "What is this?" },
      { type: "image", source: dataSource("iVBORw0KGgo=", "image/png") },
    ]);
    expect(result.content).toEqual([
      { type: "text", text: "What is this?" },
      { type: "image", image: "iVBORw0KGgo=", mediaType: "image/png" },
    ]);
  });

  it("converts ImageInputPart with url source to ImagePart with URL", () => {
    const result = convertUserContent([
      {
        type: "image",
        source: urlSource("https://example.com/photo.jpg", "image/jpeg"),
      },
    ]);
    expect(result.content).toEqual([
      {
        type: "image",
        image: new URL("https://example.com/photo.jpg"),
        mediaType: "image/jpeg",
      },
    ]);
  });

  it("converts AudioInputPart to FilePart", () => {
    const result = convertUserContent([
      { type: "audio", source: dataSource("base64audiodata", "audio/mp3") },
    ]);
    expect(result.content).toEqual([
      { type: "file", data: "base64audiodata", mediaType: "audio/mp3" },
    ]);
  });

  it("converts VideoInputPart with url source to FilePart", () => {
    const result = convertUserContent([
      {
        type: "video",
        source: urlSource("https://example.com/video.mp4", "video/mp4"),
      },
    ]);
    expect(result.content).toEqual([
      {
        type: "file",
        data: new URL("https://example.com/video.mp4"),
        mediaType: "video/mp4",
      },
    ]);
  });

  it("converts DocumentInputPart to FilePart", () => {
    const result = convertUserContent([
      {
        type: "document",
        source: dataSource("base64pdfdata", "application/pdf"),
      },
    ]);
    expect(result.content).toEqual([
      { type: "file", data: "base64pdfdata", mediaType: "application/pdf" },
    ]);
  });

  it("handles mixed text and multimodal parts", () => {
    const result = convertUserContent([
      { type: "text", text: "Analyze these:" },
      { type: "image", source: dataSource("imgdata", "image/png") },
      { type: "document", source: dataSource("docdata", "application/pdf") },
    ]);
    expect(result.content).toEqual([
      { type: "text", text: "Analyze these:" },
      { type: "image", image: "imgdata", mediaType: "image/png" },
      { type: "file", data: "docdata", mediaType: "application/pdf" },
    ]);
  });

  it("returns empty string for empty content array", () => {
    const result = convertUserContent([]);
    expect(result.content).toBe("");
  });

  it("skips image parts with malformed URLs without crashing", () => {
    const result = convertUserContent([
      { type: "text", text: "check this" },
      { type: "image", source: { type: "url", value: "not-a-url" } },
    ]);
    // Malformed URL part is skipped, text part preserved
    expect(result.content).toEqual([{ type: "text", text: "check this" }]);
  });

  // Legacy backward compat — BinaryInputContent is not in the current schema
  // but older clients may still send it. We intentionally construct untyped
  // objects here to simulate that scenario.
  describe("legacy BinaryInputContent backward compat", () => {
    it("converts binary with image mimeType and data to ImagePart", () => {
      const legacyPart = {
        type: "binary",
        mimeType: "image/jpeg",
        data: "legacybase64",
      };
      const messages: Message[] = [
        {
          id: "1",
          role: "user",
          content: [legacyPart] as unknown as InputContent[],
        },
      ];
      const result = convertMessagesToVercelAISDKMessages(messages);
      const userMsg = result[0] as UserModelMessage;
      expect(userMsg.content).toEqual([
        { type: "image", image: "legacybase64", mediaType: "image/jpeg" },
      ]);
    });

    it("converts binary with non-image mimeType and url to FilePart", () => {
      const legacyPart = {
        type: "binary",
        mimeType: "application/pdf",
        url: "https://example.com/doc.pdf",
      };
      const messages: Message[] = [
        {
          id: "1",
          role: "user",
          content: [legacyPart] as unknown as InputContent[],
        },
      ];
      const result = convertMessagesToVercelAISDKMessages(messages);
      const userMsg = result[0] as UserModelMessage;
      expect(userMsg.content).toEqual([
        {
          type: "file",
          data: new URL("https://example.com/doc.pdf"),
          mediaType: "application/pdf",
        },
      ]);
    });
  });
});
