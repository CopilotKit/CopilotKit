import { EventType } from "@ag-ui/client";
import type {
  SubagentErrorEvent,
  SubagentFinishedEvent,
  SubagentStartedEvent,
} from "@ag-ui/client";
import { describe, expect, it } from "vitest";

import { ɵSubagentState } from "../subagent-state";

function started(
  subagentRunId: string,
  overrides: Partial<SubagentStartedEvent> = {},
): SubagentStartedEvent {
  return {
    type: EventType.SUBAGENT_STARTED,
    subagentRunId,
    name: `${subagentRunId}-agent`,
    ...overrides,
  };
}

function finished(
  subagentRunId: string,
  overrides: Partial<SubagentFinishedEvent> = {},
): SubagentFinishedEvent {
  return { type: EventType.SUBAGENT_FINISHED, subagentRunId, ...overrides };
}

function failed(
  subagentRunId: string,
  message: string,
  code?: string,
): SubagentErrorEvent {
  return { type: EventType.SUBAGENT_ERROR, subagentRunId, message, code };
}

function statuses(state: ɵSubagentState) {
  return state.list.map(({ subagentRunId, status }) => [subagentRunId, status]);
}

describe("ɵSubagentState", () => {
  it("tracks parallel invocations in start order with their parent links", () => {
    const state = new ɵSubagentState();
    state.started(
      started("research", {
        name: "researcher",
        description: "Finds sources",
        parentToolCallId: "call-1",
        parentMessageId: "message-1",
      }),
    );
    state.started(started("write", { parentToolCallId: "call-2" }));
    state.finished(finished("write", { result: { words: 120 } }));

    expect(state.list).toEqual([
      {
        subagentRunId: "research",
        name: "researcher",
        description: "Finds sources",
        parentToolCallId: "call-1",
        parentMessageId: "message-1",
        status: "running",
      },
      {
        subagentRunId: "write",
        name: "write-agent",
        parentToolCallId: "call-2",
        status: "done",
        result: { words: 120 },
      },
    ]);
  });

  it("keeps the interrupt ids of a suspended invocation and continues it under the same id", () => {
    const state = new ɵSubagentState();
    state.started(started("approve"));
    state.finished(
      finished("approve", {
        outcome: { type: "suspended", interruptIds: ["interrupt-1"] },
      }),
    );
    expect(state.list).toEqual([
      {
        subagentRunId: "approve",
        name: "approve-agent",
        status: "suspended",
        interruptIds: ["interrupt-1"],
      },
    ]);

    expect(state.started(started("approve"))).toBe(true);
    expect(state.list).toEqual([
      { subagentRunId: "approve", name: "approve-agent", status: "running" },
    ]);
  });

  it("treats an absent or success outcome as done", () => {
    const state = new ɵSubagentState();
    state.started(started("a"));
    state.started(started("b"));
    state.finished(finished("a"));
    state.finished(finished("b", { outcome: { type: "success" } }));

    expect(statuses(state)).toEqual([
      ["a", "done"],
      ["b", "done"],
    ]);
  });

  it("records a subagent error", () => {
    const state = new ɵSubagentState();
    state.started(started("critic"));
    state.error(failed("critic", "Model timed out", "TIMEOUT"));

    expect(state.list).toEqual([
      {
        subagentRunId: "critic",
        name: "critic-agent",
        status: "error",
        error: { message: "Model timed out", code: "TIMEOUT" },
      },
    ]);
  });

  it("ignores a second start of an invocation that is not suspended", () => {
    const state = new ɵSubagentState();
    state.started(started("a", { name: "first" }));
    const before = state.list;

    expect(state.started(started("a", { name: "second" }))).toBe(false);
    state.finished(finished("a"));
    expect(state.started(started("a", { name: "third" }))).toBe(false);
    expect(state.list).toEqual([
      { subagentRunId: "a", name: "first", status: "done" },
    ]);
    expect(before).not.toBe(state.list);
  });

  it("ignores closers for an invocation that is not running", () => {
    const state = new ɵSubagentState();
    state.started(started("a"));
    state.finished(finished("a"));
    const before = state.list;

    expect(state.finished(finished("a"))).toBe(false);
    expect(state.error(failed("a", "late"))).toBe(false);
    expect(state.finished(finished("never-started"))).toBe(false);
    expect(state.list).toBe(before);
  });

  it("fails every running invocation when the run errors, and leaves closed ones alone", () => {
    const state = new ɵSubagentState();
    state.started(started("open"));
    state.started(started("done"));
    state.started(started("waiting"));
    state.finished(finished("done"));
    state.finished(finished("waiting", { outcome: { type: "suspended" } }));

    expect(state.runError("Upstream agent crashed")).toBe(true);
    expect(state.list).toEqual([
      {
        subagentRunId: "open",
        name: "open-agent",
        status: "error",
        error: { message: "Upstream agent crashed", code: "RUN_ERROR" },
      },
      { subagentRunId: "done", name: "done-agent", status: "done" },
      {
        subagentRunId: "waiting",
        name: "waiting-agent",
        status: "suspended",
        interruptIds: [],
      },
    ]);
  });

  it("cancels invocations still running when the run ends without closing them", () => {
    const state = new ɵSubagentState();
    state.started(started("open"));

    expect(state.runEnded()).toBe(true);
    expect(state.list).toEqual([
      {
        subagentRunId: "open",
        name: "open-agent",
        status: "error",
        error: {
          message: "The run ended before this subagent finished",
          code: "CANCELLED",
        },
      },
    ]);
    expect(state.runEnded()).toBe(false);
  });

  it("keeps the same list reference when nothing changed, and empties on clear", () => {
    const state = new ɵSubagentState();
    const empty = state.list;
    expect(state.runError("nothing open")).toBe(false);
    expect(state.clear()).toBe(false);
    expect(state.list).toBe(empty);

    state.started(started("a"));
    expect(state.clear()).toBe(true);
    expect(state.list).toEqual([]);
  });
});
