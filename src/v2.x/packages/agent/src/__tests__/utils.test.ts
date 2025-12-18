import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import {
  resolveModel,
  convertMessagesToVercelAISDKMessages,
  convertJsonSchemaToZodSchema,
  convertToolsToVercelAITools,
  convertToolDefinitionsToVercelAITools,
  defineTool,
  type ToolDefinition,
} from "../index";
import type { Message } from "@ag-ui/client";

describe("resolveModel", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
    process.env.GOOGLE_API_KEY = "test-google-key";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should resolve OpenAI models with / separator", () => {
    const model = resolveModel("openai/gpt-4o");
    expect(model).toBeDefined();
    expect(model.modelId).toBe("gpt-4o");
  });

  it("should resolve OpenAI models with : separator", () => {
    const model = resolveModel("openai:gpt-4o-mini");
    expect(model).toBeDefined();
    expect(model.modelId).toBe("gpt-4o-mini");
  });

  it("should resolve Anthropic models", () => {
    const model = resolveModel("anthropic/claude-sonnet-4.5");
    expect(model).toBeDefined();
    expect(model.modelId).toBe("claude-sonnet-4.5");
  });

  it("should resolve Google models", () => {
    const model = resolveModel("google/gemini-2.5-pro");
    expect(model).toBeDefined();
    expect(model.modelId).toBe("gemini-2.5-pro");
  });

  it("should handle gemini provider alias", () => {
    const model = resolveModel("gemini/gemini-2.5-flash");
    expect(model).toBeDefined();
    expect(model.modelId).toBe("gemini-2.5-flash");
  });

  it("should throw error for invalid format", () => {
    expect(() => resolveModel("invalid")).toThrow("Invalid model string");
  });

  it("should throw error for unknown provider", () => {
    expect(() => resolveModel("unknown/model")).toThrow("Unknown provider");
  });

  it("should pass through LanguageModel instances", () => {
    const mockModel = resolveModel("openai/gpt-4o");
    const result = resolveModel(mockModel as any);
    expect(result).toBe(mockModel);
  });
});

describe("convertMessagesToVercelAISDKMessages", () => {
  it("should convert user messages", () => {
    const messages: Message[] = [
      {
        id: "1",
        role: "user",
        content: "Hello",
      },
    ];

    const result = convertMessagesToVercelAISDKMessages(messages);

    expect(result).toEqual([
      {
        role: "user",
        content: "Hello",
      },
    ]);
  });

  it("should convert assistant messages with text content", () => {
    const messages: Message[] = [
      {
        id: "1",
        role: "assistant",
        content: "Hello there",
      },
    ];

    const result = convertMessagesToVercelAISDKMessages(messages);

    expect(result).toEqual([
      {
        role: "assistant",
        content: [{ type: "text", text: "Hello there" }],
      },
    ]);
  });

  it("should convert assistant messages with tool calls", () => {
    const messages: Message[] = [
      {
        id: "1",
        role: "assistant",
        content: "Let me help",
        toolCalls: [
          {
            id: "call1",
            type: "function",
            function: {
              name: "getTool",
              arguments: '{"arg":"value"}',
            },
          },
        ],
      },
    ];

    const result = convertMessagesToVercelAISDKMessages(messages);

    expect(result[0]).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "Let me help" },
        {
          type: "tool-call",
          toolCallId: "call1",
          toolName: "getTool",
          input: { arg: "value" },
        },
      ],
    });
  });

  it("should convert tool messages", () => {
    const messages: Message[] = [
      {
        id: "1",
        role: "assistant",
        toolCalls: [
          {
            id: "call1",
            type: "function",
            function: {
              name: "getTool",
              arguments: '{}',
            },
          },
        ],
      },
      {
        id: "2",
        role: "tool",
        content: "result",
        toolCallId: "call1",
      },
    ];

    const result = convertMessagesToVercelAISDKMessages(messages);

    expect(result[1]).toEqual({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call1",
          toolName: "getTool",
          output: {
            type: "text",
            value: "result",
          },
        },
      ],
    });
  });

  it("should handle multiple messages", () => {
    const messages: Message[] = [
      { id: "1", role: "user", content: "Hi" },
      { id: "2", role: "assistant", content: "Hello" },
      { id: "3", role: "user", content: "How are you?" },
    ];

    const result = convertMessagesToVercelAISDKMessages(messages);

    expect(result).toHaveLength(3);
    expect(result[0].role).toBe("user");
    expect(result[1].role).toBe("assistant");
    expect(result[2].role).toBe("user");
  });
});

