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
          { role: "system", content: "You are helpful" },
          { role: "user", content: "Hello" },
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
          { role: "developer", content: "Internal instruction" },
          { role: "user", content: "Hi" },
        ],
      });

      const { messages } = convertInputToTanStackAI(input);

      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("user");
    });

    it("extracts system and developer messages into systemPrompts", () => {
      const input = createDefaultInput({
        messages: [
          { role: "system", content: "System prompt" },
          { role: "developer", content: "Dev instruction" },
          { role: "user", content: "Hello" },
        ],
      });

      const { systemPrompts } = convertInputToTanStackAI(input);

      expect(systemPrompts).toContain("System prompt");
      expect(systemPrompts).toContain("Dev instruction");
    });

    it("preserves user and assistant messages in order", () => {
      const input = createDefaultInput({
        messages: [
          { role: "user", content: "Question 1" },
          { role: "assistant", content: "Answer 1" },
          { role: "user", content: "Question 2" },
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
