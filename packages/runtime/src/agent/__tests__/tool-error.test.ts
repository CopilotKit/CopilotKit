/**
 * Regression tests for #3510, driven by the REAL AI SDK `streamText` (via a
 * mock LanguageModelV3 — no network). When a tool's `execute` throws,
 * `streamText` emits a `tool-error` part. The factory (`convertAISDKStream`)
 * path must surface it as a TOOL_CALL_RESULT instead of finishing the run with
 * no result and no error.
 */
import { describe, it, expect } from "vitest";
import { EventType } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";
import { jsonSchema, streamText, tool } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { BuiltInAgent } from "../index";
import { convertMessagesToVercelAISDKMessages } from "../../ai-sdk/messages";
import { collectEvents, createDefaultInput } from "./agent-test-helpers";

const USAGE = {
  inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 0, text: 0, reasoning: 0 },
} as const;

type GetCatsInput = { limit: number };

const getCatsSchema = jsonSchema<GetCatsInput>({
  type: "object",
  properties: { limit: { type: "number" } },
  required: ["limit"],
});

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
  messages: [{ id: "u1", role: "user", content: "Show me a cat" }],
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
              inputSchema: getCatsSchema,
              execute: async () => throwMissingKey(),
            }),
          },
          abortSignal,
        }),
    });

    expectToolErrorSurfaced(await collectEvents(agent.run(runInput)));
  });
});
