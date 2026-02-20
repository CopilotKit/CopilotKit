import { convertLangGraphMessages } from "./convert-messages";

describe("convertLangGraphMessages", () => {
  it("converts human message to user role with string content", () => {
    const result = convertLangGraphMessages([
      { id: "msg-1", type: "human", content: "Hello" },
    ]);

    expect(result).toEqual([{ id: "msg-1", role: "user", content: "Hello" }]);
  });

  it("converts human message with multimodal array content to text string", () => {
    const result = convertLangGraphMessages([
      {
        id: "msg-2",
        type: "human",
        content: [
          { type: "text", text: "Look at " },
          {
            type: "image_url",
            image_url: { url: "http://example.com/img.png" },
          },
          { type: "text", text: "this image" },
        ],
      },
    ]);

    expect(result).toEqual([
      { id: "msg-2", role: "user", content: "Look at this image" },
    ]);
  });

  it("converts ai message to assistant role with string content", () => {
    const result = convertLangGraphMessages([
      { id: "msg-3", type: "ai", content: "Hi there" },
    ]);

    expect(result).toEqual([
      { id: "msg-3", role: "assistant", content: "Hi there" },
    ]);
  });

  it("converts ai message with empty content and no tool_calls to assistant with no content", () => {
    const result = convertLangGraphMessages([
      { id: "msg-4", type: "ai", content: "" },
    ]);

    expect(result).toEqual([{ id: "msg-4", role: "assistant" }]);
  });

  it("converts ai message with tool_calls to assistant with toolCalls", () => {
    const result = convertLangGraphMessages([
      {
        id: "msg-5",
        type: "ai",
        content: "",
        tool_calls: [
          { id: "tc-1", name: "search", args: { query: "weather" } },
        ],
      },
    ]);

    expect(result).toEqual([
      {
        id: "msg-5",
        role: "assistant",
        toolCalls: [
          {
            id: "tc-1",
            type: "function",
            function: {
              name: "search",
              arguments: '{"query":"weather"}',
            },
          },
        ],
      },
    ]);
  });

  it("converts ai message with tool_calls where args is already a string", () => {
    const result = convertLangGraphMessages([
      {
        id: "msg-6",
        type: "ai",
        content: "",
        tool_calls: [{ id: "tc-2", name: "lookup", args: '{"key":"value"}' }],
      },
    ]);

    expect(result).toEqual([
      {
        id: "msg-6",
        role: "assistant",
        toolCalls: [
          {
            id: "tc-2",
            type: "function",
            function: {
              name: "lookup",
              arguments: '{"key":"value"}',
            },
          },
        ],
      },
    ]);
  });

  it("converts tool message with toolCallId and string content", () => {
    const result = convertLangGraphMessages([
      {
        id: "msg-7",
        type: "tool",
        content: "result data",
        tool_call_id: "tc-1",
      },
    ]);

    expect(result).toEqual([
      {
        id: "msg-7",
        role: "tool",
        content: "result data",
        toolCallId: "tc-1",
      },
    ]);
  });

  it("converts tool message with non-string content to JSON string", () => {
    const result = convertLangGraphMessages([
      {
        id: "msg-8",
        type: "tool",
        content: { status: "ok", count: 3 },
        tool_call_id: "tc-2",
      },
    ]);

    expect(result).toEqual([
      {
        id: "msg-8",
        role: "tool",
        content: '{"status":"ok","count":3}',
        toolCallId: "tc-2",
      },
    ]);
  });

  it("falls back to msg.id for toolCallId when tool_call_id is missing", () => {
    const result = convertLangGraphMessages([
      { id: "msg-9", type: "tool", content: "data" },
    ]);

    expect(result).toEqual([
      { id: "msg-9", role: "tool", content: "data", toolCallId: "msg-9" },
    ]);
  });

  it("converts system message with string content", () => {
    const result = convertLangGraphMessages([
      { id: "msg-10", type: "system", content: "You are a helpful assistant" },
    ]);

    expect(result).toEqual([
      { id: "msg-10", role: "system", content: "You are a helpful assistant" },
    ]);
  });

  it("filters out messages with unrecognized roles", () => {
    const result = convertLangGraphMessages([
      { id: "msg-11", type: "human", content: "Hello" },
      { id: "msg-12", type: "unknown_type", content: "Mystery" },
      { id: "msg-13", type: "ai", content: "Hi" },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: "msg-11", role: "user" });
    expect(result[1]).toMatchObject({ id: "msg-13", role: "assistant" });
  });

  it("handles a full conversation with mixed message types", () => {
    const result = convertLangGraphMessages([
      { id: "m1", type: "system", content: "System prompt" },
      { id: "m2", type: "human", content: "What is the weather?" },
      {
        id: "m3",
        type: "ai",
        content: "",
        tool_calls: [{ id: "tc1", name: "get_weather", args: { city: "NYC" } }],
      },
      { id: "m4", type: "tool", content: '{"temp": 72}', tool_call_id: "tc1" },
      { id: "m5", type: "ai", content: "It's 72°F in NYC." },
    ]);

    expect(result).toHaveLength(5);
    expect(result[0].role).toBe("system");
    expect(result[1].role).toBe("user");
    expect(result[2].role).toBe("assistant");
    expect(result[3].role).toBe("tool");
    expect(result[4].role).toBe("assistant");
  });

  it("returns empty array for empty input", () => {
    expect(convertLangGraphMessages([])).toEqual([]);
  });
});
