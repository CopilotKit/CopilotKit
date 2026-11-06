import { describe, it, expect } from "vitest";
import type { Message } from "@ag-ui/client";
import { convertInputToTanStackAI } from "../converters/tanstack";
import { createDefaultInput } from "./agent-test-helpers";

/** A thread where the assistant called the `approve` interrupt tool. */
const interruptedThread: Message[] = [
  { id: "u1", role: "user", content: "Send the money" },
  {
    id: "a1",
    role: "assistant",
    content: null,
    toolCalls: [
      {
        id: "call-1",
        type: "function",
        function: { name: "approve", arguments: "{}" },
      },
    ],
  },
];

describe("convertInputToTanStackAI", () => {
  // -------------------------------------------------------------------------
  // Message filtering
  // -------------------------------------------------------------------------
  describe("message filtering", () => {
    it("filters out system messages from the messages array", () => {
      const input = createDefaultInput({
        messages: [
          { id: "msg-1", role: "system", content: "You are helpful" },
          { id: "msg-2", role: "user", content: "Hello" },
        ],
      });

      const { messages } = convertInputToTanStackAI(input);

      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("user");
      expect(messages[0].content).toBe("Hello");
    });

    it("filters out developer messages from the messages array", () => {
      const input = createDefaultInput({
        messages: [
          { id: "msg-3", role: "developer", content: "Internal instruction" },
          { id: "msg-4", role: "user", content: "Hi" },
        ],
      });

      const { messages } = convertInputToTanStackAI(input);

      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("user");
    });

    it("extracts system and developer messages into systemPrompts", () => {
      const input = createDefaultInput({
        messages: [
          { id: "msg-5", role: "system", content: "System prompt" },
          { id: "msg-6", role: "developer", content: "Dev instruction" },
          { id: "msg-7", role: "user", content: "Hello" },
        ],
      });

      const { systemPrompts } = convertInputToTanStackAI(input);

      expect(systemPrompts).toContain("System prompt");
      expect(systemPrompts).toContain("Dev instruction");
    });

    it("preserves user and assistant messages in order", () => {
      const input = createDefaultInput({
        messages: [
          { id: "msg-8", role: "user", content: "Question 1" },
          { id: "msg-9", role: "assistant", content: "Answer 1" },
          { id: "msg-10", role: "user", content: "Question 2" },
        ],
      });

      const { messages } = convertInputToTanStackAI(input);

      expect(messages).toHaveLength(3);
      expect(messages[0]).toMatchObject({
        role: "user",
        content: "Question 1",
      });
      expect(messages[1]).toMatchObject({
        role: "assistant",
        content: "Answer 1",
      });
      expect(messages[2]).toMatchObject({
        role: "user",
        content: "Question 2",
      });
    });
  });

  // -------------------------------------------------------------------------
  // Tool result content
  // -------------------------------------------------------------------------
  describe("tool result content", () => {
    it("keeps a string tool result as its string", () => {
      const input = createDefaultInput({
        messages: [
          { id: "t1", role: "tool", toolCallId: "tc-1", content: "answer" },
        ],
      });
      const { messages } = convertInputToTanStackAI(input);
      expect(messages[0].content).toBe("answer");
      expect(messages[0].toolCallId).toBe("tc-1");
    });

    it("renders a parts-shaped tool result as its text rather than dropping it", () => {
      const input = createDefaultInput({
        messages: [
          {
            id: "t1",
            role: "tool",
            toolCallId: "tc-1",
            content: [
              { type: "text", text: "ans" },
              {
                type: "image",
                source: { type: "url", value: "https://example.com/x.png" },
              },
              { type: "text", text: "wer" },
            ],
          },
        ],
      });
      const { messages } = convertInputToTanStackAI(input);
      expect(messages[0].content).toBe("answer");
    });
  });

  // -------------------------------------------------------------------------
  // Tool call mapping
  // -------------------------------------------------------------------------
  describe("tool call mapping", () => {
    it("maps assistant message toolCalls to TanStack format", () => {
      const input = createDefaultInput({
        messages: [
          {
            id: "msg-14",
            role: "assistant",
            content: null,
            toolCalls: [
              {
                id: "tc-1",
                type: "function",
                function: { name: "getWeather", arguments: '{"city":"NYC"}' },
              },
            ],
          },
        ],
      });

      const { messages } = convertInputToTanStackAI(input);

      expect(messages).toHaveLength(1);
      expect(messages[0].toolCalls).toHaveLength(1);
      expect(messages[0].toolCalls![0]).toEqual({
        id: "tc-1",
        type: "function",
        function: { name: "getWeather", arguments: '{"city":"NYC"}' },
      });
    });

    it("maps tool messages with toolCallId", () => {
      const input = createDefaultInput({
        messages: [
          {
            id: "msg-15",
            role: "tool",
            content: '{"temp": 72}',
            toolCallId: "tc-1",
          },
        ],
      });

      const { messages } = convertInputToTanStackAI(input);

      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("tool");
      expect(messages[0].toolCallId).toBe("tc-1");
    });
  });

  // -------------------------------------------------------------------------
  // Client tools (frontend-provided tools → TanStack client tools)
  // -------------------------------------------------------------------------
  describe("client tools", () => {
    it("converts input.tools to TanStack client tools (no executor)", () => {
      const params = {
        type: "object" as const,
        properties: { issues: { type: "array" as const } },
        required: ["issues"],
      };
      const input = createDefaultInput({
        tools: [
          {
            name: "issue_list",
            description: "Render a list of issues",
            parameters: params,
          },
        ],
      });

      const { tools } = convertInputToTanStackAI(input);

      expect(tools).toHaveLength(1);
      expect(tools[0]).toEqual({
        __toolSide: "client",
        name: "issue_list",
        description: "Render a list of issues",
        inputSchema: params,
      });
      // Client tools must NOT carry an executor — TanStack pauses and hands
      // the call back to the AG-UI client instead of running it.
      expect("execute" in tools[0]).toBe(false);
    });

    it("returns an empty tools array when input has no tools", () => {
      const { tools } = convertInputToTanStackAI(createDefaultInput());
      expect(tools).toEqual([]);
    });

    it("closes open objects (additionalProperties → false) for OpenAI compatibility", () => {
      const input = createDefaultInput({
        tools: [
          {
            name: "render_chart",
            description: "Render a chart",
            parameters: {
              type: "object",
              properties: {
                // z.record(z.string(), z.any()) → additionalProperties: {}
                options: { type: "object", additionalProperties: {} },
                data: {
                  type: "array",
                  // .loose() → additionalProperties: true on items
                  items: {
                    type: "object",
                    properties: { v: { type: "number" } },
                    additionalProperties: true,
                  },
                },
              },
              additionalProperties: false,
            },
          },
        ],
      });

      const { tools } = convertInputToTanStackAI(input);
      const schema = tools[0].inputSchema;

      expect(schema.properties.options.additionalProperties).toBe(false);
      expect(schema.properties.data.items.additionalProperties).toBe(false);
      // Nested defined properties are preserved.
      expect(schema.properties.data.items.properties.v).toEqual({
        type: "number",
      });
    });
  });

  // -------------------------------------------------------------------------
  // Context injection
  // -------------------------------------------------------------------------
  describe("context injection", () => {
    it("appends context entries to systemPrompts", () => {
      const input = createDefaultInput({
        context: [
          { description: "User preferences", value: "Dark mode enabled" },
          { description: "Current page", value: "/dashboard" },
        ],
      });

      const { systemPrompts } = convertInputToTanStackAI(input);

      expect(systemPrompts).toContain("User preferences:\nDark mode enabled");
      expect(systemPrompts).toContain("Current page:\n/dashboard");
    });

    it("does not add context when context array is empty", () => {
      const input = createDefaultInput({ context: [] });

      const { systemPrompts } = convertInputToTanStackAI(input);

      expect(systemPrompts).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // State serialization
  // -------------------------------------------------------------------------
  describe("state serialization", () => {
    it("serializes non-empty state into systemPrompts", () => {
      const input = createDefaultInput({
        state: { count: 42, items: ["a", "b"] },
      });

      const { systemPrompts } = convertInputToTanStackAI(input);

      const statePrompt = systemPrompts.find((p) =>
        p.startsWith("Application State:"),
      );
      expect(statePrompt).toBeDefined();
      expect(statePrompt).toContain('"count": 42');
    });

    it("does not add state when state is empty object", () => {
      const input = createDefaultInput({ state: {} });

      const { systemPrompts } = convertInputToTanStackAI(input);

      expect(
        systemPrompts.find((p) => p.startsWith("Application State:")),
      ).toBeUndefined();
    });

    it("does not add state when state is null", () => {
      const input = createDefaultInput({ state: null });

      const { systemPrompts } = convertInputToTanStackAI(input);

      expect(
        systemPrompts.find((p) => p.startsWith("Application State:")),
      ).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Options: system prompt assembly
  // -------------------------------------------------------------------------
  describe("system prompt options", () => {
    const systemAndDeveloper = createDefaultInput({
      messages: [
        { id: "s1", role: "system", content: "System prompt" },
        { id: "d1", role: "developer", content: "Dev instruction" },
        { id: "u1", role: "user", content: "Hello" },
      ],
    });

    it("drops system messages when forwardSystemMessages is false", () => {
      const { systemPrompts, messages } = convertInputToTanStackAI(
        systemAndDeveloper,
        { forwardSystemMessages: false },
      );

      expect(systemPrompts).toEqual(["Dev instruction"]);
      expect(messages).toEqual([{ role: "user", content: "Hello" }]);
    });

    it("drops developer messages when forwardDeveloperMessages is false", () => {
      const { systemPrompts } = convertInputToTanStackAI(systemAndDeveloper, {
        forwardDeveloperMessages: false,
      });

      expect(systemPrompts).toEqual(["System prompt"]);
    });

    it("puts prompt first, then forwarded messages, context, and state", () => {
      const input = createDefaultInput({
        messages: [{ id: "s1", role: "system", content: "System prompt" }],
        context: [{ description: "Current page", value: "/dashboard" }],
        state: { count: 1 },
      });

      const { systemPrompts } = convertInputToTanStackAI(input, {
        prompt: "Be brief.",
      });

      expect(systemPrompts).toEqual([
        "Be brief.",
        "System prompt",
        "Current page:\n/dashboard",
        'Application State:\n```json\n{\n  "count": 1\n}\n```',
      ]);
    });

    it("adds nothing for an empty prompt", () => {
      const { systemPrompts } = convertInputToTanStackAI(createDefaultInput(), {
        prompt: "",
      });

      expect(systemPrompts).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Options: resume injection
  // -------------------------------------------------------------------------
  describe("resume option", () => {
    it("answers each interrupt tool call with its resume entry", () => {
      const input = createDefaultInput({ messages: interruptedThread });

      const { messages } = convertInputToTanStackAI(input, {
        resume: [
          {
            interruptId: "call-1",
            status: "resolved",
            payload: { approved: true },
          },
          { interruptId: "call-2", status: "cancelled" },
          { interruptId: "call-3", status: "resolved" },
        ],
      });

      expect(messages.slice(2)).toEqual([
        { role: "tool", toolCallId: "call-1", content: '{"approved":true}' },
        {
          role: "tool",
          toolCallId: "call-2",
          content: '{"status":"cancelled"}',
        },
        {
          role: "tool",
          toolCallId: "call-3",
          content: '{"status":"resolved"}',
        },
      ]);
    });

    it("skips a resume entry whose tool call already has a tool message", () => {
      const input = createDefaultInput({
        messages: [
          ...interruptedThread,
          {
            id: "t1",
            role: "tool",
            toolCallId: "call-1",
            content: '{"approved":false}',
          },
        ],
      });

      const { messages } = convertInputToTanStackAI(input, {
        resume: [
          {
            interruptId: "call-1",
            status: "resolved",
            payload: { approved: true },
          },
        ],
      });

      expect(messages.slice(2)).toEqual([
        { role: "tool", toolCallId: "call-1", content: '{"approved":false}' },
      ]);
    });

    it("ignores input.resume when the resume option is not given", () => {
      const input = createDefaultInput({
        messages: interruptedThread,
        resume: [{ interruptId: "call-1", status: "cancelled" }],
      });

      const { messages } = convertInputToTanStackAI(input);

      expect(messages).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // Empty input
  // -------------------------------------------------------------------------
  describe("empty input", () => {
    it("returns empty messages and systemPrompts for default input", () => {
      const input = createDefaultInput();

      const { messages, systemPrompts } = convertInputToTanStackAI(input);

      expect(messages).toHaveLength(0);
      expect(systemPrompts).toHaveLength(0);
    });
  });
});
