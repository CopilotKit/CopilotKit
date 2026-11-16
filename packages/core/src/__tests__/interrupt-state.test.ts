import type { Interrupt, Message } from "@ag-ui/client";
import { describe, expect, it } from "vitest";

import { ɵInterruptState } from "../interrupt-state";

/** Build a protocol interrupt with optional frontend call ownership. */
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
  /** Create a mixed frontend-call and native-approval batch. */
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

describe("structured saved results", () => {
  it.each(["clone", "keys", "text", "media", "order"])(
    "compares %s by protocol value",
    (change) => {
      const content = [
        { type: "text" as const, text: "saved" },
        {
          type: "image" as const,
          source: {
            type: "url" as const,
            value: "https://example.com/image.png",
            mimeType: "image/png",
          },
          metadata: { filename: "image.png", extra: { a: 1, b: 2 } },
        },
      ];
      const messages: Message[] = [
        { id: "saved", role: "tool", toolCallId: "chart", content },
      ];
      const state = new ɵInterruptState();
      state.setStandard([
        interrupt("chart-i", "chart", "tool_call"),
        interrupt("a"),
        interrupt("b"),
      ]);
      expect(state.resolve("yes", "a", messages)).toEqual({ kind: "waiting" });
      const cloned = structuredClone(content);
      if (change === "keys")
        cloned[1]!.metadata = { extra: { b: 2, a: 1 }, filename: "image.png" };
      if (change === "text") cloned[0]!.text = "changed";
      if (change === "media")
        cloned[1]!.source!.value = "https://example.com/other.png";
      if (change === "order") cloned.reverse();
      const updated: Message[] = [
        { id: "saved", role: "tool", toolCallId: "chart", content: cloned },
      ];
      if (["text", "media", "order"].includes(change))
        expect(() => state.resolve("yes", "b", updated)).toThrow(/conflict/i);
      else {
        const decision = state.resolve("yes", "b", updated);
        expect(decision).toMatchObject({ kind: "resume", toolResults: [] });
        if (decision.kind === "resume")
          expect(decision.resume[0]!.payload).toBe(cloned);
      }
    },
  );
});

describe("completed frontend UI answers", () => {
  it.each(["failed", ""])("keeps explicit recovery for error %j", (error) => {
    const state = new ɵInterruptState();
    state.setStandard([interrupt("chart-i", "chart", "tool_call")]);
    const messages: Message[] = [
      {
        id: "result",
        role: "tool",
        toolCallId: "chart",
        content: "saved failure",
        error,
      },
    ];
    expect(state.isCompletedToolCall(undefined, messages)).toBe(false);
    expect(state.isCompletedToolCall("chart-i", messages)).toBe(false);
    expect(state.resolve("saved failure", "chart-i", messages)).toEqual({
      kind: "resume",
      resume: [
        {
          interruptId: "chart-i",
          status: "resolved",
          payload: "saved failure",
        },
      ],
      toolResults: [],
    });
  });

  it("does not hide duplicate success/error results", () => {
    const state = new ɵInterruptState();
    state.setStandard([interrupt("chart-i", "chart", "tool_call")]);
    const messages: Message[] = [
      { id: "success", role: "tool", toolCallId: "chart", content: "done" },
      {
        id: "failure",
        role: "tool",
        toolCallId: "chart",
        content: "failed",
        error: "",
      },
    ];
    expect(state.isCompletedToolCall("chart-i", messages)).toBe(false);
    expect(() => state.resolve("done", "chart-i", messages)).toThrow(
      /Duplicate tool results/,
    );
  });
});

describe("remaining review regressions", () => {
  it.each(["resolve", "cancel"] as const)(
    "allows explicit %s of a saved failure without duplicating history",
    (action) => {
      const state = new ɵInterruptState();
      state.setStandard([
        interrupt("failed", "call", "tool_call"),
        interrupt("approval"),
      ]);
      const messages: Message[] = [
        {
          id: "error",
          role: "tool",
          toolCallId: "call",
          content: "old failure",
          error: "",
        },
      ];
      expect(state.resumeWithToolResults(messages)).toEqual({
        kind: "waiting",
      });
      expect(
        action === "resolve"
          ? state.resolve("replacement", "failed", messages)
          : state.cancel("failed", messages),
      ).toEqual({ kind: "waiting" });
      expect(state.resolve(true, "approval", messages)).toEqual({
        kind: "resume",
        toolResults: [],
        resume: [
          action === "resolve"
            ? {
                interruptId: "failed",
                status: "resolved",
                payload: "replacement",
              }
            : { interruptId: "failed", status: "cancelled" },
          { interruptId: "approval", status: "resolved", payload: true },
        ],
      });
      expect(messages[0]).toMatchObject({ content: "old failure", error: "" });
    },
  );

  it("allows cancellation of an expired interrupt while retaining another decision", () => {
    const state = new ɵInterruptState();
    state.setStandard([
      { ...interrupt("expired"), expiresAt: "2000-01-01T00:00:00Z" },
      interrupt("approval"),
    ]);
    expect(state.cancel("expired")).toEqual({ kind: "waiting" });
    expect(state.resolve(true, "approval")).toMatchObject({
      kind: "resume",
      resume: [
        { interruptId: "expired", status: "cancelled" },
        { interruptId: "approval", status: "resolved", payload: true },
      ],
    });
  });

  it.each(["__proto__", "constructor", "toString"])(
    "requires an explicit decision for prototype-named id %s",
    (id) => {
      const state = new ɵInterruptState();
      state.setStandard([interrupt(id), interrupt("approval")]);
      expect(state.resolve(true, "approval")).toEqual({ kind: "waiting" });
      expect(state.cancel(id)).toMatchObject({
        kind: "resume",
        resume: [
          { interruptId: id, status: "cancelled" },
          { interruptId: "approval", status: "resolved", payload: true },
        ],
      });
      state.clear();
      state.setStandard([interrupt(id)]);
      expect(state.resumeWithToolResults([])).toEqual({ kind: "waiting" });
    },
  );

  it.each([
    [interrupt("same"), interrupt("same")],
    [interrupt("a", "same", "tool_call"), interrupt("b", "same", "tool_call")],
  ])(
    "rejects duplicate interrupt definitions without discarding the current batch",
    (a, b) => {
      const state = new ɵInterruptState();
      state.setStandard([interrupt("original")]);
      expect(() => state.setStandard([a, b])).toThrow(/Duplicate/);
      expect(state.cancel("original")).toMatchObject({ kind: "resume" });
    },
  );

  it("rejects duplicate assistant call definitions before creating tool results", () => {
    const state = new ɵInterruptState();
    state.setStandard([interrupt("a", "same", "tool_call")]);
    const call = {
      id: "same",
      type: "function" as const,
      function: { name: "chart", arguments: "{}" },
    };
    const messages: Message[] = [
      { id: "assistant", role: "assistant", toolCalls: [call, call] },
    ];
    expect(() => state.resolve(true, "a", messages)).toThrow(
      /Duplicate tool call definition/,
    );
    expect(state.resolve(true, "a")).toMatchObject({
      kind: "resume",
      toolResults: [{ toolCallId: "same" }],
    });
  });
});
