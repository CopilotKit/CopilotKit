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

  it("continues chunks that omit messageId or toolCallId", async () => {
    // OpenAI-style streams carry the tool call id only on the first delta.
    const response = buildSSEResponse([
      { type: "RUN_STARTED", threadId: "t-1", runId: "r-1" },
      { type: "TEXT_MESSAGE_CHUNK", messageId: "m-1", delta: "Checking" },
      { type: "TEXT_MESSAGE_CHUNK", delta: " the weather" },
      {
        type: "TOOL_CALL_CHUNK",
        toolCallId: "tc-1",
        toolCallName: "getWeather",
        parentMessageId: "m-1",
        delta: '{"loc',
      },
      { type: "TOOL_CALL_CHUNK", delta: 'ation":' },
      { type: "TOOL_CALL_CHUNK", delta: '"SF"}' },
      { type: "RUN_FINISHED", threadId: "t-1", runId: "r-1" },
    ]);
    const result = await parseSSEResponse(response);
    expect(result.messages).toEqual([
      {
        id: "m-1",
        role: "assistant",
        content: "Checking the weather",
        toolCalls: [
          { id: "tc-1", name: "getWeather", args: '{"location":"SF"}' },
        ],
      },
    ]);
  });

  it("does not continue a chunk across a non-chunk event", async () => {
    const response = buildSSEResponse([
      { type: "TEXT_MESSAGE_CHUNK", messageId: "m-1", delta: "Hello" },
      { type: "STEP_FINISHED", stepName: "s-1" },
      { type: "TEXT_MESSAGE_CHUNK", delta: " world" },
    ]);
    const result = await parseSSEResponse(response);
    expect(result.messages).toEqual([
      { id: "m-1", role: "assistant", content: "Hello" },
    ]);
  });

  it("continues a subagent chunk tagged only on its first delta", async () => {
    const response = buildSSEResponse([
      {
        type: "TOOL_CALL_CHUNK",
        toolCallId: "tc-1",
        toolCallName: "lookup",
        subagentRunId: "sub-1",
        delta: '{"a',
      },
      { type: "TOOL_CALL_CHUNK", delta: '":1}' },
    ]);
    const result = await parseSSEResponse(response);
    expect(result.messages).toEqual([
      {
        id: "tc-1",
        role: "assistant",
        toolCalls: [{ id: "tc-1", name: "lookup", args: '{"a":1}' }],
      },
    ]);
  });

  it("keeps the parent's chunk open across an untagged subagent terminal", async () => {
    for (const terminal of ["SUBAGENT_FINISHED", "SUBAGENT_ERROR"]) {
      const response = buildSSEResponse([
        { type: "TEXT_MESSAGE_CHUNK", messageId: "m-1", delta: "Hel" },
        { type: terminal },
        { type: "TEXT_MESSAGE_CHUNK", delta: "lo" },
      ]);
      const result = await parseSSEResponse(response);
      expect(result.messages).toEqual([
        { id: "m-1", role: "assistant", content: "Hello" },
      ]);
    }
  });

  it("creates the parent assistant message for a tool call with no text", async () => {
    const response = buildSSEResponse([
      { type: "RUN_STARTED", threadId: "t-1", runId: "r-1" },
      {
        type: "TOOL_CALL_START",
        toolCallId: "tc-1",
        toolCallName: "get_weather",
        parentMessageId: "m-1",
      },
      { type: "TOOL_CALL_ARGS", toolCallId: "tc-1", delta: '{"city":"NYC"}' },
      { type: "TOOL_CALL_END", toolCallId: "tc-1" },
      {
        type: "TOOL_CALL_RESULT",
        toolCallId: "tc-1",
        messageId: "m-result",
        content: "18C",
      },
      { type: "RUN_FINISHED", threadId: "t-1", runId: "r-1" },
    ]);
    const result = await parseSSEResponse(response);
    expect(result.messages).toEqual([
      {
        id: "m-1",
        role: "assistant",
        toolCalls: [
          { id: "tc-1", name: "get_weather", args: '{"city":"NYC"}' },
        ],
      },
      {
        id: "m-result",
        role: "tool",
        content: "18C",
        toolCallId: "tc-1",
      },
    ]);
  });

  it("keys the assistant message by toolCallId when a tool call has no parentMessageId", async () => {
    const response = buildSSEResponse([
      { type: "RUN_STARTED", threadId: "t-1", runId: "r-1" },
      {
        type: "TOOL_CALL_CHUNK",
        toolCallId: "tc-1",
        toolCallName: "getWeather",
        delta: '{"location":"SF"}',
      },
      { type: "RUN_FINISHED", threadId: "t-1", runId: "r-1" },
    ]);
    const result = await parseSSEResponse(response);
    expect(result.messages).toEqual([
      {
        id: "tc-1",
        role: "assistant",
        toolCalls: [
          { id: "tc-1", name: "getWeather", args: '{"location":"SF"}' },
        ],
      },
    ]);
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
