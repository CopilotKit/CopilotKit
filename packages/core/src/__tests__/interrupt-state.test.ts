import type { Interrupt } from "@ag-ui/client";
import { describe, expect, it } from "vitest";

import { ɵInterruptState } from "../interrupt-state";

function interrupt(id: string, toolCallId?: string): Interrupt {
  return {
    id,
    reason: id,
    ...(toolCallId ? { toolCallId } : {}),
  };
}

describe("ɵInterruptState", () => {
  it("waits for every interrupt and emits one resume decision", () => {
    const state = new ɵInterruptState();
    state.setStandard([interrupt("one", "call-one"), interrupt("two")]);

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
