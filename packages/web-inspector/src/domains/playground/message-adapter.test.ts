import { describe, expect, it } from "vitest";
import type { ThreadDebuggerMessage } from "../../shared/thread-debugger/types.js";
import {
  mapPlaygroundMessagesToAgent,
  mapThreadMessagesToPlayground,
} from "./message-adapter.js";

describe("mapThreadMessagesToPlayground", () => {
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

  it("converts imported messages back to AG-UI messages for clone seeding", () => {
    const playgroundMessages = mapThreadMessagesToPlayground([
      {
        id: "assistant-1",
        role: "assistant",
        content: "Checking",
        toolCalls: [{ id: "call-1", name: "search", args: { q: "docs" } }],
      },
    ]);

    expect(mapPlaygroundMessagesToAgent(playgroundMessages)).toEqual([
      {
        id: "assistant-1",
        role: "assistant",
        content: "Checking",
        toolCalls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "search", arguments: '{"q":"docs"}' },
          },
        ],
      },
    ]);
  });
});
