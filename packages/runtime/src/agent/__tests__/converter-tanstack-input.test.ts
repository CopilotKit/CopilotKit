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

    const instructionInput = () =>
      createDefaultInput({
        messages: [
          { id: "msg-5", role: "system", content: "System prompt" },
          { id: "msg-6", role: "developer", content: "Dev instruction" },
          { id: "msg-7", role: "user", content: "Hello" },
        ],
      });

    it("drops client system and developer messages by default", () => {
      const { systemPrompts, messages } =
        convertInputToTanStackAI(instructionInput());

      expect(systemPrompts).toEqual([]);
      expect(messages.map((m) => m.role)).toEqual(["user"]);
    });

    it("forwards client system messages when asked", () => {
      const { systemPrompts } = convertInputToTanStackAI(instructionInput(), {
        forwardSystemMessages: true,
      });

      expect(systemPrompts).toEqual(["System prompt"]);
    });

    it("forwards client developer messages when asked", () => {
      const { systemPrompts } = convertInputToTanStackAI(instructionInput(), {
        forwardDeveloperMessages: true,
      });

      expect(systemPrompts).toEqual(["Dev instruction"]);
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
  // Context and state sections (same text as buildAgentSystemPrompt)
  // -------------------------------------------------------------------------
  describe("context and state sections", () => {
    it("appends the context section after the system messages", () => {
      const input = createDefaultInput({
        messages: [
          { id: "msg-1", role: "system", content: "Be brief" },
          { id: "msg-2", role: "user", content: "Hi" },
        ],
        context: [
          { description: "User preferences", value: "Dark mode enabled" },
          { description: "Current page", value: "/dashboard" },
        ],
      });

      const { systemPrompts } = convertInputToTanStackAI(input, {
        forwardSystemMessages: true,
      });

      expect(systemPrompts).toEqual([
        "Be brief",
        "\n## Context from the application\n" +
          "User preferences:\nDark mode enabled\n" +
          "Current page:\n/dashboard\n",
      ]);
    });

    it("appends the state section, which names the state tools", () => {
      const input = createDefaultInput({ state: { count: 42 } });

      const { systemPrompts } = convertInputToTanStackAI(input);

      expect(systemPrompts).toEqual([
        "\n## Application State\n" +
          "This is state from the application that you can edit by calling AGUISendStateSnapshot or AGUISendStateDelta.\n" +
          '```json\n{\n  "count": 42\n}\n```\n',
      ]);
    });

    it("puts context before state", () => {
      const input = createDefaultInput({
        context: [{ description: "User", value: "Ada" }],
        state: { step: 1 },
      });

      const { systemPrompts } = convertInputToTanStackAI(input);

      expect(systemPrompts).toHaveLength(2);
      expect(systemPrompts[0]).toMatch(/^\n## Context from the application\n/);
      expect(systemPrompts[1]).toMatch(/^\n## Application State\n/);
    });

    it("adds no context section when the wire input omits context", () => {
      const input = createDefaultInput({ context: undefined });

      const { systemPrompts } = convertInputToTanStackAI(input);

      expect(systemPrompts).toEqual([]);
    });

    it("adds no section for empty context or empty state", () => {
      const input = createDefaultInput({ context: [], state: {} });

      const { systemPrompts } = convertInputToTanStackAI(input);

      expect(systemPrompts).toEqual([]);
    });

    it("adds no state section when state is null", () => {
      const input = createDefaultInput({ state: null });

      const { systemPrompts } = convertInputToTanStackAI(input);

      expect(systemPrompts).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Run identity (chat() in @tanstack/ai 1.x requires threadId)
  // -------------------------------------------------------------------------
  describe("run identity", () => {
    it("carries the thread id and run id for chat()", () => {
      const input = createDefaultInput({
        threadId: "thread-7",
        runId: "run-3",
      });

      const { threadId, runId } = convertInputToTanStackAI(input);

      expect({ threadId, runId }).toEqual({
        threadId: "thread-7",
        runId: "run-3",
      });
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
