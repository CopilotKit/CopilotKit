import {
  AIMessage,
  AIMessageChunk,
  ToolMessage,
} from "@langchain/core/messages";
import { describe, expect, test } from "vitest";
import { getNextNode } from "../../agents/typescript/src/route";

const messageFactories = [
  [
    "AIMessage",
    (toolName: string) =>
      new AIMessage({
        content: "",
        tool_calls: [
          { name: toolName, args: {}, id: "call-1", type: "tool_call" },
        ],
      }),
  ],
  [
    "AIMessageChunk",
    (toolName: string) =>
      new AIMessageChunk({
        content: "",
        tool_calls: [
          { name: toolName, args: {}, id: "call-1", type: "tool_call" },
        ],
      }),
  ],
] as const;

describe.each(messageFactories)("route with %s", (_name, createMessage) => {
  test.each([
    ["Search", "search_node"],
    ["DeleteResources", "delete_node"],
  ] as const)("routes %s tool calls", (toolName, expectedRoute) => {
    expect(getNextNode({ messages: [createMessage(toolName)] })).toBe(
      expectedRoute,
    );
  });
});

test("routes tool results back to chat", () => {
  const message = new ToolMessage({ content: "done", tool_call_id: "call-1" });

  expect(getNextNode({ messages: [message] })).toBe("chat_node");
});

test.each([
  ["an empty message list", []],
  ["an AI response without a supported tool call", [new AIMessage("done")]],
] as const)("ends after %s", (_name, messages) => {
  expect(getNextNode({ messages })).toBeUndefined();
});
