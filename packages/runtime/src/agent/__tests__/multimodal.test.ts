import { describe, it, expect } from "vitest";
import { convertMessagesToVercelAISDKMessages } from "../index";
import type { Message, ContentPart } from "@ag-ui/client";
import type { ToolModelMessage, ToolResultPart, UserModelMessage } from "ai";

/**
 * Helper: build a user message with the given content parts and convert it.
 * Returns the converted UserModelMessage for assertion.
 */
function convertUserContent(content: string | ContentPart[]) {
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

  it("converts text-only ContentPart[] to parts array", () => {
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

  // AG-UI 1.0: a tool result is a string or a list of the same parts. The AI
  // SDK's tool result output has a matching content form, so parts reach the
  // model as parts rather than as flattened text.
  describe("tool result content", () => {
    function convertToolResult(content: string | ContentPart[]) {
      const messages: Message[] = [
        {
          id: "a1",
          role: "assistant",
          toolCalls: [
            {
              id: "tc-1",
              type: "function",
              function: { name: "get_invoice", arguments: "{}" },
            },
          ],
        },
        { id: "t1", role: "tool", toolCallId: "tc-1", content },
      ];
      const result = convertMessagesToVercelAISDKMessages(messages);
      const tool = result[1] as ToolModelMessage;
      expect(tool.role).toBe("tool");
      return tool.content[0] as ToolResultPart;
    }

    it("passes a string result through as text output", () => {
      const part = convertToolResult("3 results found.");
      expect(part.toolCallId).toBe("tc-1");
      expect(part.output).toEqual({ type: "text", value: "3 results found." });
    });

    it("keeps a text-only parts result as one text output, so providers see one response per call", () => {
      const part = convertToolResult([
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ]);
      expect(part.output).toEqual({ type: "text", value: "ab" });
    });

    it("collects all text into one entry ahead of the media, even when media sits between text parts", () => {
      const part = convertToolResult([
        { type: "text", text: "before" },
        { type: "image", source: dataSource("aGk=", "image/png") },
        { type: "text", text: "after" },
      ]);
      expect(part.output).toEqual({
        type: "content",
        value: [
          { type: "text", text: "before\nafter" },
          { type: "media", data: "aGk=", mediaType: "image/png" },
        ],
      });
    });

    it("maps parts with inline media onto the AI SDK content output", () => {
      const part = convertToolResult([
        { type: "text", text: "Invoice " },
        { type: "text", text: "attached." },
        { type: "document", source: dataSource("JVBERi0x", "application/pdf") },
        {
          type: "image",
          source: urlSource("https://example.com/scan.png", "image/png"),
        },
      ]);
      // The URL-referenced image rides as its URL for now: the AI SDK media
      // entry wants bytes. Passing typed URLs to the adapters that accept them
      // is a follow-up, not something this mapping does yet.
      expect(part.output).toEqual({
        type: "content",
        value: [
          {
            type: "text",
            text: "Invoice attached.\nhttps://example.com/scan.png",
          },
          { type: "media", data: "JVBERi0x", mediaType: "application/pdf" },
        ],
      });
    });

    it("keeps separate URL references on separate lines", () => {
      const part = convertToolResult([
        {
          type: "image",
          source: urlSource("https://example.com/one.png", "image/png"),
        },
        {
          type: "image",
          source: urlSource("https://example.com/two.png", "image/png"),
        },
      ]);
      expect(part.output).toEqual({
        type: "text",
        value: "https://example.com/one.png\nhttps://example.com/two.png",
      });
    });

    it("sends a media-only result as media alone, inventing no text", () => {
      const part = convertToolResult([
        { type: "image", source: dataSource("aGk=", "image/png") },
      ]);
      expect(part.output).toEqual({
        type: "content",
        value: [{ type: "media", data: "aGk=", mediaType: "image/png" }],
      });
    });

    it("treats an empty parts list as an empty text result", () => {
      const part = convertToolResult([]);
      expect(part.output).toEqual({ type: "text", value: "" });
    });
  });
});
