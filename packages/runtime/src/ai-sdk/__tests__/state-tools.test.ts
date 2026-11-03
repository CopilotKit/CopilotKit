/**
 * The AG-UI state tools in `aiSdkAgent`, ported from the classic
 * BuiltInAgent `state-tools.test.ts`. The mock model calls the tools, the
 * real `streamText` runs them, and the run turns their results into
 * STATE_SNAPSHOT and STATE_DELTA events.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { compactEvents, EventType } from "@ag-ui/client";
import type { BaseEvent, State } from "@ag-ui/client";
import { EventSchemas } from "@ag-ui/core/schemas";
import { eventField } from "../../agent/__tests__/agent-test-helpers";
import { aiSdkAgent } from "../agent";
import {
  eventsOfType,
  modelEmitting,
  modelEmittingTurns,
  runAgent,
  toolCallTurn,
} from "./mock-model";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Runs one model turn that calls AGUISendStateSnapshot. */
async function sendSnapshot(snapshot: unknown, state: State = {}) {
  const model = modelEmitting(
    toolCallTurn("call1", "AGUISendStateSnapshot", { snapshot }),
  );
  return runAgent(aiSdkAgent({ model }), { state });
}

/** Runs one model turn that calls AGUISendStateDelta. */
async function sendDelta(delta: unknown[], state: State) {
  const model = modelEmitting(
    toolCallTurn("call1", "AGUISendStateDelta", { delta }),
  );
  return runAgent(aiSdkAgent({ model }), { state });
}

/**
 * Runs a snapshot of `state` and then `delta`, so that `compactEvents` has
 * a state to apply the delta to.
 */
async function sendSnapshotThenDelta(delta: unknown[], state: State) {
  const model = modelEmittingTurns([
    toolCallTurn("snapshot", "AGUISendStateSnapshot", { snapshot: state }),
    toolCallTurn("call1", "AGUISendStateDelta", { delta }),
  ]);
  return runAgent(aiSdkAgent({ model, maxSteps: 2 }), { state });
}

function deltaOf(events: BaseEvent[]) {
  return eventField(eventsOfType(events, EventType.STATE_DELTA)[0], "delta");
}

/** The state after replaying the run's state events. */
function compactedSnapshot(events: BaseEvent[]) {
  const snapshot = compactEvents(events).find(
    (event) => event.type === EventType.STATE_SNAPSHOT,
  );
  return snapshot ? eventField(snapshot, "snapshot") : undefined;
}

/**
 * The STATE_DELTA is valid AG-UI, but its patch cannot apply, so a client
 * replaying it keeps `state` and logs a warning.
 */
function expectUnappliablePatchRecovery(events: BaseEvent[], state: unknown) {
  const delta = eventsOfType(events, EventType.STATE_DELTA)[0];
  expect(EventSchemas.safeParse(delta).success).toBe(true);

  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(compactedSnapshot(events)).toEqual(state);
  expect(warn).toHaveBeenCalledWith(
    expect.stringContaining("[ag-ui][compact] Failed to apply state patch"),
  );
}

function cloneFallbackCallback() {
  return "keep this reference";
}

describe("AGUISendStateSnapshot", () => {
  it("emits STATE_SNAPSHOT and still sends the tool result to the model", async () => {
    const newState = { counter: 5, items: ["x", "y"] };

    const events = await sendSnapshot(newState, { counter: 0 });

    expect(eventsOfType(events, EventType.STATE_SNAPSHOT)).toEqual([
      expect.objectContaining({ snapshot: newState }),
    ]);
    expect(eventsOfType(events, EventType.TOOL_CALL_RESULT)).toEqual([
      expect.objectContaining({ toolCallId: "call1" }),
    ]);
  });
});

