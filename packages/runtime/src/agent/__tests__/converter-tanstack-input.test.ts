import { describe, it, expect } from "vitest";
import { convertInputToTanStackAI } from "../converters/tanstack";
import { createDefaultInput } from "./agent-test-helpers";

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
                  // .passthrough() → additionalProperties: true on items
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
      const schema = tools[0].inputSchema as Record<string, any>;

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
