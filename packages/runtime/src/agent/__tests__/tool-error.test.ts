/**
 * Regression tests for #3510, driven by the REAL AI SDK `streamText` (via a
 * mock LanguageModelV3 — no network). When a tool's `execute` throws,
 * `streamText` emits a `tool-error` part. Both the classic BuiltInAgent path
 * and the factory (`convertAISDKStream`) path must surface it as a
 * TOOL_CALL_RESULT instead of finishing the run with no result and no error.
 * `streamText` also emits `tool-error` when a call's arguments fail the tool's
 * schema, including AG-UI frontend tools validated on the server.
 */
import { describe, it, expect } from "vitest";
import { EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { streamText, tool } from "ai";
import type { FlexibleSchema } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { z } from "zod";
import {
  BuiltInAgent,
  convertMessagesToVercelAISDKMessages,
  defineTool,
} from "../index";
import { collectEvents, createDefaultInput } from "./agent-test-helpers";

const USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
} as const;

type GetCatsInput = { limit: number };

const getCatsSchema = z.object({ limit: z.number() });

function modelCallingGetCats(): MockLanguageModelV3 {
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

function throwMissingKey(): never {
  throw new Error("Missing THE_CAT_API_KEY");
}

const runInput = createDefaultInput({
  messages: [
    { id: "u1", role: "user", content: "Show me a cat" },
  ] as RunAgentInput["messages"],
});

function expectToolErrorSurfaced(events: BaseEvent[]) {
  const results = events.filter((e) => e.type === EventType.TOOL_CALL_RESULT);
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({
    toolCallId: "tc-1",
    content: "Error: Missing THE_CAT_API_KEY",
  });
  expect(events.some((e) => e.type === EventType.RUN_ERROR)).toBe(false);
  expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
}

describe("tool execute throws (real streamText)", () => {
  it("classic BuiltInAgent emits the error as a TOOL_CALL_RESULT", async () => {
    const agent = new BuiltInAgent({
      model: modelCallingGetCats(),
      tools: [
        defineTool({
          name: "get_cats",
          description: "Get cat images",
          parameters: getCatsSchema,
          execute: async () => throwMissingKey(),
        }),
      ],
    });

    expectToolErrorSurfaced(await collectEvents(agent.run(runInput)));
  });

  it("factory aisdk agent emits the error as a TOOL_CALL_RESULT", async () => {
    const model = modelCallingGetCats();
    const agent = new BuiltInAgent({
      type: "aisdk",
      factory: ({ input, abortSignal }) =>
        streamText({
          model,
          messages: convertMessagesToVercelAISDKMessages(input.messages),
          tools: {
            get_cats: tool<GetCatsInput, string>({
              description: "Get cat images",
              inputSchema:
                getCatsSchema as unknown as FlexibleSchema<GetCatsInput>,
              execute: async () => throwMissingKey(),
            }),
          },
          abortSignal,
        }),
    });

    expectToolErrorSurfaced(await collectEvents(agent.run(runInput)));
  });

  it("frontend tool called with invalid arguments emits the validation error", async () => {
    const model = new MockLanguageModelV3({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            {
              type: "tool-call",
              toolCallId: "tc-1",
              toolName: "showCity",
              input: JSON.stringify({ city: 42 }),
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
    const agent = new BuiltInAgent({ model });

    const events = await collectEvents(
      agent.run({
        ...runInput,
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
      }),
    );

    const results = events.filter((e) => e.type === EventType.TOOL_CALL_RESULT);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ toolCallId: "tc-1" });
    expect((results[0] as unknown as { content: string }).content).toMatch(
      /^Error: Invalid input for tool showCity: .*Invalid arguments for tool showCity/s,
    );
    expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
  });
});