describe("AGUISendStateDelta", () => {
  it("emits STATE_DELTA before the tool result, for add, replace, and remove", async () => {
    const delta = [
      { op: "replace", path: "/counter", value: 5 },
      { op: "add", path: "/items/-", value: "new" },
      { op: "remove", path: "/temp" },
    ];

    const events = await sendDelta(delta, {
      counter: 0,
      items: [],
      temp: "remove me",
    });

    expect(deltaOf(events)).toEqual(delta);
    const deltaIndex = events.findIndex(
      (event) => event.type === EventType.STATE_DELTA,
    );
    const resultIndex = events.findIndex(
      (event) => event.type === EventType.TOOL_CALL_RESULT,
    );
    expect(eventField(events[resultIndex], "toolCallId")).toBe("call1");
    expect(deltaIndex).toBeLessThan(resultIndex);
  });

  it("initializes a missing array before appending to it", async () => {
    const todo = { text: "Buy milk", completed: false };
    const delta = [{ op: "add", path: "/todos/-", value: todo }];

    const events = await sendDelta(delta, {});

    expect(deltaOf(events)).toEqual([
      { op: "add", path: "/todos", value: [] },
      ...delta,
    ]);
    expect(compactedSnapshot(events)).toEqual({ todos: [todo] });
  });

  it("keeps an existing input array when appending", async () => {
    const existingTodo = { text: "Buy eggs", completed: true };
    const newTodo = { text: "Buy milk", completed: false };
    const delta = [{ op: "add", path: "/todos/-", value: newTodo }];

    const events = await sendDelta(delta, { todos: [existingTodo] });

    expect(deltaOf(events)).toEqual(delta);
    expect(compactedSnapshot(events)).toEqual({
      todos: [existingTodo, newTodo],
    });
  });

  it("initializes only for a literal add append", async () => {
    const delta = [{ op: "replace", path: "/todos/-", value: "not an append" }];

    const events = await sendSnapshotThenDelta(delta, {});

    expect(deltaOf(events)).toEqual(delta);
  });

  it("initializes a missing array once for repeated appends", async () => {
    const firstTodo = { text: "Buy eggs", completed: true };
    const secondTodo = { text: "Buy milk", completed: false };
    const delta = [
      { op: "replace", path: "/counter", value: 1 },
      { op: "add", path: "/todos/-", value: firstTodo },
      { op: "add", path: "/todos/-", value: secondTodo },
    ];

    const events = await sendSnapshotThenDelta(delta, { counter: 0 });

    expect(deltaOf(events)).toEqual([
      delta[0],
      { op: "add", path: "/todos", value: [] },
      delta[1],
      delta[2],
    ]);
    expect(compactedSnapshot(events)).toEqual({
      counter: 1,
      todos: [firstTodo, secondTodo],
    });
  });

  it("keeps copy, move, and test before later appends", async () => {
    const sourceItem = { id: "source" };
    const movedItem = { id: "moved" };
    const copiedAppend = { id: "copied-append" };
    const movedAppend = { id: "moved-append" };
    const delta = [
      { op: "copy", from: "/source", path: "/copied" },
      { op: "move", from: "/moving", path: "/moved" },
      { op: "test", path: "/copied/0", value: sourceItem },
      { op: "add", path: "/copied/-", value: copiedAppend },
      { op: "add", path: "/moved/-", value: movedAppend },
    ];

    const events = await sendSnapshotThenDelta(delta, {
      source: [sourceItem],
      moving: [movedItem],
    });

    expect(deltaOf(events)).toEqual(delta);
    expect(compactedSnapshot(events)).toEqual({
      source: [sourceItem],
      copied: [sourceItem, copiedAppend],
      moved: [movedItem, movedAppend],
    });
  });

  it("keeps an append to a non-array, which a client cannot apply", async () => {
    const delta = [{ op: "add", path: "/todos/-", value: "new todo" }];

    const events = await sendSnapshotThenDelta(delta, {
      todos: "not an array",
    });

    expect(deltaOf(events)).toEqual(delta);
    expectUnappliablePatchRecovery(events, { todos: "not an array" });
  });

  it("does not create an unknown ancestor", async () => {
    const delta = [{ op: "add", path: "/lists/todos/-", value: "new todo" }];

    const events = await sendSnapshotThenDelta(delta, {});

    expect(deltaOf(events)).toEqual(delta);
    expectUnappliablePatchRecovery(events, {});
  });

  it("keeps malformed entries for downstream validation", async () => {
    const delta = [null];

    const events = await sendSnapshotThenDelta(delta, {});

    const deltaIndex = events.findIndex(
      (event) => event.type === EventType.STATE_DELTA,
    );
    const resultIndex = events.findIndex(
      (event) =>
        event.type === EventType.TOOL_CALL_RESULT &&
        eventField(event, "toolCallId") === "call1",
    );
    expect(deltaIndex).toBeGreaterThanOrEqual(0);
    expect(deltaIndex).toBeLessThan(resultIndex);
    expect(eventField(events[deltaIndex], "delta")).toEqual(delta);
    expect(EventSchemas.safeParse(events[deltaIndex]).success).toBe(false);
  });

  it("does not change the input state when structuredClone cannot clone it", async () => {
    const callback = cloneFallbackCallback;
    const state = { todos: [], callback };
    const delta = [
      { op: "add", path: "/todos/-", value: { text: "Buy milk" } },
    ];

    const events = await sendDelta(delta, state);

    expect(state.todos).toEqual([]);
    expect(deltaOf(events)).toEqual(delta);
  });
});

describe("state tools in one run", () => {
  it("emits one snapshot and one delta when the model calls both", async () => {
    const events = await sendSnapshotThenDelta(
      [{ op: "replace", path: "/value", value: 2 }],
      { value: 1 },
    );

    expect(eventsOfType(events, EventType.STATE_SNAPSHOT)).toHaveLength(1);
    expect(eventsOfType(events, EventType.STATE_DELTA)).toHaveLength(1);
  });

  it("emits no state events for a call to another tool", async () => {
    const model = modelEmitting(toolCallTurn("call1", "otherTool", {}));

    const events = await runAgent(aiSdkAgent({ model }), {
      tools: [
        {
          name: "otherTool",
          description: "Other tool",
          parameters: { type: "object", properties: {} },
        },
      ],
    });

    expect(eventsOfType(events, EventType.TOOL_CALL_START)).toHaveLength(1);
    expect(eventsOfType(events, EventType.STATE_SNAPSHOT)).toEqual([]);
    expect(eventsOfType(events, EventType.STATE_DELTA)).toEqual([]);
  });
});
