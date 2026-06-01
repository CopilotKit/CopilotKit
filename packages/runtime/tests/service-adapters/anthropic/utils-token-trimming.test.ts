import { describe, it, expect } from "vitest";
import { limitMessagesToTokenCount } from "../../../src/service-adapters/anthropic/utils";

// Helper to build messages for testing. The token counter is length/3,
// so we can control token counts via string length.

function textUser(text: string) {
  return { role: "user", content: [{ type: "text", text }] };
}

function textAssistant(text: string) {
  return { role: "assistant", content: [{ type: "text", text }] };
}

function toolUseAssistant(id: string, name = "my_tool", input = {}) {
  return {
    role: "assistant",
    content: [{ type: "tool_use", id, name, input }],
  };
}

function toolResultUser(toolUseId: string, content = "result") {
  return {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: toolUseId, content }],
  };
}

function mixedAssistant(blocks: any[]) {
  return { role: "assistant", content: blocks };
}

function mixedUser(blocks: any[]) {
  return { role: "user", content: blocks };
}

describe("limitMessagesToTokenCount - orphan handling", () => {
  // Use a high token limit so trimming doesn't kick in for these tests
  const HIGH_LIMIT = 999999;

  it("preserves matched tool_use / tool_result pairs", () => {
    const messages = [
      textUser("hello"),
      toolUseAssistant("t1", "tool_a"),
      toolResultUser("t1", "done"),
      textAssistant("ok"),
    ];

    const result = limitMessagesToTokenCount(
      messages,
      [],
      "claude-3",
      HIGH_LIMIT,
    );

    // All four messages should survive
    expect(result).toHaveLength(4);
    // The tool_use and tool_result should still be present
    const toolUse = result.find(
      (m: any) =>
        m.role === "assistant" &&
        Array.isArray(m.content) &&
        m.content.some((b: any) => b.type === "tool_use"),
    );
    const toolResult = result.find(
      (m: any) =>
        m.role === "user" &&
        Array.isArray(m.content) &&
        m.content.some((b: any) => b.type === "tool_result"),
    );
    expect(toolUse).toBeDefined();
    expect(toolResult).toBeDefined();
  });

  it("removes orphaned tool_result when tool_use was trimmed", () => {
    // Simulate: tool_use message was removed by token trimming, leaving
    // a tool_result without a matching tool_use.
    const messages = [
      textUser("hello"),
      // no toolUseAssistant for "t1"
      toolResultUser("t1", "orphaned result"),
      textAssistant("ok"),
    ];

    const result = limitMessagesToTokenCount(
      messages,
      [],
      "claude-3",
      HIGH_LIMIT,
    );

    // The orphaned tool_result message should be gone
    const hasToolResult = result.some(
      (m: any) =>
        m.role === "user" &&
        Array.isArray(m.content) &&
        m.content.some((b: any) => b.type === "tool_result"),
    );
    expect(hasToolResult).toBe(false);
    expect(result).toHaveLength(2); // textUser + textAssistant
  });

  it("removes orphaned tool_use when tool_result was trimmed", () => {
    // Simulate: tool_result message was removed by token trimming, leaving
    // a tool_use without a matching tool_result.
    const messages = [
      textUser("hello"),
      toolUseAssistant("t1", "tool_a"),
      // no toolResultUser for "t1"
      textAssistant("ok"),
    ];

    const result = limitMessagesToTokenCount(
      messages,
      [],
      "claude-3",
      HIGH_LIMIT,
    );

    // The orphaned tool_use message should be gone
    const hasToolUse = result.some(
      (m: any) =>
        m.role === "assistant" &&
        Array.isArray(m.content) &&
        m.content.some((b: any) => b.type === "tool_use"),
    );
    expect(hasToolUse).toBe(false);
    expect(result).toHaveLength(2); // textUser + textAssistant
  });

  it("retains non-orphaned blocks in mixed-content messages", () => {
    // Assistant message has both a text block and an orphaned tool_use
    const messages = [
      textUser("hello"),
      mixedAssistant([
        { type: "text", text: "thinking..." },
        { type: "tool_use", id: "t1", name: "tool_a", input: {} },
      ]),
      // no tool_result for t1
      textAssistant("done"),
    ];

    const result = limitMessagesToTokenCount(
      messages,
      [],
      "claude-3",
      HIGH_LIMIT,
    );

    // The assistant message should survive with only the text block
    const assistantMixed = result.find(
      (m: any) =>
        m.role === "assistant" &&
        Array.isArray(m.content) &&
        m.content.some(
          (b: any) => b.type === "text" && b.text === "thinking...",
        ),
    );
    expect(assistantMixed).toBeDefined();
    expect(assistantMixed.content).toHaveLength(1);
    expect(assistantMixed.content[0].type).toBe("text");
  });

  it("retains non-orphaned blocks in mixed user messages", () => {
    // User message has both a text block and an orphaned tool_result
    const messages = [
      textUser("hello"),
      mixedUser([
        { type: "text", text: "here is context" },
        { type: "tool_result", tool_use_id: "t_missing", content: "orphan" },
      ]),
      textAssistant("ok"),
    ];

    const result = limitMessagesToTokenCount(
      messages,
      [],
      "claude-3",
      HIGH_LIMIT,
    );

    const userMixed = result.find(
      (m: any) =>
        m.role === "user" &&
        Array.isArray(m.content) &&
        m.content.some(
          (b: any) => b.type === "text" && b.text === "here is context",
        ),
    );
    expect(userMixed).toBeDefined();
    expect(userMixed.content).toHaveLength(1);
    expect(userMixed.content[0].type).toBe("text");
  });

  it("drops message entirely when all blocks are orphaned", () => {
    const messages = [
      textUser("hello"),
      mixedUser([
        { type: "tool_result", tool_use_id: "t_a", content: "orphan a" },
        { type: "tool_result", tool_use_id: "t_b", content: "orphan b" },
      ]),
      textAssistant("ok"),
    ];

    const result = limitMessagesToTokenCount(
      messages,
      [],
      "claude-3",
      HIGH_LIMIT,
    );

    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("user");
    expect(result[1].role).toBe("assistant");
  });

  it("drops assistant message entirely when all tool_use blocks are orphaned", () => {
    const messages = [
      textUser("hello"),
      mixedAssistant([
        { type: "tool_use", id: "t_x", name: "tool_x", input: {} },
        { type: "tool_use", id: "t_y", name: "tool_y", input: {} },
      ]),
      // no tool_results for either
      textAssistant("done"),
    ];

    const result = limitMessagesToTokenCount(
      messages,
      [],
      "claude-3",
      HIGH_LIMIT,
    );

    expect(result).toHaveLength(2);
  });

  it("does not mutate the original messages array or message objects", () => {
    const originalContent = [
      { type: "text", text: "context" },
      { type: "tool_result", tool_use_id: "t_orphan", content: "orphan" },
    ];
    const userMsg = { role: "user", content: [...originalContent] };
    const messages = [textUser("hello"), userMsg, textAssistant("ok")];

    const result = limitMessagesToTokenCount(
      messages,
      [],
      "claude-3",
      HIGH_LIMIT,
    );

    // Original message should still have both blocks
    expect(userMsg.content).toHaveLength(2);
    expect(userMsg.content[1].type).toBe("tool_result");

    // Original messages array should still have 3 entries
    expect(messages).toHaveLength(3);

    // Result should have the filtered version
    const filtered = result.find(
      (m: any) =>
        m.role === "user" &&
        Array.isArray(m.content) &&
        m.content.some((b: any) => b.text === "context"),
    );
    expect(filtered).toBeDefined();
    expect(filtered.content).toHaveLength(1);
  });

  it("handles token trimming that creates orphans via cutoff", () => {
    // Build messages where token trimming will cut off early messages,
    // leaving orphaned tool_result for a tool_use that got trimmed.
    // Each char ~0.33 tokens, so 300 chars ~ 100 tokens
    const longText = "x".repeat(300);

    const messages = [
      toolUseAssistant("t_old"),
      toolResultUser("t_old", "old result"),
      textUser(longText),
      textAssistant(longText),
      toolUseAssistant("t_new"),
      toolResultUser("t_new", "new result"),
    ];

    // Set a limit that keeps only the last few messages, trimming t_old's tool_use
    const result = limitMessagesToTokenCount(messages, [], "claude-3", 300);

    // t_old's tool_use should have been trimmed by the token limit,
    // and then t_old's tool_result should be cleaned up as orphaned
    const hasOldResult = result.some(
      (m: any) =>
        m.role === "user" &&
        Array.isArray(m.content) &&
        m.content.some(
          (b: any) => b.type === "tool_result" && b.tool_use_id === "t_old",
        ),
    );
    expect(hasOldResult).toBe(false);
  });
});
