import type { Interrupt } from "@ag-ui/client";
import { describe, expect, it } from "vitest";

import { ɵInterruptState } from "../interrupt-state";

function interrupt(id: string, toolCallId?: string, reason = id): Interrupt {
  return {
    id,
    reason,
    ...(toolCallId ? { toolCallId } : {}),
  };
}

describe("ɵInterruptState", () => {
  it("waits for every interrupt and emits one resume decision", () => {
    const state = new ɵInterruptState();
    state.setStandard([
      interrupt("one", "call-one", "tool_call"),
      interrupt("two"),
    ]);

    expect(state.resolve({ approved: true }, "one")).toEqual({
      kind: "waiting",
    });
    expect(state.cancel("two")).toEqual({
      kind: "resume",
      resume: [
        {
          interruptId: "one",
          status: "resolved",
          payload: { approved: true },
        },
        { interruptId: "two", status: "cancelled" },
      ],
      toolResults: [
        {
          toolCallId: "call-one",
          content: JSON.stringify({ approved: true }),
        },
      ],
    });
  });

  it("does not synthesize a result for backend-owned tool interrupts", () => {
    const state = new ɵInterruptState();
    state.setStandard([interrupt("suspend-one", "call-one", "human_approval")]);

    expect(state.resolve({ approved: true })).toEqual({
      kind: "resume",
      resume: [
        {
          interruptId: "suspend-one",
          status: "resolved",
          payload: { approved: true },
        },
      ],
      toolResults: [],
    });
  });

  it("keeps legacy resume data framework-neutral", () => {
    const state = new ɵInterruptState<{ requestId: string }>();
    state.setLegacy({
      name: "on_interrupt",
      value: { requestId: "request-1" },
    });

    expect(state.resolve("approved")).toEqual({
      kind: "legacy-resume",
      payload: "approved",
      interruptValue: { requestId: "request-1" },
    });
  });
});
