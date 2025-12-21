/**
 * @jest-environment node
 */

import { describe, it, expect } from "@jest/globals";

describe("Anthropic Adapter - Allowlist Approach", () => {
  it("should filter out tool_result messages with no corresponding tool_use ID", () => {
    // Setup test data
    const validToolUseIds = new Set<string>(["valid-id-1", "valid-id-2"]);

    // Messages to filter - valid and invalid ones
    const messages = [
      { type: "text", role: "user", content: "Hello" },
      { type: "tool_result", actionExecutionId: "valid-id-1", result: "result1" },
      { type: "tool_result", actionExecutionId: "invalid-id", result: "invalid" },
      { type: "tool_result", actionExecutionId: "valid-id-2", result: "result2" },
      { type: "tool_result", actionExecutionId: "valid-id-1", result: "duplicate" }, // Duplicate ID
    ];

    // Apply the allowlist filter approach
    const filteredMessages = [];
    const processedIds = new Set<string>();

    for (const message of messages) {
      if (message.type === "tool_result") {
        // Skip if no corresponding valid tool_use ID
        if (!validToolUseIds.has(message.actionExecutionId)) {
          continue;
        }

        // Skip if we've already processed this ID
        if (processedIds.has(message.actionExecutionId)) {
          continue;
        }

        // Mark this ID as processed
        processedIds.add(message.actionExecutionId);
      }

      // Include all non-tool-result messages and valid tool results
      filteredMessages.push(message);
    }

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

    // Duplicate should be excluded
    const validId1Count = filteredMessages.filter(
      (m) => m.type === "tool_result" && m.actionExecutionId === "valid-id-1",
    ).length;

    expect(validId1Count).toBe(1);
  });

  it("should maintain correct order of messages when filtering", () => {
    // Setup test data with specific ordering
    const validToolUseIds = new Set<string>(["tool-1", "tool-2", "tool-3"]);

    // Messages in a specific order, with some invalid/duplicate results
    const messages = [
      { type: "text", role: "user", content: "Initial message" },
      { type: "text", role: "assistant", content: "I'll help with that" },
      { type: "tool_use", id: "tool-1", name: "firstTool" },
      { type: "tool_result", actionExecutionId: "tool-1", result: "result1" },
      { type: "text", role: "assistant", content: "Got the first result" },
      { type: "tool_use", id: "tool-2", name: "secondTool" },
      { type: "tool_result", actionExecutionId: "tool-2", result: "result2" },
      { type: "tool_result", actionExecutionId: "invalid-id", result: "invalid-result" },
      { type: "tool_use", id: "tool-3", name: "thirdTool" },
      { type: "tool_result", actionExecutionId: "tool-1", result: "duplicate-result" }, // Duplicate
      { type: "tool_result", actionExecutionId: "tool-3", result: "result3" },
      { type: "text", role: "user", content: "Final message" },
    ];

    // Apply the allowlist filter approach
    const filteredMessages = [];
    const processedIds = new Set<string>();

    for (const message of messages) {
      if (message.type === "tool_result") {
        // Skip if no corresponding valid tool_use ID
        if (!validToolUseIds.has(message.actionExecutionId)) {
          continue;
        }

        // Skip if we've already processed this ID
        if (processedIds.has(message.actionExecutionId)) {
          continue;
        }

        // Mark this ID as processed
        processedIds.add(message.actionExecutionId);
      }

      // Include all non-tool-result messages and valid tool results
      filteredMessages.push(message);
    }

    // Verify results
    expect(filteredMessages.length).toBe(10); // 12 original - 2 filtered out

    // Check that the order is preserved
    expect(filteredMessages[0].type).toBe("text"); // Initial user message
    expect(filteredMessages[1].type).toBe("text"); // Assistant response
    expect(filteredMessages[2].type).toBe("tool_use"); // First tool
    expect(filteredMessages[3].type).toBe("tool_result"); // First result
    expect(filteredMessages[3].actionExecutionId).toBe("tool-1"); // First result
    expect(filteredMessages[4].type).toBe("text"); // Assistant comment
    expect(filteredMessages[5].type).toBe("tool_use"); // Second tool
    expect(filteredMessages[6].type).toBe("tool_result"); // Second result
    expect(filteredMessages[6].actionExecutionId).toBe("tool-2"); // Second result
    expect(filteredMessages[7].type).toBe("tool_use"); // Third tool
    expect(filteredMessages[8].type).toBe("tool_result"); // Third result
    expect(filteredMessages[8].actionExecutionId).toBe("tool-3"); // Third result
    expect(filteredMessages[9].type).toBe("text"); // Final user message

    // Each valid tool ID should appear exactly once in the results
    const toolResultCounts = {
      "tool-1": 0,
      "tool-2": 0,
      "tool-3": 0,
    };

    filteredMessages.forEach((message) => {
      if (message.type === "tool_result" && message.actionExecutionId in toolResultCounts) {
        toolResultCounts[message.actionExecutionId]++;
      }
    });

    expect(toolResultCounts["tool-1"]).toBe(1);
    expect(toolResultCounts["tool-2"]).toBe(1);
    expect(toolResultCounts["tool-3"]).toBe(1);
  });

  it("should handle an empty message array", () => {
    const validToolUseIds = new Set<string>(["valid-id-1", "valid-id-2"]);
    const messages = [];

    // Apply the filtering logic
    const filteredMessages = [];
    const processedIds = new Set<string>();

    for (const message of messages) {
      if (message.type === "tool_result") {
        if (
          !validToolUseIds.has(message.actionExecutionId) ||
          processedIds.has(message.actionExecutionId)
        ) {
          continue;
        }
        processedIds.add(message.actionExecutionId);
      }
      filteredMessages.push(message);
    }

    expect(filteredMessages.length).toBe(0);
  });

  it("should handle edge cases with mixed message types", () => {
    // Setup with mixed message types
    const validToolUseIds = new Set<string>(["valid-id-1"]);

    const messages = [
      { type: "text", role: "user", content: "Hello" },
      { type: "image", url: "https://example.com/image.jpg" }, // Non-tool message type
      { type: "tool_result", actionExecutionId: "valid-id-1", result: "result1" },
      { type: "custom", data: { key: "value" } }, // Another custom type
      { type: "tool_result", actionExecutionId: "valid-id-1", result: "duplicate" }, // Duplicate
      { type: "null", value: null }, // Edge case
      { type: "undefined" }, // Edge case
    ];

    // Apply the filtering logic
    const filteredMessages = [];
    const processedIds = new Set<string>();

    for (const message of messages) {
      if (message.type === "tool_result") {
        if (
          !validToolUseIds.has(message.actionExecutionId) ||
          processedIds.has(message.actionExecutionId)
        ) {
          continue;
        }
        processedIds.add(message.actionExecutionId);
      }
      filteredMessages.push(message);
    }

    // Should have all non-tool_result messages + 1 valid tool_result
    expect(filteredMessages.length).toBe(6); // 7 original - 1 duplicate

    // Valid tool_result should be included exactly once
    const toolResults = filteredMessages.filter((m) => m.type === "tool_result");
    expect(toolResults.length).toBe(1);
    expect(toolResults[0].actionExecutionId).toBe("valid-id-1");

    // All other message types should be preserved
    expect(filteredMessages.filter((m) => m.type === "text").length).toBe(1);
    expect(filteredMessages.filter((m) => m.type === "image").length).toBe(1);
    expect(filteredMessages.filter((m) => m.type === "custom").length).toBe(1);
    expect(filteredMessages.filter((m) => m.type === "null").length).toBe(1);
    expect(filteredMessages.filter((m) => m.type === "undefined").length).toBe(1);
  });
});
