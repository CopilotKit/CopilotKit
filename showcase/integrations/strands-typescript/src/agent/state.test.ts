import { describe, expect, it } from "vitest";
import type { RunAgentInput } from "@ag-ui/core";
import { withStateContext } from "./state";

function input(state = {}): RunAgentInput {
  return {
    threadId: "thread",
    runId: "run",
    state,
    tools: [],
    forwardedProps: {},
    messages: [{ id: "user", role: "user", content: "Who am I?" }],
    context: [
      { description: "Application catalog", value: "catalog".repeat(9000) },
    ],
  };
}

describe("transient request state", () => {
  it("preserves original user messages and does not accumulate context across runs", () => {
    const request = input({
      preferences: { name: "Ada" },
      todos: ["Follow up"],
    });
    for (let turn = 0; turn < 8; turn++) {
      const prepared = withStateContext(request);
      expect(prepared.messages).toEqual(request.messages);
      expect(prepared.context).toHaveLength(3);
      expect(prepared.context[1].value).toContain("Ada");
      expect(prepared.context[2].value).toContain("Follow up");
    }
    expect(request.context).toHaveLength(1);
    expect(request.messages[0].content).toBe("Who am I?");
  });

  it("uses current state, including an empty pipeline, on tool continuation", () => {
    const request = input({ preferences: { name: "Grace" }, todos: [] });
    request.messages.push({
      id: "answer",
      role: "tool",
      toolCallId: "approval",
      content: "approved",
    });
    const prepared = withStateContext(request);
    expect(prepared.messages).toEqual(request.messages);
    expect(prepared.context[1].value).toContain("Grace");
    expect(prepared.context[2].value).toBe("[]");
    expect(withStateContext(input()).context).toHaveLength(1);
  });
});

it.each([null, 0, true, "primitive"])(
  "preserves context when state is %j",
  (state) => {
    const request = input();
    request.state = state;
    expect(withStateContext(request).context).toEqual(request.context);
    expect(withStateContext(request).messages).toEqual(request.messages);
  },
);
