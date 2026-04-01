import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import * as v from "valibot";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import { type } from "arktype";
import {
  defineTool,
  convertToolDefinitionsToVercelAITools,
  BuiltInAgent,
} from "../index";
import type { RunAgentInput } from "@ag-ui/client";
import { streamText } from "ai";
import { mockStreamTextResponse, finish, collectEvents } from "./test-helpers";

// Mock the ai module — keep jsonSchema real for non-Zod path
vi.mock("ai", async () => {
  const actual = await vi.importActual("ai");
  return {
    ...actual,
    streamText: vi.fn(),
    tool: vi.fn((config) => config),
    stepCountIs: vi.fn((count: number) => ({ type: "stepCount", count })),
  };
});

// Mock the SDK clients
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => (modelId: string) => ({
    modelId,
    provider: "openai",
  })),
}));

describe("Standard Schema support in agent tools", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.OPENAI_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("defineTool with different schema libraries", () => {
    it("accepts a Zod schema (existing behavior)", () => {
      const tool = defineTool({
        name: "zodTool",
        description: "A tool with Zod schema",
        parameters: z.object({
          city: z.string(),
          units: z.enum(["celsius", "fahrenheit"]).optional(),
        }),
        execute: async (args) => {
          return { city: args.city };
        },
      });

      expect(tool.name).toBe("zodTool");
      expect(tool.parameters["~standard"].vendor).toBe("zod");
    });

    it("accepts a Valibot schema (via toStandardJsonSchema)", () => {
      const tool = defineTool({
        name: "valibotTool",
        description: "A tool with Valibot schema",
        parameters: toStandardJsonSchema(
          v.object({
            query: v.string(),
            limit: v.optional(v.number()),
          }),
        ),
        execute: async (args) => {
          return { query: args.query };
        },
      });

      expect(tool.name).toBe("valibotTool");
      expect(tool.parameters["~standard"].vendor).toBe("valibot");
    });

    it("accepts an ArkType schema", () => {
      const tool = defineTool({
        name: "arktypeTool",
        description: "A tool with ArkType schema",
        parameters: type({
          query: "string",
          limit: "number",
        }),
        execute: async (args) => {
          return { query: args.query };
        },
      });

      expect(tool.name).toBe("arktypeTool");
      expect(tool.parameters["~standard"].vendor).toBe("arktype");
    });
  });

  describe("convertToolDefinitionsToVercelAITools", () => {
    it("converts Zod tool definitions to AI SDK tools (passes Zod directly)", () => {
      const tools = [
        defineTool({
          name: "zodTool",
          description: "Zod test",
          parameters: z.object({ name: z.string() }),
          execute: async () => ({}),
        }),
      ];

      const aiTools = convertToolDefinitionsToVercelAITools(tools);

      expect(aiTools).toHaveProperty("zodTool");
      expect(aiTools.zodTool).toHaveProperty("description", "Zod test");
      expect(aiTools.zodTool).toHaveProperty("execute");
      expect(aiTools.zodTool.inputSchema).toBeDefined();
    });

    it("converts Valibot tool definitions to AI SDK tools", () => {
      const tools = [
        defineTool({
          name: "valibotTool",
          description: "Valibot test",
          parameters: toStandardJsonSchema(v.object({ name: v.string() })),
          execute: async () => ({}),
        }),
      ];

      const aiTools = convertToolDefinitionsToVercelAITools(tools);

      expect(aiTools).toHaveProperty("valibotTool");
      expect(aiTools.valibotTool).toHaveProperty("description", "Valibot test");
      expect(aiTools.valibotTool).toHaveProperty("execute");
      expect(aiTools.valibotTool.inputSchema).toBeDefined();
    });

    it("converts ArkType tool definitions to AI SDK tools", () => {
      const tools = [
        defineTool({
          name: "arktypeTool",
          description: "ArkType test",
          parameters: type({ name: "string" }),
          execute: async () => ({}),
        }),
      ];

      const aiTools = convertToolDefinitionsToVercelAITools(tools);

      expect(aiTools).toHaveProperty("arktypeTool");
      expect(aiTools.arktypeTool).toHaveProperty("description", "ArkType test");
      expect(aiTools.arktypeTool).toHaveProperty("execute");
      expect(aiTools.arktypeTool.inputSchema).toBeDefined();
    });

    it("converts mixed schema types in the same tool set", () => {
      const tools = [
        defineTool({
          name: "zodTool",
          description: "Zod",
          parameters: z.object({ a: z.string() }),
          execute: async () => ({}),
        }),
        defineTool({
          name: "valibotTool",
          description: "Valibot",
          parameters: toStandardJsonSchema(v.object({ b: v.string() })),
          execute: async () => ({}),
        }),
        defineTool({
          name: "arktypeTool",
          description: "ArkType",
          parameters: type({ c: "string" }),
          execute: async () => ({}),
        }),
      ];

      const aiTools = convertToolDefinitionsToVercelAITools(tools);

      expect(Object.keys(aiTools)).toEqual([
        "zodTool",
        "valibotTool",
        "arktypeTool",
      ]);
      for (const key of Object.keys(aiTools)) {
        expect(aiTools[key]).toHaveProperty("execute");
        expect(aiTools[key]).toHaveProperty("inputSchema");
      }
    });
  });

  describe("BuiltInAgent with non-Zod schemas", () => {
    it("includes Valibot-based config tools alongside input tools", async () => {
      const executeFn = vi.fn().mockResolvedValue({ result: "ok" });

      const valibotTool = defineTool({
        name: "searchValibot",
        description: "Search with Valibot schema",
        parameters: toStandardJsonSchema(v.object({ query: v.string() })),
        execute: executeFn,
      });

      const agent = new BuiltInAgent({
        model: "openai/gpt-4o",
        tools: [valibotTool],
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
      expect(callArgs.tools).toHaveProperty("searchValibot");
      expect(typeof callArgs.tools?.searchValibot.execute).toBe("function");
    });

    it("includes ArkType-based config tools alongside input tools", async () => {
      const executeFn = vi.fn().mockResolvedValue({ result: "ok" });

      const arktypeTool = defineTool({
        name: "searchArktype",
        description: "Search with ArkType schema",
        parameters: type({ query: "string" }),
        execute: executeFn,
      });

      const agent = new BuiltInAgent({
        model: "openai/gpt-4o",
        tools: [arktypeTool],
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
      expect(callArgs.tools).toHaveProperty("searchArktype");
      expect(typeof callArgs.tools?.searchArktype.execute).toBe("function");
    });

    it("mixes Zod, Valibot, and ArkType tools in one agent", async () => {
      const agent = new BuiltInAgent({
        model: "openai/gpt-4o",
        tools: [
          defineTool({
            name: "zodTool",
            description: "Zod",
            parameters: z.object({ a: z.string() }),
            execute: async () => ({}),
          }),
          defineTool({
            name: "valibotTool",
            description: "Valibot",
            parameters: toStandardJsonSchema(v.object({ b: v.string() })),
            execute: async () => ({}),
          }),
          defineTool({
            name: "arktypeTool",
            description: "ArkType",
            parameters: type({ c: "string" }),
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
      expect(callArgs.tools).toHaveProperty("zodTool");
      expect(callArgs.tools).toHaveProperty("valibotTool");
      expect(callArgs.tools).toHaveProperty("arktypeTool");
      // State tools should also be present
      expect(callArgs.tools).toHaveProperty("AGUISendStateSnapshot");
      expect(callArgs.tools).toHaveProperty("AGUISendStateDelta");
    });
  });
});
