import { describe, expect, it } from "vitest";
import { adaptThreadMessages } from "./message-adapter.js";

describe("adaptThreadMessages", () => {
  it("maps empty tool arguments and results as empty objects", () => {
    const items = adaptThreadMessages([
      {
        id: "assistant-1",
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "call-empty", name: "lookupUser", args: "" },
          { id: "call-whitespace", name: "lookupOrder", args: "   " },
        ],
      },
      {
        id: "tool-empty",
        role: "tool",
        toolCallId: "call-empty",
        content: "",
      },
      {
        id: "tool-whitespace",
        role: "tool",
        toolCallId: "call-whitespace",
        content: "   ",
      },
    ]);

    expect(items).toMatchObject([
      {
        type: "tool_call",
        toolCallId: "call-empty",
        arguments: {},
        result: {},
      },
      {
        type: "tool_call",
        toolCallId: "call-whitespace",
        arguments: {},
        result: {},
      },
    ]);
  });
});
