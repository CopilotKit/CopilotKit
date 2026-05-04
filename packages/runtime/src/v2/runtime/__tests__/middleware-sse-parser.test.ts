import { describe, expect, it } from "vitest";
import { parseSSEResponse } from "../middleware-sse-parser";

function buildSSEResponse(events: Record<string, unknown>[]): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("parseSSEResponse", () => {
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
