/**
 * The state tools, through the classic agent: the fake model calls
 * AGUISendStateSnapshot / AGUISendStateDelta, the real `chat()` runs them,
 * and their results become STATE_SNAPSHOT / STATE_DELTA events. Delta shapes
 * that the tool schema rejects (copy, move, test, malformed entries) still
 * reach the converter from a factory; converter-tanstack.test.ts pins those.
 */
import { describe, it, expect, vi } from "vitest";
import { compactEvents, EventType } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";
import { EventSchemas } from "@ag-ui/core/schemas";
import { z } from "zod";
import { defineTool } from "../index";
import { eventsOfType, runClassicAgent } from "./agent-test-helpers";

type StateToolCall =
  | { id: string; name: "AGUISendStateSnapshot"; input: { snapshot: unknown } }
  | { id: string; name: "AGUISendStateDelta"; input: { delta: unknown[] } };

/** Runs one model call that makes `calls`, starting from `state`. */
async function runStateTools(state: unknown, calls: StateToolCall[]) {
  const { events } = await runClassicAgent({}, [{ toolCalls: calls }], {
    state,
  });
  return events;
}

/** Runs one AGUISendStateDelta call (`call1`) with `delta` on `state`. */
function runDelta(delta: unknown[], state: unknown) {
  return runStateTools(state, [
    { id: "call1", name: "AGUISendStateDelta", input: { delta } },
  ]);
}

function emittedDelta(events: BaseEvent[]) {
  return eventsOfType(events, EventType.STATE_DELTA)[0]?.delta;
}

/** The state after AG-UI compaction applies the run's state events. */
function compactedState(events: BaseEvent[]) {
  return eventsOfType(compactEvents(events), EventType.STATE_SNAPSHOT).at(-1)
    ?.snapshot;
}

function indexOfType(events: BaseEvent[], type: EventType) {
  return events.findIndex((event) => event.type === type);
}

function expectUnappliablePatchRecovery(events: BaseEvent[], state: unknown) {
  const delta = events.find((event) => event.type === EventType.STATE_DELTA);
  expect(EventSchemas.safeParse(delta).success).toBe(true);

  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    expect(compactedState(events)).toEqual(state);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[ag-ui][compact] Failed to apply state patch"),
    );
  } finally {
    warn.mockRestore();
  }
}

function cloneFallbackCallback() {
  return "keep this reference";
}

describe("AGUISendStateSnapshot", () => {
  it("emits STATE_SNAPSHOT, then the TOOL_CALL_RESULT for the model", async () => {
    const newState = { counter: 5, items: ["x", "y"] };

    const events = await runStateTools({ counter: 0 }, [
      {
        id: "call1",
        name: "AGUISendStateSnapshot",
        input: { snapshot: newState },
      },
    ]);

    expect(eventsOfType(events, EventType.STATE_SNAPSHOT)).toEqual([
      expect.objectContaining({ snapshot: newState }),
    ]);
    expect(eventsOfType(events, EventType.TOOL_CALL_RESULT)).toEqual([
      expect.objectContaining({
        toolCallId: "call1",
        content: JSON.stringify({ success: true, snapshot: newState }),
      }),
    ]);
    expect(indexOfType(events, EventType.STATE_SNAPSHOT)).toBeLessThan(
      indexOfType(events, EventType.TOOL_CALL_RESULT),
    );
  });
});

