import type { Interrupt, Message } from "@ag-ui/client";
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

describe("frontend results alongside interrupts", () => {
  const saved: Message[] = [
    { id: "result", role: "tool", toolCallId: "chart", content: "" },
  ];
  function pending() {
    const state = new ɵInterruptState();
    state.setStandard([
      interrupt("chart-i", "chart", "tool_call"),
      interrupt("approval"),
    ]);
    return state;
  }
  it("reuses an empty frontend result while answering a native approval", () => {
    expect(pending().resolve("allow", "approval", saved)).toEqual({
      kind: "resume",
      resume: [
        { interruptId: "chart-i", status: "resolved", payload: "" },
        { interruptId: "approval", status: "resolved", payload: "allow" },
      ],
      toolResults: [],
    });
  });
  it("keeps an unanswered native approval pending", () => {
    expect(pending().resolve("", "chart-i", saved)).toEqual({
      kind: "waiting",
    });
  });
  it("cancels a native approval without replacing a frontend result", () => {
    expect(pending().cancel("approval", saved)).toMatchObject({
      kind: "resume",
      toolResults: [],
      resume: [
        { interruptId: "chart-i", status: "resolved", payload: "" },
        { interruptId: "approval", status: "cancelled" },
      ],
    });
  });
  it("rejects conflicting responses or cancellation of a completed call", () => {
    expect(() =>
      pending().resolve({ status: "displayed" }, "chart-i", saved),
    ).toThrow(/conflict/i);
    expect(() => pending().cancel("chart-i", saved)).toThrow(/conflict/i);
  });
  it.each(["", "plain result", '{"status":"displayed"}', '"quoted"'])(
    "preserves saved result bytes %j in automatic resume",
    (content) => {
      const state = new ɵInterruptState();
      state.setStandard([interrupt("chart-i", "chart", "tool_call")]);
      expect(
        state.resumeWithToolResults([
          { id: "result", role: "tool", toolCallId: "chart", content },
        ]),
      ).toEqual({
        kind: "resume",
        resume: [
          { interruptId: "chart-i", status: "resolved", payload: content },
        ],
        toolResults: [],
      });
    },
  );
  it("does not treat a transport placeholder as an answer", () => {
    const state = new ɵInterruptState();
    state.setStandard([interrupt("chart-i", "chart", "tool_call")]);
    expect(
      state.resumeWithToolResults([
        {
          id: "result",
          role: "tool",
          toolCallId: "chart",
          content: "Forwarded to client",
        },
      ]),
    ).toEqual({ kind: "waiting" });
  });
  it("does not auto-resume an expired interrupt even with a saved answer", () => {
    const state = new ɵInterruptState();
    state.setStandard([
      {
        ...interrupt("chart-i", "chart", "tool_call"),
        expiresAt: "2000-01-01T00:00:00Z",
      },
    ]);
    expect(state.resumeWithToolResults(saved)).toMatchObject({
      kind: "expired",
    });
  });
  it("a rejected conflicting response does not poison the remaining decisions", () => {
    const state = pending();
    expect(() => state.cancel("chart-i", saved)).toThrow(/conflict/i);
    expect(state.resolve("allow", "approval", saved)).toMatchObject({
      kind: "resume",
      toolResults: [],
    });
  });
  it("rejects even identical duplicate saved results", () => {
    expect(() =>
      pending().resolve("allow", "approval", [
        ...saved,
        { ...saved[0]!, id: "duplicate" },
      ]),
    ).toThrow(/duplicate/i);
  });
});

describe("ɵInterruptState", () => {
  it("allows cancellation of an expired interrupt", () => {
    const state = new ɵInterruptState();
    state.setStandard([
      { ...interrupt("approval"), expiresAt: "2000-01-01T00:00:00Z" },
    ]);

    expect(state.cancel("approval")).toEqual({
      kind: "resume",
      resume: [{ interruptId: "approval", status: "cancelled" }],
      toolResults: [],
    });
  });

  it("cancels an expired approval alongside a saved frontend result", () => {
    const state = new ɵInterruptState();
    state.setStandard([
      interrupt("chart-i", "chart", "tool_call"),
      { ...interrupt("approval"), expiresAt: "2000-01-01T00:00:00Z" },
    ]);

    expect(
      state.cancel("approval", [
        { id: "saved", role: "tool", toolCallId: "chart", content: "" },
      ]),
    ).toEqual({
      kind: "resume",
      resume: [
        { interruptId: "chart-i", status: "resolved", payload: "" },
        { interruptId: "approval", status: "cancelled" },
      ],
      toolResults: [],
    });
  });

  it("still rejects resolving an expired interrupt explicitly", () => {
    const state = new ɵInterruptState();
    state.setStandard([
      { ...interrupt("approval"), expiresAt: "2000-01-01T00:00:00Z" },
    ]);

    expect(state.resolve("allow", "approval")).toMatchObject({
      kind: "expired",
      interrupt: { id: "approval" },
    });
  });

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

  it("does not create tool results for backend-owned interrupts", () => {
    const state = new ɵInterruptState();
    state.setStandard([
      interrupt("mastra-run::tool-one", "tool-one", "human_approval"),
    ]);

    expect(state.resolve("approved")).toMatchObject({
      kind: "resume",
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
