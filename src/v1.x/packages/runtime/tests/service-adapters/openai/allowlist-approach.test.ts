/**
 * @jest-environment node
 */

import { describe, it, expect } from "@jest/globals";

describe("OpenAI Adapter - Allowlist Approach", () => {
  it("should filter out tool_result messages with no corresponding tool_call ID", () => {
    // Setup test data
    const validToolCallIds = new Set<string>(["valid-id-1", "valid-id-2"]);

    // Messages to filter - valid and invalid ones
    const messages = [
      { type: "text", role: "user", content: "Hello" },
      { type: "tool_result", actionExecutionId: "valid-id-1", result: "result1" },
      { type: "tool_result", actionExecutionId: "invalid-id", result: "invalid" },
      { type: "tool_result", actionExecutionId: "valid-id-2", result: "result2" },
      { type: "tool_result", actionExecutionId: "valid-id-1", result: "duplicate" }, // Duplicate ID
    ];

    // Implement the filtering logic, similar to the adapter
    const filteredMessages = messages.filter((message) => {
      if (message.type === "tool_result") {
        // Skip if there's no corresponding tool_call
        if (!validToolCallIds.has(message.actionExecutionId)) {
          return false;
        }

        // Remove this ID from valid IDs so we don't process duplicates
        validToolCallIds.delete(message.actionExecutionId);
      }

      // Keep all non-tool-result messages
      return true;
    });

    // Verify results
    expect(filteredMessages.length).toBe(3); // text + 2 valid tool results (no duplicates or invalid)

    // Valid results should be included
    expect(
      filteredMessages.some(
        (m) => m.type === "tool_result" && m.actionExecutionId === "valid-id-1",
      ),
    ).toBe(true);

    expect(
      filteredMessages.some(
        (m) => m.type === "tool_result" && m.actionExecutionId === "valid-id-2",
      ),
    ).toBe(true);

    // Invalid result should be excluded
    expect(
      filteredMessages.some(
        (m) => m.type === "tool_result" && m.actionExecutionId === "invalid-id",
      ),
    ).toBe(false);

    // Duplicate should be excluded - we used a different approach than Anthropic
    const validId1Count = filteredMessages.filter(
      (m) => m.type === "tool_result" && m.actionExecutionId === "valid-id-1",
    ).length;

    expect(validId1Count).toBe(1);
  });

  it("should maintain correct order of messages when filtering", () => {
    // Setup test data
    const validToolCallIds = new Set<string>(["tool-1", "tool-2", "tool-3"]);

    // Test with a complex conversation pattern
    const messages = [
      { type: "text", role: "user", content: "Initial message" },
      { type: "text", role: "assistant", content: "I'll help with that" },
      { type: "tool_call", id: "tool-1", name: "firstTool" },
      { type: "tool_result", actionExecutionId: "tool-1", result: "result1" },
      { type: "text", role: "assistant", content: "Got the first result" },
      { type: "tool_call", id: "tool-2", name: "secondTool" },
      { type: "tool_result", actionExecutionId: "tool-2", result: "result2" },
      { type: "tool_result", actionExecutionId: "invalid-id", result: "invalid-result" },
      { type: "tool_call", id: "tool-3", name: "thirdTool" },
      { type: "tool_result", actionExecutionId: "tool-1", result: "duplicate-result" }, // Duplicate
      { type: "tool_result", actionExecutionId: "tool-3", result: "result3" },
      { type: "text", role: "user", content: "Final message" },
    ];

    // Apply OpenAI's filter approach (using filter instead of loop)
    const filteredMessages = messages.filter((message) => {
      if (message.type === "tool_result") {
        // Skip if there's no corresponding tool_call
        if (!validToolCallIds.has(message.actionExecutionId)) {
          return false;
        }

        // Remove this ID from valid IDs so we don't process duplicates
        validToolCallIds.delete(message.actionExecutionId);
      }

      // Keep all non-tool-result messages
      return true;
    });

    // Verify results
    expect(filteredMessages.length).toBe(10); // 12 original - 2 filtered out

    // Check that the message order is preserved
    expect(filteredMessages[0].type).toBe("text"); // Initial user message
    expect(filteredMessages[0].content).toBe("Initial message");
    expect(filteredMessages[1].type).toBe("text"); // Assistant response
    expect(filteredMessages[2].type).toBe("tool_call"); // First tool
    expect(filteredMessages[3].type).toBe("tool_result"); // First result
    expect(filteredMessages[3].actionExecutionId).toBe("tool-1");
    expect(filteredMessages[4].type).toBe("text"); // Assistant comment
    expect(filteredMessages[5].type).toBe("tool_call"); // Second tool
    expect(filteredMessages[6].type).toBe("tool_result"); // Second result
    expect(filteredMessages[6].actionExecutionId).toBe("tool-2");
    expect(filteredMessages[7].type).toBe("tool_call"); // Third tool
    expect(filteredMessages[8].type).toBe("tool_result"); // Third result
    expect(filteredMessages[8].actionExecutionId).toBe("tool-3");
    expect(filteredMessages[9].type).toBe("text"); // Final user message

    // Each valid tool result should appear exactly once
    const toolResultCounts = new Map();
    filteredMessages.forEach((message) => {
      if (message.type === "tool_result") {
        const id = message.actionExecutionId;
        toolResultCounts.set(id, (toolResultCounts.get(id) || 0) + 1);
      }
    });

    expect(toolResultCounts.size).toBe(3); // Should have 3 different tool results
    expect(toolResultCounts.get("tool-1")).toBe(1);
    expect(toolResultCounts.get("tool-2")).toBe(1);
    expect(toolResultCounts.get("tool-3")).toBe(1);
    expect(toolResultCounts.has("invalid-id")).toBe(false);
  });

  it("should handle empty message array", () => {
    const validToolCallIds = new Set<string>(["valid-id-1", "valid-id-2"]);
    const messages = [];

    // Apply OpenAI's filter approach
    const filteredMessages = messages.filter((message) => {
      if (message.type === "tool_result") {
        if (!validToolCallIds.has(message.actionExecutionId)) {
          return false;
        }
        validToolCallIds.delete(message.actionExecutionId);
      }
      return true;
    });

    expect(filteredMessages.length).toBe(0);
  });

  it("should handle edge cases with mixed message types", () => {
    // Setup test data with various message types
    const validToolCallIds = new Set<string>(["valid-id-1"]);

    const messages = [
      { type: "text", role: "user", content: "Hello" },
      { type: "image", url: "https://example.com/image.jpg" }, // Non-tool message type
      { type: "tool_result", actionExecutionId: "valid-id-1", result: "result1" },
      { type: "custom", data: { key: "value" } }, // Another custom type
      { type: "tool_result", actionExecutionId: "valid-id-1", result: "duplicate" }, // Duplicate
      { type: "null", value: null }, // Edge case
      { type: "undefined" }, // Edge case
    ];

    // Apply OpenAI's filter approach
    const filteredMessages = messages.filter((message) => {
      if (message.type === "tool_result") {
        if (!validToolCallIds.has(message.actionExecutionId)) {
          return false;
        }
        validToolCallIds.delete(message.actionExecutionId);
      }
      return true;
    });

    // Should have all non-tool_result messages + 1 valid tool_result
    expect(filteredMessages.length).toBe(6); // 7 original - 1 duplicate

    // Valid tool_result should be included exactly once
    const toolResults = filteredMessages.filter((m) => m.type === "tool_result");
    expect(toolResults.length).toBe(1);
    expect(toolResults[0].actionExecutionId).toBe("valid-id-1");

    // All non-tool_result messages should be preserved
    expect(filteredMessages.filter((m) => m.type === "text").length).toBe(1);
    expect(filteredMessages.filter((m) => m.type === "image").length).toBe(1);
    expect(filteredMessages.filter((m) => m.type === "custom").length).toBe(1);
    expect(filteredMessages.filter((m) => m.type === "null").length).toBe(1);
    expect(filteredMessages.filter((m) => m.type === "undefined").length).toBe(1);
  });

  it("should properly handle multiple duplicate tool results", () => {
    // Setup test data with multiple duplicates
    const validToolCallIds = new Set<string>(["tool-1", "tool-2"]);

    const messages = [
      { type: "text", role: "user", content: "Initial prompt" },
      { type: "tool_call", id: "tool-1", name: "firstTool" },
      { type: "tool_result", actionExecutionId: "tool-1", result: "first-result" },
      { type: "tool_result", actionExecutionId: "tool-1", result: "duplicate-1" }, // Duplicate 1
      { type: "tool_call", id: "tool-2", name: "secondTool" },
      { type: "tool_result", actionExecutionId: "tool-1", result: "duplicate-2" }, // Duplicate 2
      { type: "tool_result", actionExecutionId: "tool-2", result: "second-result" },
      { type: "tool_result", actionExecutionId: "tool-2", result: "duplicate-3" }, // Duplicate 3
      { type: "tool_result", actionExecutionId: "tool-1", result: "duplicate-4" }, // Duplicate 4
    ];

    // Apply OpenAI's filter approach
    const filteredMessages = messages.filter((message) => {
      if (message.type === "tool_result") {
        if (!validToolCallIds.has(message.actionExecutionId)) {
          return false;
        }
        validToolCallIds.delete(message.actionExecutionId);
      }
      return true;
    });

    // Should have text + tool calls + only the first occurrence of each tool result
    expect(filteredMessages.length).toBe(5);

    // Check that only the first occurrence of each tool result is kept
    const toolResults = filteredMessages.filter((m) => m.type === "tool_result");
    expect(toolResults.length).toBe(2);

    expect(toolResults[0].actionExecutionId).toBe("tool-1");
    expect(toolResults[0].result).toBe("first-result"); // First occurrence should be kept

    expect(toolResults[1].actionExecutionId).toBe("tool-2");
    expect(toolResults[1].result).toBe("second-result"); // First occurrence should be kept
  });
});
