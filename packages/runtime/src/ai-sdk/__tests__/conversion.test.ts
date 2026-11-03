import { describe, it, expect } from "vitest";
import { z } from "zod";
import type { ToolDefinition } from "../../agent";
import { convertMessagesToVercelAISDKMessages } from "../messages";
import {
  convertJsonSchemaToZodSchema,
  convertToolsToVercelAITools,
  convertToolDefinitionsToVercelAITools,
} from "../tools";
import type { Message } from "@ag-ui/client";

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
              arguments: "{}",
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

  it("should preserve string enum constraints", () => {
    const jsonSchema = {
      type: "object" as const,
      properties: {
        status: {
          type: "string" as const,
          description: "The status",
          enum: ["todo", "done"],
        },
      },
      required: ["status"],
    };
    const result = convertJsonSchemaToZodSchema(jsonSchema, true);
    const statusSchema = (result as z.ZodObject<any>).shape.status;
    expect(statusSchema).toBeInstanceOf(z.ZodEnum);
    expect(statusSchema.options).toEqual(["todo", "done"]);
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

  it("should convert anyOf/oneOf unions to a Zod union instead of dropping them", () => {
    // A frontend tool authored with z.discriminatedUnion serializes to a node
    // carrying `anyOf` (or `oneOf`) and no top-level `type`. Previously this hit
    // the empty-schema guard and collapsed to z.object({}), silently dropping
    // the union. It must become a real z.union so both variants survive.
    const jsonSchema = {
      anyOf: [
        {
          type: "object" as const,
          properties: {
            kind: { type: "string" as const, enum: ["text"] },
            text: { type: "string" as const },
          },
          required: ["kind", "text"],
        },
        {
          type: "object" as const,
          properties: {
            kind: { type: "string" as const, enum: ["image"] },
            url: { type: "string" as const },
          },
          required: ["kind", "url"],
        },
      ],
    };

    const zodSchema = convertJsonSchemaToZodSchema(jsonSchema, true);
    expect(zodSchema).toBeInstanceOf(z.ZodUnion);
    expect(zodSchema.parse({ kind: "text", text: "hi" })).toEqual({
      kind: "text",
      text: "hi",
    });
    expect(zodSchema.parse({ kind: "image", url: "http://x/y.png" })).toEqual({
      kind: "image",
      url: "http://x/y.png",
    });
  });

  it("should preserve a union nested inside array items (the oneOf trap)", () => {
    // The exact reported trap: a z.discriminatedUnion inside array items. The
    // union node must survive conversion; before the fix the array items became
    // an empty object and the union-typed data was lost.
    const jsonSchema = {
      type: "object" as const,
      properties: {
        blocks: {
          type: "array" as const,
          items: {
            oneOf: [
              {
                type: "object" as const,
                properties: {
                  type: { type: "string" as const, enum: ["heading"] },
                  level: { type: "number" as const },
                },
                required: ["type", "level"],
              },
              {
                type: "object" as const,
                properties: {
                  type: { type: "string" as const, enum: ["paragraph"] },
                  content: { type: "string" as const },
                },
                required: ["type", "content"],
              },
            ],
          },
        },
      },
      required: ["blocks"],
    };

    const zodSchema = convertJsonSchemaToZodSchema(jsonSchema, true);
    const parsed = zodSchema.parse({
      blocks: [
        { type: "heading", level: 1 },
        { type: "paragraph", content: "hello" },
      ],
    });
    expect(parsed).toEqual({
      blocks: [
        { type: "heading", level: 1 },
        { type: "paragraph", content: "hello" },
      ],
    });
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
        parameters: { invalid: "schema" },
      },
    ];

    expect(() => convertToolsToVercelAITools(tools)).toThrow(
      "Invalid JSON schema",
    );
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
        execute: async () => undefined,
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
        execute: async () => undefined,
      },
      {
        name: "tool2",
        description: "Second tool",
        parameters: z.object({ value: z.number() }),
        execute: async () => undefined,
      },
    ];

    const result = convertToolDefinitionsToVercelAITools(tools);

    expect(result).toHaveProperty("tool1");
    expect(result).toHaveProperty("tool2");
    expect(Object.keys(result)).toHaveLength(2);
  });
});

describe("tool call arguments in convertMessagesToVercelAISDKMessages", () => {
  function convertToolCallArgs(argsJson: string) {
    const [message] = convertMessagesToVercelAISDKMessages([
      {
        id: "1",
        role: "assistant",
        content: "calling tool",
        toolCalls: [
          {
            id: "call1",
            type: "function",
            function: { name: "myTool", arguments: argsJson },
          },
        ],
      },
    ]);
    return message;
  }

  function assistantCalling(input: Record<string, unknown>) {
    return {
      role: "assistant",
      content: [
        { type: "text", text: "calling tool" },
        { type: "tool-call", toolCallId: "call1", toolName: "myTool", input },
      ],
    };
  }

  it("passes valid object arguments through", () => {
    expect(convertToolCallArgs('{"key":"value"}')).toEqual(
      assistantCalling({ key: "value" }),
    );
  });

  it.each([
    ["a string", '""'],
    ["an array", "[1,2,3]"],
    ["null", "null"],
    ["a number", "42"],
    ["a boolean", "true"],
    ["unparseable JSON", "{broken"],
  ])("replaces %s with an empty object", (_label, argsJson) => {
    expect(convertToolCallArgs(argsJson)).toEqual(assistantCalling({}));
  });
});
