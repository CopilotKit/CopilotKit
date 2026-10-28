import type { Interrupt } from "@ag-ui/client";
import { describe, expect, it } from "vitest";

import { ɵInterruptState } from "../interrupt-state";

function interrupt(
  id: string,
  toolCallId?: string,
  reason: string = id,
): Interrupt {
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

  it.each(["human_approval", "tool-approval"])(
    "does not create tool results for backend-owned %s interrupts",
    (reason) => {
      const state = new ɵInterruptState();
      state.setStandard([interrupt("approval-one", "tool-one", reason)]);

      expect(state.resolve("approved")).toMatchObject({
        kind: "resume",
        toolResults: [],
      });
    },
  );

  describe("server-owned tool execution", () => {
    function nativeApproval(): Interrupt {
      return {
        ...interrupt("approval", "server-call", "tool_call"),
        metadata: { "ag-ui:tool-execution": "server" },
        responseSchema: {
          type: "object",
          properties: { approved: { type: "boolean" } },
          required: ["approved"],
        },
      };
    }

    it.each([true, false])(
      "sends approved=%s as a decision without fabricating an execution result",
      (approved) => {
        const state = new ɵInterruptState();
        state.setStandard([nativeApproval()]);

        expect(state.resolve({ approved })).toEqual({
          kind: "resume",
          resume: [
            {
              interruptId: "approval",
              status: "resolved",
              payload: { approved },
            },
          ],
          toolResults: [],
        });
        expect(state.resolve({ approved })).toEqual({ kind: "ignored" });
      },
    );

    it("cancels without fabricating a server tool result", () => {
      const state = new ɵInterruptState();
      state.setStandard([nativeApproval()]);

      expect(state.cancel()).toEqual({
        kind: "resume",
        resume: [{ interruptId: "approval", status: "cancelled" }],
        toolResults: [],
      });
    });

    it("retains ownership when pending interrupts are restored from JSON", () => {
      const state = new ɵInterruptState();
      state.setStandard(JSON.parse(JSON.stringify([nativeApproval()])));

      expect(state.resolve({ approved: true })).toMatchObject({
        kind: "resume",
        resume: [{ interruptId: "approval", status: "resolved" }],
        toolResults: [],
      });
    });

    it("preserves frontend completions alongside native approval decisions", () => {
      const state = new ɵInterruptState();
      state.setStandard([
        nativeApproval(),
        interrupt("frontend", "frontend-call", "tool_call"),
      ]);

      expect(state.resolve({ approved: true }, "approval")).toEqual({
        kind: "waiting",
      });
      expect(state.resolve({ approved: true }, "frontend")).toEqual({
        kind: "resume",
        resume: [
          {
            interruptId: "approval",
            status: "resolved",
            payload: { approved: true },
          },
          {
            interruptId: "frontend",
            status: "resolved",
            payload: { approved: true },
          },
        ],
        toolResults: [
          { toolCallId: "frontend-call", content: '{"approved":true}' },
        ],
      });
    });

    it.each([undefined, "client", "unknown"])(
      "does not infer server ownership from an approval schema or payload (%s)",
      (execution) => {
        const state = new ɵInterruptState();
        state.setStandard([
          {
            ...nativeApproval(),
            metadata: execution
              ? { "ag-ui:tool-execution": execution }
              : undefined,
          },
        ]);

        expect(state.resolve({ approved: true })).toMatchObject({
          kind: "resume",
          toolResults: [
            { toolCallId: "server-call", content: '{"approved":true}' },
          ],
        });
      },
    );
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
