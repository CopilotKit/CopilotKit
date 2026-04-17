import { describe, it, expect } from "vitest";
import { EventType, type BaseEvent } from "@ag-ui/client";
import { BuiltInAgent } from "../index";
import {
  createAgent,
  createDefaultInput,
  collectEvents,
  expectLifecycleWrapped,
  expectEventSequence,
  eventField,
  mockCustomStream,
} from "./agent-test-helpers";

describe("Custom Converter (passthrough)", () => {
  // -----------------------------------------------------------------------
  // Event Forwarding
  // -----------------------------------------------------------------------
  describe("Event Forwarding", () => {
    it("should forward a single TEXT_MESSAGE_CHUNK as-is between lifecycle events", async () => {
      const chunk: BaseEvent = {
        type: EventType.TEXT_MESSAGE_CHUNK,
        role: "assistant",
        delta: "Hello world",
      } as BaseEvent;

      const agent = createAgent("custom", [chunk]);
      const input = createDefaultInput();
      const events = await collectEvents(agent.run(input));

      expectLifecycleWrapped(events, "test-thread", "test-run");
      expectEventSequence(events, [
        EventType.RUN_STARTED,
        EventType.TEXT_MESSAGE_CHUNK,
        EventType.RUN_FINISHED,
      ]);

      expect(eventField<string>(events[1], "delta")).toBe("Hello world");
      expect(eventField<string>(events[1], "role")).toBe("assistant");
    });

    it("should forward multiple event types in order", async () => {
      const userEvents: BaseEvent[] = [
        { type: EventType.TEXT_MESSAGE_START, role: "assistant" } as BaseEvent,
        {
          type: EventType.TEXT_MESSAGE_CONTENT,
          role: "assistant",
          content: "Hi",
        } as BaseEvent,
        { type: EventType.TEXT_MESSAGE_END } as BaseEvent,
      ];

      const agent = createAgent("custom", userEvents);
      const events = await collectEvents(agent.run(createDefaultInput()));

      expectEventSequence(events, [
        EventType.RUN_STARTED,
        EventType.TEXT_MESSAGE_START,
        EventType.TEXT_MESSAGE_CONTENT,
        EventType.TEXT_MESSAGE_END,
        EventType.RUN_FINISHED,
      ]);
    });

    it("should forward TOOL_CALL_START + TOOL_CALL_ARGS + TOOL_CALL_END", async () => {
      const toolEvents: BaseEvent[] = [
        {
          type: EventType.TOOL_CALL_START,
          toolCallId: "tc-1",
          toolCallName: "myTool",
        } as BaseEvent,
        {
          type: EventType.TOOL_CALL_ARGS,
          toolCallId: "tc-1",
          delta: '{"key":"value"}',
        } as BaseEvent,
        {
          type: EventType.TOOL_CALL_END,
          toolCallId: "tc-1",
        } as BaseEvent,
      ];

      const agent = createAgent("custom", toolEvents);
      const events = await collectEvents(agent.run(createDefaultInput()));

      expectEventSequence(events, [
        EventType.RUN_STARTED,
        EventType.TOOL_CALL_START,
        EventType.TOOL_CALL_ARGS,
        EventType.TOOL_CALL_END,
        EventType.RUN_FINISHED,
      ]);

      expect(eventField<string>(events[1], "toolCallId")).toBe("tc-1");
      expect(eventField<string>(events[1], "toolCallName")).toBe("myTool");

      expect(eventField<string>(events[2], "toolCallId")).toBe("tc-1");
      expect(eventField<string>(events[2], "delta")).toBe('{"key":"value"}');

      expect(eventField<string>(events[3], "toolCallId")).toBe("tc-1");
    });

    it("should forward a STATE_SNAPSHOT event", async () => {
      const snapshot: BaseEvent = {
        type: EventType.STATE_SNAPSHOT,
        snapshot: { counter: 42, items: ["a", "b"] },
      } as BaseEvent;

      const agent = createAgent("custom", [snapshot]);
      const events = await collectEvents(agent.run(createDefaultInput()));

      expectEventSequence(events, [
        EventType.RUN_STARTED,
        EventType.STATE_SNAPSHOT,
        EventType.RUN_FINISHED,
      ]);

      expect(
        eventField<Record<string, unknown>>(events[1], "snapshot"),
      ).toEqual({ counter: 42, items: ["a", "b"] });
    });

    it("should forward a STATE_DELTA event", async () => {
      const delta: BaseEvent = {
        type: EventType.STATE_DELTA,
        delta: [{ op: "replace", path: "/counter", value: 43 }],
      } as BaseEvent;

      const agent = createAgent("custom", [delta]);
      const events = await collectEvents(agent.run(createDefaultInput()));

      expectEventSequence(events, [
        EventType.RUN_STARTED,
        EventType.STATE_DELTA,
        EventType.RUN_FINISHED,
      ]);

      expect(eventField<unknown[]>(events[1], "delta")).toEqual([
        { op: "replace", path: "/counter", value: 43 },
      ]);
    });

    it("should forward reasoning events in order", async () => {
      const reasoningEvents: BaseEvent[] = [
        { type: EventType.REASONING_START } as BaseEvent,
        { type: EventType.REASONING_MESSAGE_START } as BaseEvent,
        {
          type: EventType.REASONING_MESSAGE_CONTENT,
          content: "Thinking step 1",
        } as BaseEvent,
        {
          type: EventType.REASONING_MESSAGE_CONTENT,
          content: "Thinking step 2",
        } as BaseEvent,
        { type: EventType.REASONING_MESSAGE_END } as BaseEvent,
        { type: EventType.REASONING_END } as BaseEvent,
      ];

      const agent = createAgent("custom", reasoningEvents);
      const events = await collectEvents(agent.run(createDefaultInput()));

      expectEventSequence(events, [
        EventType.RUN_STARTED,
        EventType.REASONING_START,
        EventType.REASONING_MESSAGE_START,
        EventType.REASONING_MESSAGE_CONTENT,
        EventType.REASONING_MESSAGE_CONTENT,
        EventType.REASONING_MESSAGE_END,
        EventType.REASONING_END,
        EventType.RUN_FINISHED,
      ]);

      expect(eventField<string>(events[3], "content")).toBe("Thinking step 1");
      expect(eventField<string>(events[4], "content")).toBe("Thinking step 2");
    });
  });

  // -----------------------------------------------------------------------
  // Lifecycle Boundary
  // -----------------------------------------------------------------------
  describe("Lifecycle Boundary", () => {
    it("should result in duplicate RUN_STARTED when user emits one in custom stream", async () => {
      const userEvents: BaseEvent[] = [
        {
          type: EventType.RUN_STARTED,
          threadId: "user-thread",
          runId: "user-run",
        } as BaseEvent,
        {
          type: EventType.TEXT_MESSAGE_CHUNK,
          role: "assistant",
          delta: "Hello",
        } as BaseEvent,
      ];

      const agent = createAgent("custom", userEvents);
      const events = await collectEvents(agent.run(createDefaultInput()));

      // Agent emits its own RUN_STARTED, then the user's RUN_STARTED is forwarded
      const runStartedEvents = events.filter(
        (e) => e.type === EventType.RUN_STARTED,
      );
      expect(runStartedEvents).toHaveLength(2);

      // First is from the Agent lifecycle
      expect(runStartedEvents[0]).toMatchObject({
        type: EventType.RUN_STARTED,
        threadId: "test-thread",
        runId: "test-run",
      });

      // Second is the user-emitted one, forwarded as-is
      expect(eventField<string>(runStartedEvents[1], "threadId")).toBe(
        "user-thread",
      );
      expect(eventField<string>(runStartedEvents[1], "runId")).toBe("user-run");
    });
  });

  // -----------------------------------------------------------------------
  // Edge Cases
  // -----------------------------------------------------------------------
  describe("Edge Cases", () => {
    it("should emit only lifecycle events for an empty async iterable", async () => {
      const agent = createAgent("custom", []);
      const events = await collectEvents(agent.run(createDefaultInput()));

      expectEventSequence(events, [
        EventType.RUN_STARTED,
        EventType.RUN_FINISHED,
      ]);
      expectLifecycleWrapped(events, "test-thread", "test-run");
    });

    it("should work correctly with an async generator factory", async () => {
      const agent = new BuiltInAgent({
        type: "custom",
        factory: async function* () {
          yield {
            type: EventType.TEXT_MESSAGE_CHUNK,
            role: "assistant",
            delta: "from generator",
          } as BaseEvent;
          yield {
            type: EventType.TEXT_MESSAGE_CHUNK,
            role: "assistant",
            delta: " factory",
          } as BaseEvent;
        },
      });

      const events = await collectEvents(agent.run(createDefaultInput()));

      expectEventSequence(events, [
        EventType.RUN_STARTED,
        EventType.TEXT_MESSAGE_CHUNK,
        EventType.TEXT_MESSAGE_CHUNK,
        EventType.RUN_FINISHED,
      ]);

      expect(eventField<string>(events[1], "delta")).toBe("from generator");
      expect(eventField<string>(events[2], "delta")).toBe(" factory");
    });

    it("should pass through events with extra/unknown fields", async () => {
      const eventWithExtras: BaseEvent = {
        type: EventType.CUSTOM,
        customField: "custom-value",
        nestedData: { deep: { value: 123 } },
        arrayField: [1, 2, 3],
      } as BaseEvent;

      const agent = createAgent("custom", [eventWithExtras]);
      const events = await collectEvents(agent.run(createDefaultInput()));

      expectEventSequence(events, [
        EventType.RUN_STARTED,
        EventType.CUSTOM,
        EventType.RUN_FINISHED,
      ]);

      expect(eventField<string>(events[1], "customField")).toBe("custom-value");
      expect(
        eventField<{ deep: { value: number } }>(events[1], "nestedData"),
      ).toEqual({ deep: { value: 123 } });
      expect(eventField<number[]>(events[1], "arrayField")).toEqual([1, 2, 3]);
    });

    it("should forward 1000+ events without loss", async () => {
      const count = 1500;
      const manyEvents: BaseEvent[] = Array.from({ length: count }, (_, i) => ({
        type: EventType.TEXT_MESSAGE_CHUNK,
        role: "assistant",
        delta: `chunk-${i}`,
      })) as BaseEvent[];

      const agent = createAgent("custom", manyEvents);
      const events = await collectEvents(agent.run(createDefaultInput()));

      // Total = RUN_STARTED + 1500 chunks + RUN_FINISHED
      expect(events).toHaveLength(count + 2);

      // First and last are lifecycle
      expect(events[0].type).toBe(EventType.RUN_STARTED);
      expect(events[events.length - 1].type).toBe(EventType.RUN_FINISHED);

      // All content events are TEXT_MESSAGE_CHUNK
      const contentEvents = events.slice(1, -1);
      expect(contentEvents).toHaveLength(count);

      // Verify order preservation
      for (let i = 0; i < count; i++) {
        expect(contentEvents[i].type).toBe(EventType.TEXT_MESSAGE_CHUNK);
        expect(eventField<string>(contentEvents[i], "delta")).toBe(
          `chunk-${i}`,
        );
      }
    });
  });
});
