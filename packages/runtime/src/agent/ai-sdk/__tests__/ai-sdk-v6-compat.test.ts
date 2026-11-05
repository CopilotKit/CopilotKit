/**
 * The AI SDK helpers produce input that ai@6 `streamText` accepts and hands
 * to a LanguageModelV3 (`specificationVersion: "v3"`) model.
 */
import { describe, expect, it } from "vitest";
import type { Message } from "@ag-ui/client";
import { stepCountIs, streamText } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { z } from "zod";
import {
  convertMessagesToVercelAISDKMessages,
  convertToolDefinitionsToVercelAITools,
  convertToolsToVercelAITools,
} from "../index";
import { defineTool } from "../../index";

type StreamPart =
  Awaited<
    ReturnType<MockLanguageModelV3["doStream"]>
  >["stream"] extends ReadableStream<infer Part>
    ? Part
    : never;

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

/** A model that streams `steps[n]` on its nth call. */
function scriptedModel(steps: StreamPart[][]) {
  let call = 0;
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({ chunks: steps[call++] ?? [] }),
    }),
  });
}

function toolCallStep(toolName: string, input: unknown): StreamPart[] {
  return [
    {
      type: "tool-call",
      toolCallId: "call-1",
      toolName,
      input: JSON.stringify(input),
    },
    {
      type: "finish",
      finishReason: { unified: "tool-calls", raw: "tool_calls" },
      usage,
    },
  ];
}

const textStep: StreamPart[] = [
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta: "Hello from V3 model" },
  { type: "text-end", id: "t" },
  { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
];

async function collect(result: ReturnType<typeof streamText>) {
  const parts = [];
  for await (const part of result.fullStream) parts.push(part);
  return parts;
}

describe("AI SDK v6 compatibility of the helpers", () => {
  it("sends converted AG-UI messages to a LanguageModelV3", async () => {
    const model = scriptedModel([textStep]);
    expect(model.specificationVersion).toBe("v3");
    const messages: Message[] = [
      { id: "1", role: "user", content: "Hi" },
      {
        id: "2",
        role: "assistant",
        toolCalls: [
          {
            id: "c1",
            type: "function",
            function: { name: "get_weather", arguments: '{"city":"Paris"}' },
          },
        ],
      },
      { id: "3", role: "tool", toolCallId: "c1", content: "sunny" },
    ];

    const result = streamText({
      model,
      messages: convertMessagesToVercelAISDKMessages(messages),
    });

    expect(await result.text).toBe("Hello from V3 model");
    expect(model.doStreamCalls[0]!.prompt).toMatchObject([
      { role: "user", content: [{ type: "text", text: "Hi" }] },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "c1",
            toolName: "get_weather",
            input: { city: "Paris" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "c1",
            toolName: "get_weather",
            output: { type: "text", value: "sunny" },
          },
        ],
      },
    ]);
  });

  it("passes AG-UI tool JSON Schema to the model and leaves the call to the client", async () => {
    const parameters = {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    };
    const model = scriptedModel([
      toolCallStep("show_city", { city: "Paris" }),
      textStep,
    ]);

    const parts = await collect(
      streamText({
        model,
        prompt: "hi",
        tools: convertToolsToVercelAITools([
          { name: "show_city", description: "Show a city.", parameters },
        ]),
        stopWhen: stepCountIs(2),
      }),
    );

    expect(model.doStreamCalls[0]!.tools).toEqual([
      {
        type: "function",
        name: "show_city",
        description: "Show a city.",
        inputSchema: parameters,
      },
    ]);
    expect(parts.filter((part) => part.type === "tool-call")).toMatchObject([
      { toolName: "show_city", input: { city: "Paris" } },
    ]);
    expect(parts.some((part) => part.type === "tool-result")).toBe(false);
  });

  it("offers a defineTool() tool's JSON Schema and runs execute with the parsed arguments", async () => {
    const weather = defineTool({
      name: "get_weather",
      description: "Get the weather.",
      parameters: z.object({
        city: z.string(),
        units: z.string().default("celsius"),
      }),
      execute: async (args) => `sunny for ${JSON.stringify(args)}`,
    });
    const model = scriptedModel([
      toolCallStep("get_weather", { city: "Paris" }),
      textStep,
    ]);

    const parts = await collect(
      streamText({
        model,
        prompt: "hi",
        tools: convertToolDefinitionsToVercelAITools([weather]),
        stopWhen: stepCountIs(2),
      }),
    );

    expect(model.doStreamCalls[0]!.tools).toMatchObject([
      {
        type: "function",
        name: "get_weather",
        inputSchema: {
          type: "object",
          properties: { city: { type: "string" }, units: { type: "string" } },
          required: ["city"],
        },
      },
    ]);
    expect(parts.find((part) => part.type === "tool-result")).toMatchObject({
      toolName: "get_weather",
      output: 'sunny for {"city":"Paris","units":"celsius"}',
    });
  });
});
