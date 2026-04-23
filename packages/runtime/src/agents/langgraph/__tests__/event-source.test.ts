import { RemoteLangGraphEventSource } from "../event-source";
import { LangGraphEventTypes } from "../events";

/**
 * Access private methods for testing via a helper.
 * These are pure functions that extract data from LangGraph events.
 */
function getSource() {
  return new RemoteLangGraphEventSource();
}

// Helper to call private methods. Returns `any` — type safety is traded for
// access to private implementation details that have no public test surface.
function callPrivate(
  source: RemoteLangGraphEventSource,
  method: string,
  ...args: any[]
) {
  return (source as any)[method](...args);
}

describe("shouldEmitToolCall", () => {
  const source = getSource();

  it("returns true when shouldEmitToolCalls is true (boolean)", () => {
    expect(callPrivate(source, "shouldEmitToolCall", true, "anyTool")).toBe(
      true,
    );
  });

  it("returns false when shouldEmitToolCalls is false (boolean)", () => {
    expect(callPrivate(source, "shouldEmitToolCall", false, "anyTool")).toBe(
      false,
    );
  });

  it("returns true when tool name matches string", () => {
    expect(
      callPrivate(source, "shouldEmitToolCall", "SearchTool", "SearchTool"),
    ).toBe(true);
  });

  it("returns false when tool name does not match string", () => {
    expect(
      callPrivate(source, "shouldEmitToolCall", "SearchTool", "OtherTool"),
    ).toBe(false);
  });

  it("returns true when tool name is in array", () => {
    expect(
      callPrivate(
        source,
        "shouldEmitToolCall",
        ["SearchTool", "FetchTool"],
        "FetchTool",
      ),
    ).toBe(true);
  });

  it("returns false when tool name is not in array", () => {
    expect(
      callPrivate(
        source,
        "shouldEmitToolCall",
        ["SearchTool", "FetchTool"],
        "OtherTool",
      ),
    ).toBe(false);
  });
});

describe("getCurrentMessageId", () => {
  const source = getSource();

  it("extracts id from standard kwargs layout", () => {
    const event = {
      event: LangGraphEventTypes.OnChatModelStream,
      data: { chunk: { kwargs: { id: "msg-std-123" } } },
    };
    expect(callPrivate(source, "getCurrentMessageId", event)).toBe(
      "msg-std-123",
    );
  });

  it("extracts id from LangGraph Platform layout (no kwargs)", () => {
    const event = {
      event: LangGraphEventTypes.OnChatModelStream,
      data: { chunk: { id: "msg-plat-456" } },
    };
    expect(callPrivate(source, "getCurrentMessageId", event)).toBe(
      "msg-plat-456",
    );
  });

  it("prefers kwargs layout when both present", () => {
    const event = {
      event: LangGraphEventTypes.OnChatModelStream,
      data: { chunk: { kwargs: { id: "kwargs-id" }, id: "direct-id" } },
    };
    expect(callPrivate(source, "getCurrentMessageId", event)).toBe("kwargs-id");
  });

  it("returns undefined when neither layout is present", () => {
    const event = {
      event: LangGraphEventTypes.OnChatModelStream,
      data: { chunk: {} },
    };
    expect(callPrivate(source, "getCurrentMessageId", event)).toBeUndefined();
  });

  it("handles missing data gracefully", () => {
    const event = { event: LangGraphEventTypes.OnChatModelStream };
    expect(callPrivate(source, "getCurrentMessageId", event)).toBeUndefined();
  });
});