describe("convertJsonSchemaToZodSchema", () => {
  it("should convert string schema", () => {
    const jsonSchema = {
      type: "string" as const,
      description: "A string field",
    };

    const zodSchema = convertJsonSchemaToZodSchema(jsonSchema, true);
    expect(zodSchema.parse("test")).toBe("test");
    expect(() => zodSchema.parse(123)).toThrow();
  });

  it("should convert number schema", () => {
    const jsonSchema = {
      type: "number" as const,
      description: "A number field",
    };

    const zodSchema = convertJsonSchemaToZodSchema(jsonSchema, true);
    expect(zodSchema.parse(123)).toBe(123);
    expect(() => zodSchema.parse("test")).toThrow();
  });

  it("should convert boolean schema", () => {
    const jsonSchema = {
      type: "boolean" as const,
      description: "A boolean field",
    };

    const zodSchema = convertJsonSchemaToZodSchema(jsonSchema, true);
    expect(zodSchema.parse(true)).toBe(true);
    expect(() => zodSchema.parse("true")).toThrow();
  });

  it("should convert array schema", () => {
    const jsonSchema = {
      type: "array" as const,
      description: "An array field",
      items: {
        type: "string" as const,
      },
    };

    const zodSchema = convertJsonSchemaToZodSchema(jsonSchema, true);
    expect(zodSchema.parse(["a", "b"])).toEqual(["a", "b"]);
    expect(() => zodSchema.parse([1, 2])).toThrow();
  });

  it("should convert object schema with properties", () => {
    const jsonSchema = {
      type: "object" as const,
      description: "An object",
      properties: {
        name: { type: "string" as const },
        age: { type: "number" as const },
      },
      required: ["name"],
    };

    const zodSchema = convertJsonSchemaToZodSchema(jsonSchema, true);
    const valid = zodSchema.parse({ name: "John", age: 30 });
    expect(valid).toEqual({ name: "John", age: 30 });

    expect(() => zodSchema.parse({ age: 30 })).toThrow();
  });

  it("should make schema optional when required is false", () => {
    const jsonSchema = {
      type: "string" as const,
      description: "Optional string",
    };

    const zodSchema = convertJsonSchemaToZodSchema(jsonSchema, false);
    expect(zodSchema.parse(undefined)).toBeUndefined();
    expect(zodSchema.parse("test")).toBe("test");
  });

  it("should handle nested object schemas", () => {
    const jsonSchema = {
      type: "object" as const,
      properties: {
        user: {
          type: "object" as const,
          properties: {
            name: { type: "string" as const },
          },
          required: ["name"],
        },
      },
      required: ["user"],
    };

    const zodSchema = convertJsonSchemaToZodSchema(jsonSchema, true);
    const valid = zodSchema.parse({ user: { name: "John" } });
    expect(valid).toEqual({ user: { name: "John" } });
  });
});

describe("convertToolsToVercelAITools", () => {
  it("should convert AG-UI tools to Vercel AI tools", () => {
    const tools = [
      {
        name: "testTool",
        description: "A test tool",
        parameters: {
          type: "object" as const,
          properties: {
            input: { type: "string" as const },
          },
          required: ["input"],
        },
      },
    ];

    const result = convertToolsToVercelAITools(tools);

    expect(result).toHaveProperty("testTool");
    expect(result.testTool).toBeDefined();
  });

  it("should throw error for invalid JSON schema", () => {
    const tools = [
      {
        name: "testTool",
        description: "A test tool",
        parameters: { invalid: "schema" } as any,
      },
    ];

    expect(() => convertToolsToVercelAITools(tools)).toThrow("Invalid JSON schema");
  });

  it("should handle multiple tools", () => {
    const tools = [
      {
        name: "tool1",
        description: "First tool",
        parameters: {
          type: "object" as const,
          properties: {},
        },
      },
      {
        name: "tool2",
        description: "Second tool",
        parameters: {
          type: "object" as const,
          properties: {},
        },
      },
    ];

    const result = convertToolsToVercelAITools(tools);

    expect(result).toHaveProperty("tool1");
    expect(result).toHaveProperty("tool2");
  });
});

describe("convertToolDefinitionsToVercelAITools", () => {
  it("should convert ToolDefinitions to Vercel AI tools", () => {
    const tools: ToolDefinition[] = [
      {
        name: "testTool",
        description: "A test tool",
        parameters: z.object({
          input: z.string(),
        }),
      },
    ];

    const result = convertToolDefinitionsToVercelAITools(tools);

    expect(result).toHaveProperty("testTool");
    expect(result.testTool).toBeDefined();
  });

  it("should handle multiple tool definitions", () => {
    const tools: ToolDefinition[] = [
      {
        name: "tool1",
        description: "First tool",
        parameters: z.object({}),
      },
      {
        name: "tool2",
        description: "Second tool",
        parameters: z.object({ value: z.number() }),
      },
    ];

    const result = convertToolDefinitionsToVercelAITools(tools);

    expect(result).toHaveProperty("tool1");
    expect(result).toHaveProperty("tool2");
    expect(Object.keys(result)).toHaveLength(2);
  });
});

describe("defineTool", () => {
  it("should create a ToolDefinition", () => {
    const tool = defineTool({
      name: "myTool",
      description: "My test tool",
      parameters: z.object({
        input: z.string(),
      }),
    });

    expect(tool).toEqual({
      name: "myTool",
      description: "My test tool",
      parameters: expect.any(Object),
    });

    expect(tool.name).toBe("myTool");
    expect(tool.description).toBe("My test tool");
  });

  it("should preserve type information", () => {
    const tool = defineTool({
      name: "calc",
      description: "Calculate",
      parameters: z.object({
        a: z.number(),
        b: z.number(),
      }),
    });

    // Should be able to parse valid input
    const result = tool.parameters.parse({ a: 1, b: 2 });
    expect(result).toEqual({ a: 1, b: 2 });
  });
});
