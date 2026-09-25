import { describe, expect, it } from "vitest";
import type { ThreadDebuggerMessage } from "../../shared/thread-debugger/types.js";
import {
  mapThreadMessagesToAgent,
  mapThreadMessagesToPlayground,
} from "./message-adapter.js";

describe("Playground message adapters", () => {
  it("preserves message ids, roles, text, and parsed tool arguments", () => {
    const messages: ThreadDebuggerMessage[] = [
      { id: "user-1", role: "user", content: "Hello" },
      {
        id: "assistant-1",
        role: "assistant",
        content: "Checking",
        toolCalls: [{ id: "call-1", name: "search", args: '{"q":"docs"}' }],
      },
    ];

    expect(mapThreadMessagesToPlayground(messages)).toEqual([
      { id: "user-1", role: "user", contentText: "Hello", toolCalls: [] },
      {
        id: "assistant-1",
        role: "assistant",
        contentText: "Checking",
        toolCalls: [
          { id: "call-1", toolName: "search", arguments: { q: "docs" } },
        ],
      },
    ]);
  });

  it("preserves persisted tool arguments when seeding an agent", () => {
    const messages: ThreadDebuggerMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        content: "Checking",
        toolCalls: [
          {
            id: "call-1",
            name: "search",
            args: { one: { two: { three: { four: { value: 1 } } } } },
          },
          { id: "call-2", name: "echo", args: '"literal"' },
        ],
      },
    ];

    expect(mapThreadMessagesToAgent(messages)).toEqual([
      {
        id: "assistant-1",
        role: "assistant",
        content: "Checking",
        toolCalls: [
          {
            id: "call-1",
            type: "function",
            function: {
              name: "search",
              arguments: '{"one":{"two":{"three":{"four":{"value":1}}}}}',
            },
          },
          {
            id: "call-2",
            type: "function",
            function: { name: "echo", arguments: '"literal"' },
          },
        ],
      },
    ]);
  });
});
