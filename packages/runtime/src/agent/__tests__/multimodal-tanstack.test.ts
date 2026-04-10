import { describe, it, expect } from "vitest";
import { convertInputToTanStackAI } from "../converters/tanstack";
import { createDefaultInput } from "./agent-test-helpers";
import type { Message, InputContent } from "@ag-ui/client";

/**
 * Helper: build a user message with the given content parts, run through
 * convertInputToTanStackAI, and return the first converted message for assertion.
 */
function convertUserContent(content: string | InputContent[]) {
  const input = createDefaultInput({
    messages: [{ role: "user", content } as Message],
  });
  const { messages } = convertInputToTanStackAI(input);
  return messages[0];
}

/** Shorthand factories for AG-UI input parts */
function dataSource(value: string, mimeType: string) {
  return { type: "data" as const, value, mimeType };
}

function urlSource(value: string, mimeType?: string) {
  return { type: "url" as const, value, ...(mimeType ? { mimeType } : {}) };
}

describe("convertInputToTanStackAI — multimodal", () => {
  it("passes through plain string user content", () => {
    const result = convertUserContent("Hello");
    expect(result.content).toBe("Hello");
  });

  it("converts text-only InputContent[] to TanStack TextPart array", () => {
    const result = convertUserContent([{ type: "text", text: "Hello world" }]);
    expect(result.content).toEqual([{ type: "text", content: "Hello world" }]);
  });

  it("converts ImageInputPart with data source", () => {
    const result = convertUserContent([
      { type: "text", text: "What is this?" },
      { type: "image", source: dataSource("iVBORw0KGgo=", "image/png") },
    ]);
    expect(result.content).toEqual([
      { type: "text", content: "What is this?" },
      {
        type: "image",
        source: { type: "data", value: "iVBORw0KGgo=", mimeType: "image/png" },
      },
    ]);
  });

  it("converts ImageInputPart with url source", () => {
    const result = convertUserContent([
      {
        type: "image",
        source: urlSource("https://example.com/photo.jpg", "image/jpeg"),
      },
    ]);
    expect(result.content).toEqual([
      {
        type: "image",
        source: {
          type: "url",
          value: "https://example.com/photo.jpg",
          mimeType: "image/jpeg",
        },
      },
    ]);
  });

  it("converts AudioInputPart", () => {
    const result = convertUserContent([
      { type: "audio", source: dataSource("base64audiodata", "audio/mp3") },
    ]);
    expect(result.content).toEqual([
      {
        type: "audio",
        source: {
          type: "data",
          value: "base64audiodata",
          mimeType: "audio/mp3",
        },
      },
    ]);
  });

  it("converts VideoInputPart with url source", () => {
    const result = convertUserContent([
      {
        type: "video",
        source: urlSource("https://example.com/video.mp4", "video/mp4"),
      },
    ]);
    expect(result.content).toEqual([
      {
        type: "video",
        source: {
          type: "url",
          value: "https://example.com/video.mp4",
          mimeType: "video/mp4",
        },
      },
    ]);
  });

  it("converts DocumentInputPart", () => {
    const result = convertUserContent([
      {
        type: "document",
        source: dataSource("base64pdfdata", "application/pdf"),
      },
    ]);
    expect(result.content).toEqual([
      {
        type: "document",
        source: {
          type: "data",
          value: "base64pdfdata",
          mimeType: "application/pdf",
        },
      },
    ]);
  });

  it("handles mixed text and multimodal parts", () => {
    const result = convertUserContent([
      { type: "text", text: "Analyze these:" },
      { type: "image", source: dataSource("imgdata", "image/png") },
      {
        type: "document",
        source: dataSource("docdata", "application/pdf"),
      },
    ]);
    expect(result.content).toEqual([
      { type: "text", content: "Analyze these:" },
      {
        type: "image",
        source: { type: "data", value: "imgdata", mimeType: "image/png" },
      },
      {
        type: "document",
        source: {
          type: "data",
          value: "docdata",
          mimeType: "application/pdf",
        },
      },
    ]);
  });

  it("returns empty string for empty content array", () => {
    const result = convertUserContent([]);
    expect(result.content).toBe("");
  });

  it("preserves empty string text parts", () => {
    const result = convertUserContent([{ type: "text", text: "" }]);
    expect(result.content).toEqual([{ type: "text", content: "" }]);
  });

  it("skips parts with missing source without crashing", () => {
    const result = convertUserContent([
      { type: "text", text: "check this" },
      { type: "image" } as any,
    ]);
    expect(result.content).toEqual([{ type: "text", content: "check this" }]);
  });

  it("silently skips unknown part types", () => {
    const result = convertUserContent([
      { type: "text", text: "hello" },
      { type: "spreadsheet", source: dataSource("data", "text/csv") } as any,
    ]);
    expect(result.content).toEqual([{ type: "text", content: "hello" }]);
  });

  it("returns null for null or undefined content", () => {
    const nullInput = createDefaultInput({
      messages: [{ role: "user", content: null } as unknown as Message],
    });
    const { messages: nullMessages } = convertInputToTanStackAI(nullInput);
    expect(nullMessages[0].content).toBeNull();

    const undefinedInput = createDefaultInput({
      messages: [{ role: "user", content: undefined } as unknown as Message],
    });
    const { messages: undefinedMessages } =
      convertInputToTanStackAI(undefinedInput);
    expect(undefinedMessages[0].content).toBeNull();
  });

  describe("legacy BinaryInputContent backward compat", () => {
    it("converts binary with image mimeType and data", () => {
      const legacyPart = {
        type: "binary",
        mimeType: "image/jpeg",
        data: "legacybase64",
      };
      const input = createDefaultInput({
        messages: [
          {
            role: "user",
            content: [legacyPart] as unknown as InputContent[],
          } as Message,
        ],
      });
      const { messages } = convertInputToTanStackAI(input);
      expect(messages[0].content).toEqual([
        {
          type: "image",
          source: {
            type: "data",
            value: "legacybase64",
            mimeType: "image/jpeg",
          },
        },
      ]);
    });

    it("skips binary with neither data nor url", () => {
      const legacyPart = {
        type: "binary",
        mimeType: "image/png",
      };
      const input = createDefaultInput({
        messages: [
          {
            role: "user",
            content: [legacyPart] as unknown as InputContent[],
          } as Message,
        ],
      });
      const { messages } = convertInputToTanStackAI(input);
      expect(messages[0].content).toBe("");
    });

    it("converts binary with non-image mimeType and url", () => {
      const legacyPart = {
        type: "binary",
        mimeType: "application/pdf",
        url: "https://example.com/doc.pdf",
      };
      const input = createDefaultInput({
        messages: [
          {
            role: "user",
            content: [legacyPart] as unknown as InputContent[],
          } as Message,
        ],
      });
      const { messages } = convertInputToTanStackAI(input);
      expect(messages[0].content).toEqual([
        {
          type: "document",
          source: {
            type: "url",
            value: "https://example.com/doc.pdf",
            mimeType: "application/pdf",
          },
        },
      ]);
    });
  });

  it("only converts user message content, not assistant messages", () => {
    const input = createDefaultInput({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Look at this" },
            { type: "image", source: dataSource("imgdata", "image/png") },
          ],
        } as Message,
        { role: "assistant", content: "I see an image" } as Message,
      ],
    });
    const { messages } = convertInputToTanStackAI(input);
    // User message should have array content
    expect(Array.isArray(messages[0].content)).toBe(true);
    // Assistant message should keep string content
    expect(messages[1].content).toBe("I see an image");
  });
});
