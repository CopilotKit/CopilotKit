import { describe, expect, it } from "vitest";
import { parseSSEResponse } from "../core/middleware-sse-parser";

function buildSSEResponse(events: Record<string, unknown>[]): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("parseSSEResponse", () => {
  it("continues an existing snapshot message without replacing its metadata", async () => {
    const message = {
      id: "a",
      role: "assistant",
      content: "Hello",
      name: "agent",
    };
    const result = await parseSSEResponse(
      buildSSEResponse([
        { type: "MESSAGES_SNAPSHOT", messages: [message] },
        { type: "TEXT_MESSAGE_START", messageId: "a", role: "assistant" },
        { type: "TEXT_MESSAGE_CONTENT", messageId: "a", delta: " world" },
        { type: "TEXT_MESSAGE_END", messageId: "a" },
      ]),
    );
    expect(result.messages).toEqual([{ ...message, content: "Hello world" }]);
  });

  it.each([false, true])(
    "continues a snapshotted tool call (replayed start: %s)",
    async (replayStart) => {
      const toolCall = {
        id: "tc",
        type: "function",
        function: { name: "weather", arguments: '{"city":' },
      };
      const result = await parseSSEResponse(
        buildSSEResponse([
          { type: "TEXT_MESSAGE_START", messageId: "a", role: "assistant" },
          { type: "TEXT_MESSAGE_END", messageId: "a" },
          {
            type: "TOOL_CALL_START",
            toolCallId: "tc",
            toolCallName: "weather",
            parentMessageId: "a",
          },
          {
            type: "MESSAGES_SNAPSHOT",
            messages: [{ id: "a", role: "assistant", toolCalls: [toolCall] }],
          },
          ...(replayStart
            ? [
                {
                  type: "TOOL_CALL_START",
                  toolCallId: "tc",
                  toolCallName: "weather",
                  parentMessageId: "a",
                },
              ]
            : []),
          { type: "TOOL_CALL_ARGS", toolCallId: "tc", delta: '"Paris"}' },
          { type: "TOOL_CALL_END", toolCallId: "tc" },
        ]),
      );
      expect(result.messages).toEqual([
        {
          id: "a",
          role: "assistant",
          toolCalls: [
            {
              ...toolCall,
              function: { name: "weather", arguments: '{"city":"Paris"}' },
            },
          ],
        },
      ]);
    },
  );

  it("extracts threadId and runId from RUN_STARTED", async () => {
    const response = buildSSEResponse([
      { type: "RUN_STARTED", threadId: "t-1", runId: "r-1" },
      { type: "RUN_FINISHED", threadId: "t-1", runId: "r-1" },
    ]);
    const result = await parseSSEResponse(response);
    expect(result.threadId).toBe("t-1");
    expect(result.runId).toBe("r-1");
  });

  it("reconstructs a text message from start/content/end events", async () => {
    const response = buildSSEResponse([
      { type: "RUN_STARTED", threadId: "t-1", runId: "r-1" },
      { type: "TEXT_MESSAGE_START", messageId: "m-1", role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "m-1", delta: "Hello" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "m-1", delta: " world" },
      { type: "TEXT_MESSAGE_END", messageId: "m-1" },
      { type: "RUN_FINISHED", threadId: "t-1", runId: "r-1" },
    ]);
    const result = await parseSSEResponse(response);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual({
      id: "m-1",
      role: "assistant",
      content: "Hello world",
    });
  });

  it("reconstructs tool calls on assistant messages", async () => {
    const response = buildSSEResponse([
      { type: "RUN_STARTED", threadId: "t-1", runId: "r-1" },
      { type: "TEXT_MESSAGE_START", messageId: "m-1", role: "assistant" },
      { type: "TEXT_MESSAGE_END", messageId: "m-1" },
      {
        type: "TOOL_CALL_START",
        toolCallId: "tc-1",
        toolCallName: "get_weather",
        parentMessageId: "m-1",
      },
      { type: "TOOL_CALL_ARGS", toolCallId: "tc-1", delta: '{"city":"NYC"}' },
      { type: "TOOL_CALL_END", toolCallId: "tc-1" },
      { type: "RUN_FINISHED", threadId: "t-1", runId: "r-1" },
    ]);
    const result = await parseSSEResponse(response);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      id: "m-1",
      role: "assistant",
      toolCalls: [{ id: "tc-1", name: "get_weather", args: '{"city":"NYC"}' }],
    });
  });

  it("includes tool result messages", async () => {
    const response = buildSSEResponse([
      { type: "RUN_STARTED", threadId: "t-1", runId: "r-1" },
      {
        type: "TOOL_CALL_RESULT",
        toolCallId: "tc-1",
        messageId: "m-result",
        role: "tool",
        content: "72F sunny",
      },
      { type: "RUN_FINISHED", threadId: "t-1", runId: "r-1" },
    ]);
    const result = await parseSSEResponse(response);
    expect(result.messages).toContainEqual({
      id: "m-result",
      role: "tool",
      content: "72F sunny",
      toolCallId: "tc-1",
    });
  });

  it("normalizes array content in TOOL_CALL_RESULT (MCP adapters)", async () => {
    const response = buildSSEResponse([
      { type: "RUN_STARTED", threadId: "t-1", runId: "r-1" },
      {
        type: "TOOL_CALL_RESULT",
        toolCallId: "tc-1",
        messageId: "m-result",
        role: "tool",
        content: [
          { type: "text", text: '{"metric":"cpu","value":42}' },
          { type: "text", text: " extra info" },
        ],
      },
      { type: "RUN_FINISHED", threadId: "t-1", runId: "r-1" },
    ]);
    const result = await parseSSEResponse(response);
    expect(result.messages).toContainEqual({
      id: "m-result",
      role: "tool",
      content: '{"metric":"cpu","value":42} extra info',
      toolCallId: "tc-1",
    });
  });

  it("filters non-text parts when normalizing array content in TOOL_CALL_RESULT", async () => {
    const response = buildSSEResponse([
      { type: "RUN_STARTED", threadId: "t-1", runId: "r-1" },
      {
        type: "TOOL_CALL_RESULT",
        toolCallId: "tc-1",
        messageId: "m-result",
        role: "tool",
        content: [
          { type: "text", text: "valid" },
          { type: "image", data: "binary" },
          null,
          { type: "text", text: " part" },
        ],
      },
      { type: "RUN_FINISHED", threadId: "t-1", runId: "r-1" },
    ]);
    const result = await parseSSEResponse(response);
    expect(result.messages).toContainEqual({
      id: "m-result",
      role: "tool",
      content: "valid part",
      toolCallId: "tc-1",
    });
  });

  it("uses MESSAGES_SNAPSHOT when present", async () => {
    const snapshotMessages = [
      { id: "u-1", role: "user", content: "hi" },
      { id: "a-1", role: "assistant", content: "hello" },
    ];
    const response = buildSSEResponse([
      { type: "RUN_STARTED", threadId: "t-1", runId: "r-1" },
      { type: "MESSAGES_SNAPSHOT", messages: snapshotMessages },
      { type: "RUN_FINISHED", threadId: "t-1", runId: "r-1" },
    ]);
    const result = await parseSSEResponse(response);
    expect(result.messages).toEqual(snapshotMessages);
  });

  it("keeps snapshot history and subsequent text and tool events across UTF-8 byte chunks", async () => {
    const events = [
      { type: "RUN_STARTED", threadId: "t-1", runId: "r-1" },
      {
        type: "MESSAGES_SNAPSHOT",
        messages: [{ id: "u-1", role: "user", content: "天气？" }],
      },
      { type: "TEXT_MESSAGE_START", messageId: "a-1", role: "assistant" },
      { type: "TEXT_MESSAGE_CONTENT", messageId: "a-1", delta: "查一下 🌍" },
      { type: "TEXT_MESSAGE_END", messageId: "a-1" },
      {
        type: "TOOL_CALL_START",
        toolCallId: "tc-1",
        toolCallName: "weather",
        parentMessageId: "a-1",
      },
      { type: "TOOL_CALL_ARGS", toolCallId: "tc-1", delta: '{"city":"北京"}' },
      { type: "TOOL_CALL_END", toolCallId: "tc-1" },
      {
        type: "TOOL_CALL_RESULT",
        toolCallId: "tc-1",
        messageId: "result-1",
        content: "晴 ☀️",
      },
      { type: "RUN_FINISHED", threadId: "t-1", runId: "r-1" },
    ];
    const bytes = new TextEncoder().encode(
      events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    );
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
          controller.close();
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );

    const result = await parseSSEResponse(response);
    expect(result.messages).toEqual([
      { id: "u-1", role: "user", content: "天气？" },
      {
        id: "a-1",
        role: "assistant",
        content: "查一下 🌍",
        toolCalls: [{ id: "tc-1", name: "weather", args: '{"city":"北京"}' }],
      },
      { id: "result-1", role: "tool", content: "晴 ☀️", toolCallId: "tc-1" },
    ]);
  });

  it("treats a later snapshot as authoritative before applying subsequent chunks", async () => {
    const response = buildSSEResponse([
      { type: "RUN_STARTED", threadId: "t-1", runId: "r-1" },
      {
        type: "MESSAGES_SNAPSHOT",
        messages: [{ id: "removed", role: "user", content: "Old history" }],
      },
      { type: "TEXT_MESSAGE_CHUNK", messageId: "a-1", delta: "Draft" },
      {
        type: "TOOL_CALL_CHUNK",
        toolCallId: "old-tool",
        toolCallName: "old",
        parentMessageId: "a-1",
        delta: "{}",
      },
      {
        type: "MESSAGES_SNAPSHOT",
        messages: [{ id: "a-1", role: "assistant", content: "Corrected" }],
      },
      { type: "TEXT_MESSAGE_CHUNK", messageId: "a-2", delta: "Next reply" },
      { type: "RUN_FINISHED", threadId: "t-1", runId: "r-1" },
    ]);

    expect((await parseSSEResponse(response)).messages).toEqual([
      { id: "a-1", role: "assistant", content: "Corrected" },
      { id: "a-2", role: "assistant", content: "Next reply" },
    ]);
  });

  it.each([false, true])(
    "clears history on an empty snapshot (subsequent message: %s)",
    async (appendMessage) => {
      const response = buildSSEResponse([
        { type: "RUN_STARTED", threadId: "t-1", runId: "r-1" },
        { type: "TEXT_MESSAGE_CHUNK", messageId: "old", delta: "Discarded" },
        { type: "MESSAGES_SNAPSHOT", messages: [] },
        ...(appendMessage
          ? [{ type: "TEXT_MESSAGE_CHUNK", messageId: "new", delta: "Fresh" }]
          : []),
        { type: "RUN_FINISHED", threadId: "t-1", runId: "r-1" },
      ]);
      expect((await parseSSEResponse(response)).messages).toEqual(
        appendMessage
          ? [{ id: "new", role: "assistant", content: "Fresh" }]
          : [],
      );
    },
  );

  it("reconstructs a text message from TEXT_MESSAGE_CHUNK events", async () => {
    const response = buildSSEResponse([
      { type: "RUN_STARTED", threadId: "t-1", runId: "r-1" },
      {
        type: "TEXT_MESSAGE_CHUNK",
        messageId: "m-1",
        role: "assistant",
        delta: "Hello",
      },
      { type: "TEXT_MESSAGE_CHUNK", messageId: "m-1", delta: " world" },
      { type: "RUN_FINISHED", threadId: "t-1", runId: "r-1" },
    ]);
    const result = await parseSSEResponse(response);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual({
      id: "m-1",
      role: "assistant",
      content: "Hello world",
    });
  });

  it("reconstructs tool calls from TOOL_CALL_CHUNK events", async () => {
    const response = buildSSEResponse([
      { type: "RUN_STARTED", threadId: "t-1", runId: "r-1" },
      {
        type: "TEXT_MESSAGE_CHUNK",
        messageId: "m-1",
        role: "assistant",
        delta: "",
      },
      {
        type: "TOOL_CALL_CHUNK",
        toolCallId: "tc-1",
        toolCallName: "getWeather",
        parentMessageId: "m-1",
        delta: '{"loc',
      },
      {
        type: "TOOL_CALL_CHUNK",
        toolCallId: "tc-1",
        parentMessageId: "m-1",
        delta: 'ation":"SF"}',
      },
      {
        type: "TOOL_CALL_RESULT",
        toolCallId: "tc-1",
        messageId: "m-result",
        content: "18C",
      },
      { type: "RUN_FINISHED", threadId: "t-1", runId: "r-1" },
    ]);
    const result = await parseSSEResponse(response);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toMatchObject({
      id: "m-1",
      role: "assistant",
      toolCalls: [
        { id: "tc-1", name: "getWeather", args: '{"location":"SF"}' },
      ],
    });
    expect(result.messages[1]).toEqual({
      id: "m-result",
      role: "tool",
      content: "18C",
      toolCallId: "tc-1",
    });
  });

  it("returns empty messages for non-SSE responses", async () => {
    const response = new Response(JSON.stringify({ version: "1.0" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const result = await parseSSEResponse(response);
    expect(result.messages).toEqual([]);
    expect(result.threadId).toBeUndefined();
    expect(result.runId).toBeUndefined();
  });

  it("handles empty body gracefully", async () => {
    const response = new Response("", {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
    const result = await parseSSEResponse(response);
    expect(result.messages).toEqual([]);
  });
});
