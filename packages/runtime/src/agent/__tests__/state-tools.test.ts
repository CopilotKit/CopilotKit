import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BasicAgent } from "../index";
import { compactEvents, EventType } from "@ag-ui/client";
import type { RunAgentInput } from "@ag-ui/client";
import { streamText } from "ai";
import {
  mockStreamTextResponse,
  toolCallStreamingStart,
  toolCall,
  toolResult,
  finish,
  collectEvents,
} from "./test-helpers";

function cloneFallbackCallback() {
  return "keep this reference";
}

// Mock the ai module
vi.mock("ai", () => ({
  streamText: vi.fn(),
  tool: vi.fn((config) => config),
}));

// Mock the SDK clients
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => (modelId: string) => ({
    modelId,
    provider: "openai",
  })),
}));

describe("State Update Tools", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.OPENAI_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("AGUISendStateSnapshot", () => {
    it("should emit STATE_SNAPSHOT event when tool is called", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
      });

      const newState = { counter: 5, items: ["x", "y"] };

      vi.mocked(streamText).mockReturnValue(
        mockStreamTextResponse([
          toolCallStreamingStart("call1", "AGUISendStateSnapshot"),
          toolCall("call1", "AGUISendStateSnapshot"),
          toolResult("call1", "AGUISendStateSnapshot", {
            success: true,
            snapshot: newState,
          }),
          finish(),
        ]) as any,
      );

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [],
        tools: [],
        context: [],
        state: { counter: 0 },
      };

      const events = await collectEvents(agent["run"](input));

      // Find STATE_SNAPSHOT event
      const snapshotEvent = events.find(
        (e: any) => e.type === EventType.STATE_SNAPSHOT,
      );
      expect(snapshotEvent).toBeDefined();
      expect(snapshotEvent).toMatchObject({
        type: EventType.STATE_SNAPSHOT,
        snapshot: newState,
      });
    });

    it("should still emit TOOL_CALL_RESULT for the LLM", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
      });

      vi.mocked(streamText).mockReturnValue(
        mockStreamTextResponse([
          toolCallStreamingStart("call1", "AGUISendStateSnapshot"),
          toolCall("call1", "AGUISendStateSnapshot"),
          toolResult("call1", "AGUISendStateSnapshot", {
            success: true,
            snapshot: { value: 1 },
          }),
          finish(),
        ]) as any,
      );

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [],
        tools: [],
        context: [],
        state: {},
      };

      const events = await collectEvents(agent["run"](input));

      // Should have both STATE_SNAPSHOT and TOOL_CALL_RESULT
      const snapshotEvent = events.find(
        (e: any) => e.type === EventType.STATE_SNAPSHOT,
      );
      const toolResultEvent = events.find(
        (e: any) => e.type === EventType.TOOL_CALL_RESULT,
      );

      expect(snapshotEvent).toBeDefined();
      expect(toolResultEvent).toBeDefined();
      expect(toolResultEvent).toMatchObject({
        type: EventType.TOOL_CALL_RESULT,
        toolCallId: "call1",
      });
    });
  });

  describe("AGUISendStateDelta", () => {
    const emitStateDelta = async (delta: unknown[], state: unknown) => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
      });

      vi.mocked(streamText).mockReturnValue(
        mockStreamTextResponse([
          toolCallStreamingStart("snapshot", "AGUISendStateSnapshot"),
          toolCall("snapshot", "AGUISendStateSnapshot"),
          toolResult("snapshot", "AGUISendStateSnapshot", {
            success: true,
            snapshot: state,
          }),
          toolCallStreamingStart("call1", "AGUISendStateDelta"),
          toolCall("call1", "AGUISendStateDelta"),
          toolResult("call1", "AGUISendStateDelta", {
            success: true,
            delta,
          }),
          finish(),
        ]) as any,
      );

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [],
        tools: [],
        context: [],
        state,
      };

      return collectEvents(agent["run"](input));
    };

    it("should initialize a missing array before appending to it", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
      });

      const todo = { text: "Buy milk", completed: false };
      const delta = [{ op: "add" as const, path: "/todos/-", value: todo }];

      vi.mocked(streamText).mockReturnValue(
        mockStreamTextResponse([
          toolCallStreamingStart("call1", "AGUISendStateDelta"),
          toolCall("call1", "AGUISendStateDelta"),
          toolResult("call1", "AGUISendStateDelta", { success: true, delta }),
          finish(),
        ]) as any,
      );

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [],
        tools: [],
        context: [],
        state: {},
      };

      const events = await collectEvents(agent["run"](input));
      const deltaEvent = events.find(
        (e: any) => e.type === EventType.STATE_DELTA,
      );
      const toolResultEvent = events.find(
        (e: any) => e.type === EventType.TOOL_CALL_RESULT,
      );

      expect(deltaEvent?.delta).toEqual([
        { op: "add", path: "/todos", value: [] },
        ...delta,
      ]);
      expect(events.indexOf(deltaEvent!)).toBeLessThan(
        events.indexOf(toolResultEvent!),
      );

      const compactedEvents = compactEvents(events);
      const stateSnapshot = compactedEvents.find(
        (event: any) => event.type === EventType.STATE_SNAPSHOT,
      );
      expect(stateSnapshot).toMatchObject({
        type: EventType.STATE_SNAPSHOT,
        snapshot: { todos: [todo] },
      });
    });

    it("should preserve an existing input array when appending", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
      });

      const existingTodo = { text: "Buy eggs", completed: true };
      const newTodo = { text: "Buy milk", completed: false };
      const delta = [{ op: "add" as const, path: "/todos/-", value: newTodo }];

      vi.mocked(streamText).mockReturnValue(
        mockStreamTextResponse([
          toolCallStreamingStart("call1", "AGUISendStateDelta"),
          toolCall("call1", "AGUISendStateDelta"),
          toolResult("call1", "AGUISendStateDelta", { success: true, delta }),
          finish(),
        ]) as any,
      );

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [],
        tools: [],
        context: [],
        state: { todos: [existingTodo] },
      };

      const events = await collectEvents(agent["run"](input));
      const deltaEvent = events.find(
        (e: any) => e.type === EventType.STATE_DELTA,
      );

      expect(deltaEvent?.delta).toEqual(delta);
      const compactedEvents = compactEvents(events);
      const stateSnapshot = compactedEvents.find(
        (event: any) => event.type === EventType.STATE_SNAPSHOT,
      );
      expect(stateSnapshot).toMatchObject({
        type: EventType.STATE_SNAPSHOT,
        snapshot: { todos: [existingTodo, newTodo] },
      });
    });

    it("should only initialize literal add append operations", async () => {
      const delta = [
        { op: "replace", path: "/todos/-", value: "not an append" },
      ];
      const events = await emitStateDelta(delta, {});
      const deltaEvent = events.find(
        (event: any) => event.type === EventType.STATE_DELTA,
      );

      expect(deltaEvent?.delta).toEqual(delta);
    });

    it("should initialize a missing array once for repeated appends", async () => {
      const firstTodo = { text: "Buy eggs", completed: true };
      const secondTodo = { text: "Buy milk", completed: false };
      const delta = [
        { op: "replace", path: "/counter", value: 1 },
        { op: "add", path: "/todos/-", value: firstTodo },
        { op: "add", path: "/todos/-", value: secondTodo },
      ];

      const events = await emitStateDelta(delta, { counter: 0 });
      const deltaEvent = events.find(
        (event: any) => event.type === EventType.STATE_DELTA,
      );

      expect(deltaEvent?.delta).toEqual([
        delta[0],
        { op: "add", path: "/todos", value: [] },
        delta[1],
        delta[2],
      ]);
      const compactedEvents = compactEvents(events);
      const stateSnapshot = compactedEvents.find(
        (event: any) => event.type === EventType.STATE_SNAPSHOT,
      );
      expect(stateSnapshot).toMatchObject({
        snapshot: { counter: 1, todos: [firstTodo, secondTodo] },
      });
    });

    it("should preserve copy, move, and test before later appends", async () => {
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
      const events = await emitStateDelta(delta, {
        source: [sourceItem],
        moving: [movedItem],
      });
      const deltaEvent = events.find(
        (event: any) => event.type === EventType.STATE_DELTA,
      );

      expect(deltaEvent?.delta).toEqual(delta);
      const stateSnapshot = compactEvents(events).find(
        (event: any) => event.type === EventType.STATE_SNAPSHOT,
      );
      expect(stateSnapshot).toMatchObject({
        snapshot: {
          source: [sourceItem],
          copied: [sourceItem, copiedAppend],
          moved: [movedItem, movedAppend],
        },
      });
    });

    it("should preserve non-array append failures", async () => {
      const delta = [{ op: "add", path: "/todos/-", value: "new todo" }];
      const events = await emitStateDelta(delta, { todos: "not an array" });
      const deltaEvent = events.find(
        (event: any) => event.type === EventType.STATE_DELTA,
      );

      expect(deltaEvent?.delta).toEqual(delta);
      expect(() => compactEvents(events)).toThrow(
        "OPERATION_PATH_UNRESOLVABLE",
      );
    });

    it("should preserve malformed entries for downstream validation", async () => {
      const delta = [null];
      const events = await emitStateDelta(delta, {});
      const deltaIdx = events.findIndex(
        (event: any) => event.type === EventType.STATE_DELTA,
      );
      const resultIdx = events.findIndex(
        (event: any) =>
          event.type === EventType.TOOL_CALL_RESULT &&
          event.toolCallId === "call1",
      );

      expect(deltaIdx).toBeGreaterThanOrEqual(0);
      expect(deltaIdx).toBeLessThan(resultIdx);
      expect(events[deltaIdx]).toMatchObject({
        type: EventType.STATE_DELTA,
        delta,
      });
      expect(() => compactEvents(events)).toThrow("OPERATION_NOT_AN_OBJECT");
    });

    it("should not synthesize an unknown ancestor", async () => {
      const delta = [{ op: "add", path: "/lists/todos/-", value: "new todo" }];
      const events = await emitStateDelta(delta, {});
      const deltaEvent = events.find(
        (event: any) => event.type === EventType.STATE_DELTA,
      );

      expect(deltaEvent?.delta).toEqual(delta);
      expect(() => compactEvents(events)).toThrow("OPERATION_PATH_CANNOT_ADD");
    });

    it("should clone state when structuredClone cannot clone it", async () => {
      const callback = cloneFallbackCallback;
      const state = { todos: [], callback };
      const delta = [
        {
          op: "add",
          path: "/todos/-",
          value: { text: "Buy milk", callback },
        },
      ];
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
      });

      vi.mocked(streamText).mockReturnValue(
        mockStreamTextResponse([
          toolCallStreamingStart("call1", "AGUISendStateDelta"),
          toolCall("call1", "AGUISendStateDelta"),
          toolResult("call1", "AGUISendStateDelta", { success: true, delta }),
          finish(),
        ]) as any,
      );

      const events = await collectEvents(
        agent["run"]({
          threadId: "thread1",
          runId: "run1",
          messages: [],
          tools: [],
          context: [],
          state,
        }),
      );
      const stateSnapshot = events.find(
        (event: any) => event.type === EventType.STATE_SNAPSHOT,
      ) as any;

      expect(state.todos).toEqual([]);
      expect(stateSnapshot?.snapshot).not.toBe(state);
      expect(stateSnapshot?.snapshot.todos).not.toBe(state.todos);
    });

    it("should emit STATE_DELTA event when tool is called", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
      });

      const delta = [
        { op: "replace", path: "/counter", value: 10 },
        { op: "add", path: "/newField", value: "test" },
      ];

      vi.mocked(streamText).mockReturnValue(
        mockStreamTextResponse([
          toolCallStreamingStart("call1", "AGUISendStateDelta"),
          toolCall("call1", "AGUISendStateDelta"),
          toolResult("call1", "AGUISendStateDelta", { success: true, delta }),
          finish(),
        ]) as any,
      );

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [],
        tools: [],
        context: [],
        state: { counter: 0 },
      };

      const events = await collectEvents(agent["run"](input));

      // Find STATE_DELTA event
      const deltaEvent = events.find(
        (e: any) => e.type === EventType.STATE_DELTA,
      );
      expect(deltaEvent).toBeDefined();
      expect(deltaEvent).toMatchObject({
        type: EventType.STATE_DELTA,
        delta,
      });
    });

    it("should handle add operations", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
      });

      const delta = [{ op: "add", path: "/items/0", value: "new item" }];

      vi.mocked(streamText).mockReturnValue(
        mockStreamTextResponse([
          toolCallStreamingStart("call1", "AGUISendStateDelta"),
          toolCall("call1", "AGUISendStateDelta"),
          toolResult("call1", "AGUISendStateDelta", { success: true, delta }),
          finish(),
        ]) as any,
      );

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [],
        tools: [],
        context: [],
        state: { items: [] },
      };

      const events = await collectEvents(agent["run"](input));

      const deltaEvent = events.find(
        (e: any) => e.type === EventType.STATE_DELTA,
      );
      expect(deltaEvent?.delta).toEqual(delta);
    });

    it("should handle replace operations", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
      });

      const delta = [{ op: "replace", path: "/status", value: "active" }];

      vi.mocked(streamText).mockReturnValue(
        mockStreamTextResponse([
          toolCallStreamingStart("call1", "AGUISendStateDelta"),
          toolCall("call1", "AGUISendStateDelta"),
          toolResult("call1", "AGUISendStateDelta", { success: true, delta }),
          finish(),
        ]) as any,
      );

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [],
        tools: [],
        context: [],
        state: { status: "inactive" },
      };

      const events = await collectEvents(agent["run"](input));

      const deltaEvent = events.find(
        (e: any) => e.type === EventType.STATE_DELTA,
      );
      expect(deltaEvent?.delta).toEqual(delta);
    });

    it("should handle remove operations", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
      });

      const delta = [{ op: "remove", path: "/oldField" }];

      vi.mocked(streamText).mockReturnValue(
        mockStreamTextResponse([
          toolCallStreamingStart("call1", "AGUISendStateDelta"),
          toolCall("call1", "AGUISendStateDelta"),
          toolResult("call1", "AGUISendStateDelta", { success: true, delta }),
          finish(),
        ]) as any,
      );

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [],
        tools: [],
        context: [],
        state: { oldField: "value", keepField: "keep" },
      };

      const events = await collectEvents(agent["run"](input));

      const deltaEvent = events.find(
        (e: any) => e.type === EventType.STATE_DELTA,
      );
      expect(deltaEvent?.delta).toEqual(delta);
    });

    it("should handle multiple operations in a single delta", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
      });

      const delta = [
        { op: "replace", path: "/counter", value: 5 },
        { op: "add", path: "/items/-", value: "new" },
        { op: "remove", path: "/temp" },
      ];

      vi.mocked(streamText).mockReturnValue(
        mockStreamTextResponse([
          toolCallStreamingStart("call1", "AGUISendStateDelta"),
          toolCall("call1", "AGUISendStateDelta"),
          toolResult("call1", "AGUISendStateDelta", { success: true, delta }),
          finish(),
        ]) as any,
      );

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [],
        tools: [],
        context: [],
        state: { counter: 0, items: [], temp: "remove me" },
      };

      const events = await collectEvents(agent["run"](input));

      const deltaEvent = events.find(
        (e: any) => e.type === EventType.STATE_DELTA,
      );
      expect(deltaEvent?.delta).toEqual(delta);
    });

    it("should still emit TOOL_CALL_RESULT for the LLM", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
      });

      const delta = [{ op: "replace", path: "/value", value: 1 }];

      vi.mocked(streamText).mockReturnValue(
        mockStreamTextResponse([
          toolCallStreamingStart("call1", "AGUISendStateDelta"),
          toolCall("call1", "AGUISendStateDelta"),
          toolResult("call1", "AGUISendStateDelta", { success: true, delta }),
          finish(),
        ]) as any,
      );

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [],
        tools: [],
        context: [],
        state: {},
      };

      const events = await collectEvents(agent["run"](input));

      // Should have both STATE_DELTA and TOOL_CALL_RESULT
      const deltaEvent = events.find(
        (e: any) => e.type === EventType.STATE_DELTA,
      );
      const toolResultEvent = events.find(
        (e: any) => e.type === EventType.TOOL_CALL_RESULT,
      );

      expect(deltaEvent).toBeDefined();
      expect(toolResultEvent).toBeDefined();
      expect(toolResultEvent).toMatchObject({
        type: EventType.TOOL_CALL_RESULT,
        toolCallId: "call1",
      });
    });
  });

  describe("State Tools Integration", () => {
    it("should handle both snapshot and delta in same run", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
      });

      vi.mocked(streamText).mockReturnValue(
        mockStreamTextResponse([
          toolCallStreamingStart("call1", "AGUISendStateSnapshot"),
          toolCall("call1", "AGUISendStateSnapshot"),
          toolResult("call1", "AGUISendStateSnapshot", {
            success: true,
            snapshot: { value: 1 },
          }),
          toolCallStreamingStart("call2", "AGUISendStateDelta"),
          toolCall("call2", "AGUISendStateDelta"),
          toolResult("call2", "AGUISendStateDelta", {
            success: true,
            delta: [{ op: "replace", path: "/value", value: 2 }],
          }),
          finish(),
        ]) as any,
      );

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [],
        tools: [],
        context: [],
        state: {},
      };

      const events = await collectEvents(agent["run"](input));

      const snapshotEvents = events.filter(
        (e: any) => e.type === EventType.STATE_SNAPSHOT,
      );
      const deltaEvents = events.filter(
        (e: any) => e.type === EventType.STATE_DELTA,
      );

      expect(snapshotEvents).toHaveLength(1);
      expect(deltaEvents).toHaveLength(1);
    });

    it("should not emit state events for non-state tools", async () => {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
      });

      vi.mocked(streamText).mockReturnValue(
        mockStreamTextResponse([
          toolCallStreamingStart("call1", "otherTool"),
          toolCall("call1", "otherTool"),
          toolResult("call1", "otherTool", { result: "data" }),
          finish(),
        ]) as any,
      );

      const input: RunAgentInput = {
        threadId: "thread1",
        runId: "run1",
        messages: [],
        tools: [
          {
            name: "otherTool",
            description: "Other tool",
            parameters: { type: "object", properties: {} },
          },
        ],
        context: [],
        state: {},
      };

      const events = await collectEvents(agent["run"](input));

      const stateEvents = events.filter(
        (e: any) =>
          e.type === EventType.STATE_SNAPSHOT ||
          e.type === EventType.STATE_DELTA,
      );

      expect(stateEvents).toHaveLength(0);
    });
  });
});
