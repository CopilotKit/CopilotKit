/**
 * Zod tools after the Standard Schema migration, ported from the classic
 * BuiltInAgent `zod-regression.test.ts`:
 * 1. `defineTool` keeps complex Zod schemas.
 * 2. `convertToolDefinitionsToVercelAITools` passes Zod schemas to the AI SDK
 *    as they are, not through JSON Schema.
 * 3. `aiSdkAgent` offers and runs Zod tools end to end.
 */
import { describe, expect, it } from "vitest";
import { EventType } from "@ag-ui/client";
import { z } from "zod";
import { defineTool } from "../../agent";
import { eventField } from "../../agent/__tests__/agent-test-helpers";
import { aiSdkAgent } from "../agent";
import { convertToolDefinitionsToVercelAITools } from "../tools";
import {
  eventsOfType,
  modelEmitting,
  offeredToolNames,
  runAgent,
  textTurn,
  toolCallTurn,
} from "./mock-model";

const toolCallOptions = { toolCallId: "tool-call-1", messages: [] };

describe("defineTool with Zod", () => {
  it.each([
    {
      name: "nested objects, arrays, and defaults",
      parameters: z.object({
        query: z.string().describe("Search query"),
        filters: z
          .object({
            category: z.enum(["books", "movies", "music"]).optional(),
            minRating: z.number().min(0).max(5).optional(),
            tags: z.array(z.string()).optional(),
          })
          .optional(),
        pagination: z
          .object({
            page: z.number().int().positive().default(1),
            perPage: z.number().int().positive().default(20),
          })
          .optional(),
      }),
    },
    {
      name: "a discriminated union",
      parameters: z.object({
        action: z.discriminatedUnion("type", [
          z.object({ type: z.literal("search"), query: z.string() }),
          z.object({ type: z.literal("navigate"), url: z.string().url() }),
          z.object({
            type: z.literal("execute"),
            code: z.string(),
            language: z.enum(["javascript", "python"]),
          }),
        ]),
      }),
    },
    {
      name: "nullable and record fields",
      parameters: z.object({
        title: z.string(),
        description: z.string().nullable(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    },
  ])("keeps a Zod schema with $name", ({ parameters }) => {
    const tool = defineTool({
      name: "zodTool",
      description: "A Zod tool",
      parameters,
      execute: async () => ({}),
    });

    expect(tool.parameters).toBe(parameters);
    expect(tool.parameters["~standard"].vendor).toBe("zod");
    expect(tool.parameters["~standard"].version).toBe(1);
  });

  it("calls execute with the arguments it gets", async () => {
    const receivedArgs: unknown[] = [];
    const tool = defineTool({
      name: "argCapture",
      description: "Captures args",
      parameters: z.object({
        city: z.string(),
        units: z.enum(["celsius", "fahrenheit"]),
      }),
      execute: async (args) => {
        receivedArgs.push(args);
        return { temp: 22 };
      },
    });

    const result = await tool.execute?.({ city: "Berlin", units: "celsius" });

    expect(result).toEqual({ temp: 22 });
    expect(receivedArgs).toEqual([{ city: "Berlin", units: "celsius" }]);
  });
});

describe("convertToolDefinitionsToVercelAITools with Zod", () => {
  it("passes each Zod schema to the AI SDK as it is", () => {
    const schemas = {
      tool1: z.object({ a: z.string() }),
      tool2: z.object({ b: z.number(), c: z.boolean().optional() }),
      tool3: z.object({ nested: z.object({ x: z.number(), y: z.number() }) }),
    };
    const tools = Object.entries(schemas).map(([name, parameters]) =>
      defineTool({
        name,
        description: name,
        parameters,
        execute: async () => ({}),
      }),
    );

    const aiTools = convertToolDefinitionsToVercelAITools(tools);

    expect(aiTools.tool1.inputSchema).toBe(schemas.tool1);
    expect(aiTools.tool2.inputSchema).toBe(schemas.tool2);
    expect(aiTools.tool3.inputSchema).toBe(schemas.tool3);
  });

  it("keeps the description and runs the tool's execute", async () => {
    const tools = [
      defineTool({
        name: "myTool",
        description: "My custom tool description",
        parameters: z.object({ input: z.string() }),
        execute: async ({ input }) => ({ echoed: input }),
      }),
    ];

    const aiTools = convertToolDefinitionsToVercelAITools(tools);

    expect(aiTools.myTool.description).toBe("My custom tool description");
    await expect(
      aiTools.myTool.execute?.({ input: "hi" }, toolCallOptions),
    ).resolves.toEqual({ echoed: "hi" });
  });
});

describe("aiSdkAgent with Zod tools", () => {
  it("offers several Zod tools next to the state tools", async () => {
    const model = modelEmitting(textTurn("ok"));
    const agent = aiSdkAgent({
      model,
      tools: [
        defineTool({
          name: "search",
          description: "Search",
          parameters: z.object({ query: z.string() }),
          execute: async () => ({}),
        }),
        defineTool({
          name: "calculate",
          description: "Calculate",
          parameters: z.object({
            expression: z.string(),
            precision: z.number().int().optional(),
          }),
          execute: async () => ({}),
        }),
      ],
    });

    await runAgent(agent);

    expect(offeredToolNames(model)).toEqual([
      "AGUISendStateSnapshot",
      "AGUISendStateDelta",
      "search",
      "calculate",
    ]);
  });

  it("runs a Zod tool with the model's arguments", async () => {
    const receivedArgs: unknown[] = [];
    const model = modelEmitting(
      toolCallTurn("tc-1", "weather", { city: "Berlin" }),
    );
    const agent = aiSdkAgent({
      model,
      tools: [
        defineTool({
          name: "weather",
          description: "Get weather",
          parameters: z.object({ city: z.string() }),
          execute: async (args) => {
            receivedArgs.push(args);
            return { temp: 22 };
          },
        }),
      ],
    });

    const events = await runAgent(agent);

    expect(receivedArgs).toEqual([{ city: "Berlin" }]);
    const result = eventsOfType(events, EventType.TOOL_CALL_RESULT)[0];
    expect(eventField(result, "content")).toBe('{"temp":22}');
  });
});
