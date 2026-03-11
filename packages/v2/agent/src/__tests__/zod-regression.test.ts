/**
 * Regression tests proving that the agent package's defineTool and
 * convertToolDefinitionsToVercelAITools still work identically with
 * Zod schemas after the Standard Schema migration.
 *
 * Covers:
 * 1. defineTool with complex Zod schemas
 * 2. convertToolDefinitionsToVercelAITools passes Zod schemas directly
 *    (not through JSON Schema conversion — critical behavioral regression)
 * 3. BuiltInAgent with Zod tools still works end-to-end
 * 4. execute callback receives correctly shaped args
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import {
  defineTool,
  convertToolDefinitionsToVercelAITools,
  BuiltInAgent,
} from "../index";
import type { RunAgentInput } from "@ag-ui/client";
import { streamText } from "ai";
import { mockStreamTextResponse, finish, collectEvents } from "./test-helpers";

vi.mock("ai", async () => {
  const actual = await vi.importActual("ai");
  return {
    ...actual,
    streamText: vi.fn(),
    tool: vi.fn((config) => config),
    stepCountIs: vi.fn((count: number) => ({ type: "stepCount", count })),
  };
});

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => (modelId: string) => ({
    modelId,
    provider: "openai",
  })),
}));

describe("defineTool Zod regression", () => {
  it("complex Zod schema with nested objects, arrays, unions", () => {
    const tool = defineTool({
      name: "complexTool",
      description: "A complex tool",
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
      execute: async (args) => {
        return { query: args.query };
      },
    });

    expect(tool.name).toBe("complexTool");
    expect(tool.parameters["~standard"].vendor).toBe("zod");
    expect(tool.parameters["~standard"].version).toBe(1);
  });

  it("Zod schema with discriminated union", () => {
    const tool = defineTool({
      name: "actionTool",
      description: "An action tool",
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
      execute: async (args) => {
        return { action: args.action.type };
      },
    });

    expect(tool.name).toBe("actionTool");
    expect(tool.parameters["~standard"].vendor).toBe("zod");
  });

  it("Zod schema with nullable and record fields", () => {
    const tool = defineTool({
      name: "flexTool",
      description: "Flexible tool",
      parameters: z.object({
        title: z.string(),
        description: z.string().nullable(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
      execute: async (args) => {
        return { title: args.title };
      },
    });

    expect(tool.name).toBe("flexTool");
    expect(tool.parameters["~standard"].vendor).toBe("zod");
  });

  it("execute callback receives correctly typed args", async () => {
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

    await tool.execute({ city: "Berlin", units: "celsius" });

    expect(receivedArgs).toHaveLength(1);
    expect(receivedArgs[0]).toEqual({ city: "Berlin", units: "celsius" });
  });
});

describe("convertToolDefinitionsToVercelAITools Zod regression", () => {
  it("Zod schemas are passed directly to AI SDK (not converted via JSON Schema)", () => {
    const zodSchema = z.object({
      city: z.string(),
      units: z.enum(["celsius", "fahrenheit"]).optional(),
    });

    const tools = [
      defineTool({
        name: "weather",
        description: "Get weather",
        parameters: zodSchema,
        execute: async () => ({ temp: 22 }),
      }),
    ];

    const aiTools = convertToolDefinitionsToVercelAITools(tools);

    expect(aiTools).toHaveProperty("weather");
    // The inputSchema should be the original Zod schema (passed directly),
    // NOT a jsonSchema() wrapper. We verify by checking the Zod-specific
    // ~standard.vendor property is preserved on the schema.
    const inputSchema = aiTools.weather.inputSchema;
    expect(inputSchema).toBeDefined();
    // For Zod schemas, the AI SDK receives the raw Zod object (which has ~standard.vendor === "zod")
    // If it went through jsonSchema(), it would lose the ~standard property
    expect(inputSchema["~standard"]?.vendor).toBe("zod");
  });

  it("multiple Zod tools all get direct pass-through", () => {
    const tools = [
      defineTool({
        name: "tool1",
        description: "Tool 1",
        parameters: z.object({ a: z.string() }),
        execute: async () => ({}),
      }),
      defineTool({
        name: "tool2",
        description: "Tool 2",
        parameters: z.object({ b: z.number(), c: z.boolean().optional() }),
        execute: async () => ({}),
      }),
      defineTool({
        name: "tool3",
        description: "Tool 3",
        parameters: z.object({
          nested: z.object({ x: z.number(), y: z.number() }),
        }),
        execute: async () => ({}),
      }),
    ];

    const aiTools = convertToolDefinitionsToVercelAITools(tools);

    for (const name of ["tool1", "tool2", "tool3"]) {
      expect(aiTools).toHaveProperty(name);
      expect(aiTools[name].inputSchema["~standard"]?.vendor).toBe("zod");
      expect(typeof aiTools[name].execute).toBe("function");
    }
  });

  it("preserves tool description and execute function", () => {
    const executeFn = vi.fn().mockResolvedValue({ result: "ok" });

    const tools = [
      defineTool({
        name: "myTool",
        description: "My custom tool description",
        parameters: z.object({ input: z.string() }),
        execute: executeFn,
      }),
    ];

    const aiTools = convertToolDefinitionsToVercelAITools(tools);

    expect(aiTools.myTool.description).toBe("My custom tool description");
    expect(aiTools.myTool.execute).toBeDefined();
  });
});

describe("BuiltInAgent Zod regression", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.OPENAI_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("Zod tools are included in streamText call", async () => {
    const agent = new BuiltInAgent({
      model: "openai/gpt-4o",
      tools: [
        defineTool({
          name: "weather",
          description: "Get weather",
          parameters: z.object({
            city: z.string(),
            units: z.enum(["celsius", "fahrenheit"]).optional(),
          }),
          execute: async () => ({ temp: 22 }),
        }),
      ],
    });

    vi.mocked(streamText).mockReturnValue(
      mockStreamTextResponse([finish()]) as any,
    );

    const input: RunAgentInput = {
      threadId: "thread1",
      runId: "run1",
      messages: [],
      tools: [],
      context: [],
      state: {},
    };

    await collectEvents(agent["run"](input));

    const callArgs = vi.mocked(streamText).mock.calls[0][0];
    expect(callArgs.tools).toHaveProperty("weather");
    expect(typeof callArgs.tools?.weather.execute).toBe("function");
  });

  it("multiple Zod tools coexist with built-in state tools", async () => {
    const agent = new BuiltInAgent({
      model: "openai/gpt-4o",
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

    vi.mocked(streamText).mockReturnValue(
      mockStreamTextResponse([finish()]) as any,
    );

    const input: RunAgentInput = {
      threadId: "thread1",
      runId: "run1",
      messages: [],
      tools: [],
      context: [],
      state: {},
    };

    await collectEvents(agent["run"](input));

    const callArgs = vi.mocked(streamText).mock.calls[0][0];
    // User-defined Zod tools
    expect(callArgs.tools).toHaveProperty("search");
    expect(callArgs.tools).toHaveProperty("calculate");
    // Built-in state tools
    expect(callArgs.tools).toHaveProperty("AGUISendStateSnapshot");
    expect(callArgs.tools).toHaveProperty("AGUISendStateDelta");
  });

  it("Zod tool execute is invocable after conversion", async () => {
    const executeFn = vi.fn().mockResolvedValue({ temp: 22 });

    const agent = new BuiltInAgent({
      model: "openai/gpt-4o",
      tools: [
        defineTool({
          name: "weather",
          description: "Get weather",
          parameters: z.object({ city: z.string() }),
          execute: executeFn,
        }),
      ],
    });

    vi.mocked(streamText).mockReturnValue(
      mockStreamTextResponse([finish()]) as any,
    );

    const input: RunAgentInput = {
      threadId: "thread1",
      runId: "run1",
      messages: [],
      tools: [],
      context: [],
      state: {},
    };

    await collectEvents(agent["run"](input));

    const callArgs = vi.mocked(streamText).mock.calls[0][0];
    const weatherTool = callArgs.tools?.weather;

    // Invoke the execute function to verify it's wired correctly
    await weatherTool.execute({ city: "Berlin" });
    expect(executeFn).toHaveBeenCalledWith({ city: "Berlin" });
  });
});
