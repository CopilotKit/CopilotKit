/**
 * `convertAISDKStream` driven by a REAL AI SDK v7 `streamText` (mock
 * LanguageModelV4, no network). `@copilotkit/runtime` accepts `ai` ^6 || ^7;
 * `converter-aisdk.test.ts` covers the v6 part shapes, this file pins the
 * same AG-UI output for the parts v7 actually emits.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { EventType } from "@ag-ui/client";
import type { BaseEvent, Interrupt } from "@ag-ui/client";
import type { JSONSchema7 } from "ai-v7";
import { jsonSchema, simulateReadableStream, streamText, tool } from "ai-v7";
import { MockLanguageModelV4 } from "ai-v7/test";
import { convertAISDKStream } from "../converters/aisdk";
import type { AgentRunFinishedDetails } from "../converters/usage";
import { eventField, expectEventSequence } from "./agent-test-helpers";

// LanguageModelV4StreamPart, read off the mock so the test does not need
// ai-v7's own `@ai-sdk/provider` to be resolvable from this package.
type ModelStream = Awaited<
  ReturnType<MockLanguageModelV4["doStream"]>
>["stream"];
type ModelStreamPart =
  ModelStream extends ReadableStream<infer PART> ? PART : never;

const USAGE = {
  inputTokens: { total: 12, noCache: 9, cacheRead: 3, cacheWrite: 0 },
  outputTokens: { total: 8, text: 6, reasoning: 2 },
};

function finishPart(unified: "stop" | "tool-calls"): ModelStreamPart {
  return {
    type: "finish",
    finishReason: { unified, raw: unified },
    usage: USAGE,
  };
}

function toolCallPart(
  toolCallId: string,
  toolName: string,
  input: unknown,
): ModelStreamPart {
  return {
    type: "tool-call",
    toolCallId,
    toolName,
    input: JSON.stringify(input),
  };
}

function modelEmitting(chunks: ModelStreamPart[]) {
  return new MockLanguageModelV4({
    doStream: async () => ({ stream: simulateReadableStream({ chunks }) }),
  });
}

async function convert(fullStream: AsyncIterable<unknown>) {
  const events: BaseEvent[] = [];
  const interrupts: Interrupt[] = [];
  const details: AgentRunFinishedDetails = {};
  const stream = convertAISDKStream(
    fullStream,
    new AbortController().signal,
    interrupts,
    {},
    details,
  );
  for await (const event of stream) {
    events.push(event);
  }
  return { events, interrupts, details };
}

const isToolEvent = (event: BaseEvent) =>
  event.type === EventType.TOOL_CALL_START ||
  event.type === EventType.TOOL_CALL_ARGS ||
  event.type === EventType.TOOL_CALL_END ||
  event.type === EventType.TOOL_CALL_RESULT;

// `jsonSchema` instead of zod: zod 3 schemas inferred through v7's
// `FlexibleSchema` blow up the type checker (the v6 tests cast them away).
function objectSchema<T>(properties: Record<keyof T & string, JSONSchema7>) {
  return jsonSchema<T>({ type: "object", properties });
}

const bookFlightInput = objectSchema<{ destination: string }>({
  destination: { type: "string" },
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("convertAISDKStream with AI SDK v7 streamText", () => {
  it("converts reasoning and text, and ignores v7-only metadata parts", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = streamText({
      model: modelEmitting([
        { type: "reasoning-start", id: "reasoning-abc" },
        { type: "reasoning-delta", id: "reasoning-abc", delta: "thinking..." },
        { type: "reasoning-end", id: "reasoning-abc" },
        { type: "custom", kind: "test.marker" },
        { type: "text-start", id: "txt-abc" },
        { type: "text-delta", id: "txt-abc", delta: "Hello" },
        { type: "text-end", id: "txt-abc" },
        finishPart("stop"),
      ]),
      prompt: "Hi",
    });

    const { events } = await convert(result.fullStream);

    expectEventSequence(events, [
      EventType.REASONING_START,
      EventType.REASONING_MESSAGE_START,
      EventType.REASONING_MESSAGE_CONTENT,
      EventType.REASONING_MESSAGE_END,
      EventType.REASONING_END,
      EventType.TEXT_MESSAGE_CHUNK,
    ]);
    expect(events[0]).toMatchObject({ messageId: "reasoning-abc" });
    expect(events[2]).toMatchObject({
      messageId: "reasoning-abc",
      delta: "thinking...",
    });
    expect(events[5]).toMatchObject({
      role: "assistant",
      messageId: "txt-abc",
      delta: "Hello",
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("streams an executed tool call and its result", async () => {
    const result = streamText({
      model: modelEmitting([
        { type: "tool-input-start", id: "tc-1", toolName: "myTool" },
        { type: "tool-input-delta", id: "tc-1", delta: '{"key":' },
        { type: "tool-input-delta", id: "tc-1", delta: '"value"}' },
        { type: "tool-input-end", id: "tc-1" },
        toolCallPart("tc-1", "myTool", { key: "value" }),
        finishPart("tool-calls"),
      ]),
      prompt: "Hi",
      tools: {
        myTool: tool({
          inputSchema: objectSchema<{ key: string }>({
            key: { type: "string" },
          }),
          execute: async () => ({ result: "ok" }),
        }),
      },
    });

    const { events } = await convert(result.fullStream);
    const toolEvents = events.filter(isToolEvent);

    expectEventSequence(toolEvents, [
      EventType.TOOL_CALL_START,
      EventType.TOOL_CALL_ARGS,
      EventType.TOOL_CALL_ARGS,
      EventType.TOOL_CALL_END,
      EventType.TOOL_CALL_RESULT,
    ]);
    expect(toolEvents[0]).toMatchObject({
      toolCallId: "tc-1",
      toolCallName: "myTool",
    });
    expect(toolEvents[1]).toMatchObject({ delta: '{"key":' });
    expect(toolEvents[2]).toMatchObject({ delta: '"value"}' });
    expect(toolEvents[4]).toMatchObject({ toolCallId: "tc-1" });
    expect(JSON.parse(eventField<string>(toolEvents[4], "content"))).toEqual({
      result: "ok",
    });
  });

  it("turns a needsApproval tool call into a tool_approval interrupt", async () => {
    const execute = vi.fn(async () => "booked");
    const result = streamText({
      model: modelEmitting([
        toolCallPart("tc-approve", "bookFlight", { destination: "Tokyo" }),
        finishPart("tool-calls"),
      ]),
      prompt: "Book a flight",
      tools: {
        bookFlight: tool({
          inputSchema: bookFlightInput,
          needsApproval: true,
          execute,
        }),
      },
    });

    const { events, interrupts } = await convert(result.fullStream);

    expectEventSequence(events.filter(isToolEvent), [
      EventType.TOOL_CALL_START,
      EventType.TOOL_CALL_ARGS,
      EventType.TOOL_CALL_END,
    ]);
    expect(interrupts).toEqual([
      {
        id: "tc-approve",
        toolCallId: "tc-approve",
        reason: "tool_approval",
        message: 'Approve "bookFlight"?',
        metadata: { toolName: "bookFlight" },
      },
    ]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not interrupt when a v7 toolApproval policy approves automatically", async () => {
    const result = streamText({
      model: modelEmitting([
        toolCallPart("tc-auto", "bookFlight", { destination: "Tokyo" }),
        finishPart("tool-calls"),
      ]),
      prompt: "Book a flight",
      tools: {
        bookFlight: tool({
          inputSchema: bookFlightInput,
          needsApproval: true,
          execute: async () => "booked",
        }),
      },
      toolApproval: { bookFlight: "approved" },
    });

    const { events, interrupts } = await convert(result.fullStream);
    const toolEvents = events.filter(isToolEvent);

    expect(interrupts).toEqual([]);
    expectEventSequence(toolEvents, [
      EventType.TOOL_CALL_START,
      EventType.TOOL_CALL_ARGS,
      EventType.TOOL_CALL_END,
      EventType.TOOL_CALL_RESULT,
    ]);
    expect(toolEvents[3]).toMatchObject({
      toolCallId: "tc-auto",
      content: '"booked"',
    });
  });

  it("emits STATE_SNAPSHOT for an AGUISendStateSnapshot tool result", async () => {
    const result = streamText({
      model: modelEmitting([
        toolCallPart("tc-state", "AGUISendStateSnapshot", {
          snapshot: { count: 1 },
        }),
        finishPart("tool-calls"),
      ]),
      prompt: "Hi",
      tools: {
        AGUISendStateSnapshot: tool({
          inputSchema: objectSchema<{ snapshot: { count: number } }>({
            snapshot: { type: "object" },
          }),
          execute: async ({ snapshot }) => ({ success: true, snapshot }),
        }),
      },
    });

    const { events } = await convert(result.fullStream);

    const snapshots = events.filter(
      (event) => event.type === EventType.STATE_SNAPSHOT,
    );
    expect(snapshots).toHaveLength(1);
    expect(eventField(snapshots[0], "snapshot")).toEqual({ count: 1 });
  });

  it("reports total usage, including v7 nested reasoning and cache counts", async () => {
    const result = streamText({
      model: modelEmitting([
        { type: "text-start", id: "txt-usage" },
        { type: "text-delta", id: "txt-usage", delta: "Hi" },
        { type: "text-end", id: "txt-usage" },
        finishPart("stop"),
      ]),
      prompt: "Hi",
    });

    const { details } = await convert(result.fullStream);

    expect(details).toEqual({
      metadata: { finishReason: "stop" },
      usage: [
        {
          inputTokens: 12,
          outputTokens: 8,
          totalTokens: 20,
          reasoningTokens: 2,
          cachedInputTokens: 3,
        },
      ],
    });
  });

  it("rethrows a model stream error", async () => {
    const result = streamText({
      model: modelEmitting([
        { type: "error", error: new Error("rate limit exceeded") },
      ]),
      prompt: "Hi",
      onError: () => {},
    });

    await expect(convert(result.fullStream)).rejects.toThrow(
      "rate limit exceeded",
    );
  });
});
