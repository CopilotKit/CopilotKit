import { describe, expect, it } from "vitest";
import { toolDefinition } from "@tanstack/ai";
import type { AnyServerTool } from "@tanstack/ai";
import { asSchema, stepCountIs, streamText } from "ai";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { z } from "zod";
import { toAISDKTools } from "../index";

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
  { type: "text-delta", id: "t", delta: "done" },
  { type: "text-end", id: "t" },
  { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage },
];

/** A learned-skill style server tool: a plain object with JSON Schema input. */
function loadSkillTool(calls: unknown[]): AnyServerTool {
  return {
    __toolSide: "server",
    name: "copilotkit_load_skill",
    description: "Load a skill.",
    inputSchema: {
      type: "object",
      properties: { skill_name: { type: "string" } },
      required: ["skill_name"],
      additionalProperties: false,
    },
    execute: async (input: { skill_name: string }) => {
      calls.push(input);
      return `# ${input.skill_name}`;
    },
  };
}

async function inputJsonSchemaOf(
  tools: ReturnType<typeof toAISDKTools>,
  name: string,
) {
  return asSchema(tools[name]!.inputSchema).jsonSchema;
}

describe("toAISDKTools", () => {
  it("runs a plain server tool's execute with the parsed input inside streamText", async () => {
    const calls: unknown[] = [];
    const model = scriptedModel([
      toolCallStep("copilotkit_load_skill", { skill_name: "refunds" }),
      textStep,
    ]);

    const result = streamText({
      model,
      prompt: "hi",
      tools: toAISDKTools([loadSkillTool(calls)]),
      stopWhen: stepCountIs(2),
    });
    const parts = [];
    for await (const part of result.fullStream) parts.push(part);

    expect(calls).toEqual([{ skill_name: "refunds" }]);
    expect(parts.find((part) => part.type === "tool-result")).toMatchObject({
      toolName: "copilotkit_load_skill",
      input: { skill_name: "refunds" },
      output: "# refunds",
    });
    expect(model.doStreamCalls[0]!.tools).toEqual([
      {
        type: "function",
        name: "copilotkit_load_skill",
        description: "Load a skill.",
        inputSchema: {
          type: "object",
          properties: { skill_name: { type: "string" } },
          required: ["skill_name"],
          additionalProperties: false,
        },
      },
    ]);
    expect(await result.text).toBe("done");
  });

  it("leaves a tool without execute to the client", async () => {
    const model = scriptedModel([
      toolCallStep("confirm", { reason: "refund" }),
      textStep,
    ]);
    const confirm = toolDefinition({
      name: "confirm",
      description: "Ask the user to confirm.",
      inputSchema: z.object({ reason: z.string() }),
    }).client();

    const tools = toAISDKTools([confirm]);
    const result = streamText({
      model,
      prompt: "hi",
      tools,
      stopWhen: stepCountIs(2),
    });
    const parts = [];
    for await (const part of result.fullStream) parts.push(part);

    expect(tools.confirm!.execute).toBeUndefined();
    expect(parts.filter((part) => part.type === "tool-call")).toMatchObject([
      { toolName: "confirm", input: { reason: "refund" } },
    ]);
    expect(parts.some((part) => part.type === "tool-result")).toBe(false);
    // The run stops at the client tool call: the model is not called again.
    expect(model.doStreamCalls).toHaveLength(1);
  });

  it("converts a zod inputSchema from toolDefinition().server() to JSON Schema", async () => {
    const lookup = toolDefinition({
      name: "lookup_order",
      description: "Find an order.",
      inputSchema: z.object({
        id: z.string(),
        limit: z.number().optional(),
      }),
    }).server(async ({ id }) => ({ id, status: "open" }));

    const tools = toAISDKTools([lookup]);

    expect(await inputJsonSchemaOf(tools, "lookup_order")).toMatchObject({
      type: "object",
      properties: { id: { type: "string" }, limit: { type: "number" } },
      required: ["id"],
    });
    expect(
      await tools.lookup_order!.execute!(
        { id: "o-1" },
        { toolCallId: "call-1", messages: [] },
      ),
    ).toEqual({ id: "o-1", status: "open" });
  });

  it("gives a tool without inputSchema an empty object schema", async () => {
    const ping: AnyServerTool = {
      __toolSide: "server",
      name: "ping",
      description: "Ping.",
    };

    const tools = toAISDKTools([ping]);

    expect(await inputJsonSchemaOf(tools, "ping")).toEqual({
      type: "object",
      properties: {},
    });
  });

  it("keeps needsApproval", () => {
    const refund = toolDefinition({
      name: "refund",
      description: "Refund an order.",
      inputSchema: z.object({ id: z.string() }),
      needsApproval: true,
    }).server(async () => "refunded");

    expect(toAISDKTools([refund]).refund!.needsApproval).toBe(true);
  });
});