describe("AGUISendStateDelta", () => {
  it("emits STATE_DELTA, then the TOOL_CALL_RESULT for the model", async () => {
    const delta = [
      { op: "replace", path: "/counter", value: 10 },
      { op: "add", path: "/newField", value: "test" },
    ];

    const events = await runDelta(delta, { counter: 0 });

    expect(emittedDelta(events)).toEqual(delta);
    expect(eventsOfType(events, EventType.TOOL_CALL_RESULT)).toEqual([
      expect.objectContaining({
        toolCallId: "call1",
        content: JSON.stringify({ success: true, delta }),
      }),
    ]);
    expect(indexOfType(events, EventType.STATE_DELTA)).toBeLessThan(
      indexOfType(events, EventType.TOOL_CALL_RESULT),
    );
  });

  it("passes add, replace, and remove operations through unchanged", async () => {
    const delta = [
      { op: "replace", path: "/counter", value: 5 },
      { op: "add", path: "/items/0", value: "new" },
      { op: "remove", path: "/temp" },
    ];

    const events = await runDelta(delta, {
      counter: 0,
      items: [],
      temp: "remove me",
    });

    expect(emittedDelta(events)).toEqual(delta);
    expect(compactedState(events)).toEqual({ counter: 5, items: ["new"] });
  });

  it("initializes a missing array before appending to it", async () => {
    const todo = { text: "Buy milk", completed: false };
    const delta = [{ op: "add", path: "/todos/-", value: todo }];

    const events = await runDelta(delta, {});

    expect(emittedDelta(events)).toEqual([
      { op: "add", path: "/todos", value: [] },
      ...delta,
    ]);
    expect(compactedState(events)).toEqual({ todos: [todo] });
  });

  it("preserves an existing input array when appending", async () => {
    const existingTodo = { text: "Buy eggs", completed: true };
    const newTodo = { text: "Buy milk", completed: false };
    const delta = [{ op: "add", path: "/todos/-", value: newTodo }];

    const events = await runDelta(delta, { todos: [existingTodo] });

    expect(emittedDelta(events)).toEqual(delta);
    expect(compactedState(events)).toEqual({ todos: [existingTodo, newTodo] });
  });

  it("only initializes literal add append operations", async () => {
    const delta = [{ op: "replace", path: "/todos/-", value: "not an append" }];

    const events = await runDelta(delta, {});

    expect(emittedDelta(events)).toEqual(delta);
  });

  it("initializes a missing array once for repeated appends", async () => {
    const firstTodo = { text: "Buy eggs", completed: true };
    const secondTodo = { text: "Buy milk", completed: false };
    const delta = [
      { op: "replace", path: "/counter", value: 1 },
      { op: "add", path: "/todos/-", value: firstTodo },
      { op: "add", path: "/todos/-", value: secondTodo },
    ];

    const events = await runDelta(delta, { counter: 0 });

    expect(emittedDelta(events)).toEqual([
      delta[0],
      { op: "add", path: "/todos", value: [] },
      delta[1],
      delta[2],
    ]);
    expect(compactedState(events)).toEqual({
      counter: 1,
      todos: [firstTodo, secondTodo],
    });
  });

  it("preserves non-array append failures", async () => {
    const delta = [{ op: "add", path: "/todos/-", value: "new todo" }];

    const events = await runDelta(delta, { todos: "not an array" });

    expect(emittedDelta(events)).toEqual(delta);
    expectUnappliablePatchRecovery(events, { todos: "not an array" });
  });

  it("does not synthesize an unknown ancestor", async () => {
    const delta = [{ op: "add", path: "/lists/todos/-", value: "new todo" }];

    const events = await runDelta(delta, {});

    expect(emittedDelta(events)).toEqual(delta);
    expectUnappliablePatchRecovery(events, {});
  });

  it("clones the state when structuredClone cannot clone it", async () => {
    const state = { todos: [], callback: cloneFallbackCallback };
    const delta = [
      { op: "add", path: "/todos/-", value: { text: "Buy milk" } },
    ];

    const events = await runDelta(delta, state);
    const [snapshot] = eventsOfType(events, EventType.STATE_SNAPSHOT);

    expect(state.todos).toEqual([]);
    expect(snapshot?.snapshot).toEqual({ todos: [], callback: state.callback });
    expect(snapshot?.snapshot).not.toBe(state);
    expect(snapshot?.snapshot.todos).not.toBe(state.todos);
  });

  it("answers operations outside add, replace, and remove with an Error result and no STATE_DELTA", async () => {
    const events = await runDelta(
      [{ op: "copy", from: "/source", path: "/copied" }],
      { source: [1] },
    );

    expect(eventsOfType(events, EventType.STATE_DELTA)).toEqual([]);
    expect(
      eventsOfType(events, EventType.TOOL_CALL_RESULT)[0]?.content,
    ).toMatch(
      /^Error: Input validation failed for tool AGUISendStateDelta: #\/delta\/0\/op: /,
    );
  });
});

describe("State tools together", () => {
  it("handles a snapshot and a delta in the same run", async () => {
    const events = await runStateTools({}, [
      {
        id: "call1",
        name: "AGUISendStateSnapshot",
        input: { snapshot: { value: 1 } },
      },
      {
        id: "call2",
        name: "AGUISendStateDelta",
        input: { delta: [{ op: "replace", path: "/value", value: 2 }] },
      },
    ]);

    expect(eventsOfType(events, EventType.STATE_SNAPSHOT)).toHaveLength(1);
    expect(eventsOfType(events, EventType.STATE_DELTA)).toHaveLength(1);
    expect(compactedState(events)).toEqual({ value: 2 });
  });

  it("emits no state events for a tool that is not a state tool", async () => {
    const spoofing = defineTool({
      name: "otherTool",
      description: "Returns state-shaped data",
      parameters: z.object({}),
      execute: async () => ({
        snapshot: { spoofed: true },
        delta: [{ op: "replace", path: "/spoofed", value: true }],
      }),
    });

    const { events } = await runClassicAgent({ tools: [spoofing] }, [
      { toolCalls: [{ id: "call1", name: "otherTool", input: {} }] },
    ]);

    expect(eventsOfType(events, EventType.STATE_SNAPSHOT)).toEqual([]);
    expect(eventsOfType(events, EventType.STATE_DELTA)).toEqual([]);
    expect(eventsOfType(events, EventType.TOOL_CALL_RESULT)).toHaveLength(1);
  });
});
