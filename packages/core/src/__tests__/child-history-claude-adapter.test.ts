import { expect, it } from "vitest";
import { adaptChildHistoryEvent } from "../child-history-claude-adapter";

it("normalizes native records without mutating their persisted wire representation", () => {
  const native = {
    type: "CUSTOM",
    name: "claude:assistant_content",
    value: {
      parentToolUseId: "parent",
      messageId: "message",
      uuid: "record",
      content: [
        { type: "thinking", thinking: "Plan" },
        {
          type: "tool_use",
          id: "call",
          name: "mcp__ag_ui__chart",
          input: { value: 7 },
        },
      ],
    },
  };
  const original = structuredClone(native);
  expect(adaptChildHistoryEvent(native)).toEqual({
    type: "CUSTOM",
    name: "cpki.child_assistant_content",
    value: {
      ...native.value,
      content: [
        { type: "reasoning", text: "Plan" },
        { type: "tool_call", id: "call", name: "chart", args: { value: 7 } },
      ],
    },
  });
  expect(native).toEqual(original);
});
it("passes neutral producer events through unchanged", () => {
  const neutral = {
    type: "CUSTOM",
    name: "cpki.child_assistant_content",
    value: {
      parentToolUseId: "parent",
      messageId: "message",
      content: [{ type: "text", text: "Neutral producer" }],
    },
  };
  expect(adaptChildHistoryEvent(neutral)).toBe(neutral);
});
it("translates native result ownership only at the adapter boundary", () => {
  expect(
    adaptChildHistoryEvent({
      type: "TOOL_CALL_RESULT",
      rawEvent: { parent_tool_use_id: "parent", is_error: true },
    }),
  ).toMatchObject({
    childHistory: { parentToolCallId: "parent", isError: true },
  });
});
