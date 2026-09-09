import type { Interrupt } from "@ag-ui/client";
import { describe, expect, it } from "vitest";

import {
  ɵclearLegacyInterrupt,
  ɵInterruptState,
  ɵreadLegacyInterrupt,
  ɵrecordLegacyInterrupt,
} from "../interrupt-state";

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

describe("legacy interrupt record", () => {
  it("returns null for an agent that holds no legacy interrupt", () => {
    expect(ɵreadLegacyInterrupt({}, "thread-1")).toBeNull();
  });

  it("reads back what was recorded for one agent", () => {
    const agent = {};
    ɵrecordLegacyInterrupt(agent, {
      event: { name: "on_interrupt", value: "approve?" },
      threadId: "thread-1",
      runId: "run-1",
    });

    expect(ɵreadLegacyInterrupt(agent, "thread-1")).toEqual({
      event: { name: "on_interrupt", value: "approve?" },
      threadId: "thread-1",
      runId: "run-1",
    });
  });

  it("keeps one agent's record out of another agent's", () => {
    const first = {};
    const second = {};
    ɵrecordLegacyInterrupt(first, {
      event: { name: "on_interrupt", value: "first" },
      threadId: "thread-1",
    });

    expect(ɵreadLegacyInterrupt(second, "thread-1")).toBeNull();
  });

  it("hides a record raised in a different thread", () => {
    // One agent instance serves every conversation. Thread A's approval
    // prompt must not surface while the app shows thread B, because
    // answering it there would resume A.
    const agent = {};
    ɵrecordLegacyInterrupt(agent, {
      event: { name: "on_interrupt", value: "approve A?" },
      threadId: "thread-a",
      runId: "run-a",
    });

    expect(ɵreadLegacyInterrupt(agent, "thread-b")).toBeNull();
  });

  it("still recovers the record when the original thread comes back", () => {
    const agent = {};
    ɵrecordLegacyInterrupt(agent, {
      event: { name: "on_interrupt", value: "approve A?" },
      threadId: "thread-a",
      runId: "run-a",
    });

    // Reading from thread B must not consume or drop the record.
    expect(ɵreadLegacyInterrupt(agent, "thread-b")).toBeNull();
    expect(ɵreadLegacyInterrupt(agent, "thread-a")).toEqual({
      event: { name: "on_interrupt", value: "approve A?" },
      threadId: "thread-a",
      runId: "run-a",
    });
  });

  it("forgets a record on clear", () => {
    const agent = {};
    ɵrecordLegacyInterrupt(agent, {
      event: { name: "on_interrupt", value: "approve?" },
      threadId: "thread-1",
    });
    ɵclearLegacyInterrupt(agent);

    expect(ɵreadLegacyInterrupt(agent, "thread-1")).toBeNull();
  });
});
