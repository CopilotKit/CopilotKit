/**
 * Regression tests for #3510. When a tool's `execute` throws, the run must
 * surface the error as a TOOL_CALL_RESULT instead of finishing with no result
 * and no error. Arguments that fail the tool's schema, including those of
 * AG-UI frontend tools, surface the same way.
 *
 * The classic tests run the real TanStack AI `chat()` against a fake model.
 * The factory test runs the real AI SDK `streamText` against a mock
 * LanguageModelV3, so it keeps `ai` (an AI SDK factory is still supported).
 */
import { describe, it, expect } from "vitest";
import { EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { streamText } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { z } from "zod";
import { BuiltInAgent, defineTool } from "../index";
import {
  convertMessagesToVercelAISDKMessages,
  convertToolDefinitionsToVercelAITools,
} from "../ai-sdk";
import {
  collectEvents,
  createDefaultInput,
  eventsOfType,
  runClassicAgent,
} from "./agent-test-helpers";

const USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
} as const;

const MESSAGES: RunAgentInput["messages"] = [
  { id: "u1", role: "user", content: "Show me a cat" },
];

const GET_CATS_CALL = { id: "tc-1", name: "get_cats", input: { limit: 1 } };

/** A `get_cats` tool whose `execute` throws `thrown`. */
function getCatsThrowing(thrown: unknown) {
  return defineTool({
    name: "get_cats",
    description: "Get cat images",
    parameters: z.object({ limit: z.number() }),
    execute: async () => {
      throw thrown;
    },
  });
}

function modelCallingGetCats() {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          {
            type: "tool-call",
            toolCallId: "tc-1",
            toolName: "get_cats",
            input: JSON.stringify({ limit: 1 }),
          },
          {
            type: "finish",
            finishReason: { unified: "tool-calls", raw: "tool-calls" },
            usage: USAGE,
          },
        ],
      }),
    }),
  });
}

function expectToolErrorSurfaced(events: BaseEvent[], content: string) {
  expect(eventsOfType(events, EventType.TOOL_CALL_RESULT)).toEqual([
    expect.objectContaining({ toolCallId: "tc-1", content }),
  ]);
  expect(eventsOfType(events, EventType.RUN_ERROR)).toEqual([]);
  expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
}

describe("tool execute throws", () => {
  it("classic BuiltInAgent emits the error as a TOOL_CALL_RESULT", async () => {
    const { events } = await runClassicAgent(
      { tools: [getCatsThrowing(new Error("Missing THE_CAT_API_KEY"))] },
      [{ toolCalls: [GET_CATS_CALL] }],
      { messages: MESSAGES },
    );

    expectToolErrorSurfaced(events, "Error: Missing THE_CAT_API_KEY");
  });

  it("classic BuiltInAgent uses a thrown non-Error value as the error text", async () => {
    const { events } = await runClassicAgent(
      { tools: [getCatsThrowing("quota exceeded")] },
      [{ toolCalls: [GET_CATS_CALL] }],
      { messages: MESSAGES },
    );

    expectToolErrorSurfaced(events, "Error: quota exceeded");
  });

  it("factory aisdk agent emits the error as a TOOL_CALL_RESULT", async () => {
    const model = modelCallingGetCats();
    const tools = convertToolDefinitionsToVercelAITools([
      getCatsThrowing(new Error("Missing THE_CAT_API_KEY")),
    ]);
    const agent = new BuiltInAgent({
      type: "aisdk",
      factory: ({ input, abortSignal }) =>
        streamText({
          model,
          messages: convertMessagesToVercelAISDKMessages(input.messages),
          tools,
          abortSignal,
        }),
    });

    const events = await collectEvents(
      agent.run(createDefaultInput({ messages: MESSAGES })),
    );

    expectToolErrorSurfaced(events, "Error: Missing THE_CAT_API_KEY");
  });
});

describe("tool arguments fail the schema", () => {
  it("frontend tool called with invalid arguments emits the validation error", async () => {
    const { events } = await runClassicAgent(
      {},
      [{ toolCalls: [{ id: "tc-1", name: "showCity", input: { city: 42 } }] }],
      {
        messages: MESSAGES,
        tools: [
          {
            name: "showCity",
            description: "Show a city",
            parameters: {
              type: "object",
              properties: { city: { type: "string" } },
              required: ["city"],
            },
          },
        ],
      },
    );

    const [result, ...rest] = eventsOfType(events, EventType.TOOL_CALL_RESULT);
    expect(rest).toEqual([]);
    expect(result?.toolCallId).toBe("tc-1");
    expect(result?.content).toMatch(
      /^Error: Input validation failed for tool showCity: #\/city: .*Expected "string"/,
    );
    expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
  });
});
