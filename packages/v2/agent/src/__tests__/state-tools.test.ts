import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BasicAgent } from "../index";
import { EventType, type RunAgentInput } from "@ag-ui/client";
import { streamText } from "ai";
import { mockStreamTextResponse, toolCallStreamingStart, toolCall, toolResult, finish, collectEvents } from "./test-helpers";

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
          toolResult("call1", "AGUISendStateSnapshot", { success: true, snapshot: newState }),
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
      const snapshotEvent = events.find((e: any) => e.type === EventType.STATE_SNAPSHOT);
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
          toolResult("call1", "AGUISendStateSnapshot", { success: true, snapshot: { value: 1 } }),
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
      const snapshotEvent = events.find((e: any) => e.type === EventType.STATE_SNAPSHOT);
      const toolResultEvent = events.find((e: any) => e.type === EventType.TOOL_CALL_RESULT);

      expect(snapshotEvent).toBeDefined();
      expect(toolResultEvent).toBeDefined();
      expect(toolResultEvent).toMatchObject({
        type: EventType.TOOL_CALL_RESULT,
        toolCallId: "call1",
      });
    });
  });

  describe("AGUISendStateDelta", () => {
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
      const deltaEvent = events.find((e: any) => e.type === EventType.STATE_DELTA);
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

      const deltaEvent = events.find((e: any) => e.type === EventType.STATE_DELTA);
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

      const deltaEvent = events.find((e: any) => e.type === EventType.STATE_DELTA);
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

      const deltaEvent = events.find((e: any) => e.type === EventType.STATE_DELTA);
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

      const deltaEvent = events.find((e: any) => e.type === EventType.STATE_DELTA);
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
      const deltaEvent = events.find((e: any) => e.type === EventType.STATE_DELTA);
      const toolResultEvent = events.find((e: any) => e.type === EventType.TOOL_CALL_RESULT);

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
          toolResult("call1", "AGUISendStateSnapshot", { success: true, snapshot: { value: 1 } }),
          toolCallStreamingStart("call2", "AGUISendStateDelta"),
          toolCall("call2", "AGUISendStateDelta"),
          toolResult("call2", "AGUISendStateDelta", { success: true, delta: [{ op: "replace", path: "/value", value: 2 }] }),
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

      const snapshotEvents = events.filter((e: any) => e.type === EventType.STATE_SNAPSHOT);
      const deltaEvents = events.filter((e: any) => e.type === EventType.STATE_DELTA);

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
        (e: any) => e.type === EventType.STATE_SNAPSHOT || e.type === EventType.STATE_DELTA,
      );

      expect(stateEvents).toHaveLength(0);
    });
  });
});