describe("getCurrentToolCallChunks", () => {
  const source = getSource();

  it("extracts chunks from standard kwargs layout", () => {
    const chunks = [{ name: "tool1", args: "{}", id: "tc-1", index: 0 }];
    const event = {
      event: LangGraphEventTypes.OnChatModelStream,
      data: { chunk: { kwargs: { tool_call_chunks: chunks } } },
    };
    expect(callPrivate(source, "getCurrentToolCallChunks", event)).toEqual(
      chunks,
    );
  });

  it("extracts chunks from LangGraph Platform layout", () => {
    const chunks = [{ name: "tool2", args: "{}", id: "tc-2", index: 0 }];
    const event = {
      event: LangGraphEventTypes.OnChatModelStream,
      data: { chunk: { tool_call_chunks: chunks } },
    };
    expect(callPrivate(source, "getCurrentToolCallChunks", event)).toEqual(
      chunks,
    );
  });

  it("returns undefined when no chunks present", () => {
    const event = {
      event: LangGraphEventTypes.OnChatModelStream,
      data: { chunk: {} },
    };
    expect(
      callPrivate(source, "getCurrentToolCallChunks", event),
    ).toBeUndefined();
  });
});

describe("getResponseMetadata", () => {
  const source = getSource();

  it("extracts metadata from standard kwargs layout", () => {
    const meta = { finish_reason: "stop" };
    const event = {
      event: LangGraphEventTypes.OnChatModelStream,
      data: { chunk: { kwargs: { response_metadata: meta } } },
    };
    expect(callPrivate(source, "getResponseMetadata", event)).toEqual(meta);
  });

  it("extracts metadata from LangGraph Platform layout", () => {
    const meta = { finish_reason: "tool_calls" };
    const event = {
      event: LangGraphEventTypes.OnChatModelStream,
      data: { chunk: { response_metadata: meta } },
    };
    expect(callPrivate(source, "getResponseMetadata", event)).toEqual(meta);
  });

  it("returns undefined when no metadata present", () => {
    const event = {
      event: LangGraphEventTypes.OnChatModelStream,
      data: { chunk: {} },
    };
    expect(callPrivate(source, "getResponseMetadata", event)).toBeUndefined();
  });
});

describe("getCurrentContent", () => {
  const source = getSource();

  it("extracts string content from kwargs layout", () => {
    const event = {
      event: LangGraphEventTypes.OnChatModelStream,
      data: { chunk: { kwargs: { content: "hello world" } } },
    };
    expect(callPrivate(source, "getCurrentContent", event)).toBe("hello world");
  });

  it("extracts string content from Platform layout", () => {
    const event = {
      event: LangGraphEventTypes.OnChatModelStream,
      data: { chunk: { content: "platform content" } },
    };
    expect(callPrivate(source, "getCurrentContent", event)).toBe(
      "platform content",
    );
  });

  it("extracts text from array content (Anthropic format)", () => {
    const event = {
      event: LangGraphEventTypes.OnChatModelStream,
      data: {
        chunk: {
          kwargs: {
            content: [{ text: "array text", type: "text", index: 0 }],
          },
        },
      },
    };
    expect(callPrivate(source, "getCurrentContent", event)).toBe("array text");
  });

  it("returns null when no content and no tool call chunks", () => {
    const event = {
      event: LangGraphEventTypes.OnChatModelStream,
      data: { chunk: { kwargs: {} } },
    };
    expect(callPrivate(source, "getCurrentContent", event)).toBeNull();
  });

  it("falls back to tool_call_chunks args when no content", () => {
    const event = {
      event: LangGraphEventTypes.OnChatModelStream,
      data: {
        chunk: {
          kwargs: {
            content: "",
            tool_call_chunks: [{ args: '{"key":"val"}' }],
          },
        },
      },
    };
    expect(callPrivate(source, "getCurrentContent", event)).toBe(
      '{"key":"val"}',
    );
  });

  it("handles missing data gracefully", () => {
    const event = { event: LangGraphEventTypes.OnChatModelStream };
    expect(callPrivate(source, "getCurrentContent", event)).toBeNull();
  });

  it("returns empty string when content is empty string", () => {
    const event = {
      event: LangGraphEventTypes.OnChatModelStream,
      data: { chunk: { kwargs: { content: "" } } },
    };
    // Empty string is a valid string, so typeof === "string" returns it as-is
    expect(callPrivate(source, "getCurrentContent", event)).toBe("");
  });
});
