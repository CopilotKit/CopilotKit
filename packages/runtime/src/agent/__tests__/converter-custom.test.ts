import { describe, it, expect } from "vitest";
import { EventType, type BaseEvent } from "@ag-ui/client";
import { Agent } from "../agent";
import {
  createAgent,
  createDefaultInput,
  collectEvents,
  expectLifecycleWrapped,
  expectEventSequence,
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

      const textEvent = events[1] as BaseEvent & { delta: string; role: string };
      expect(textEvent.delta).toBe("Hello world");
      expect(textEvent.role).toBe("assistant");
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

      const start = events[1] as BaseEvent & {
        toolCallId: string;
        toolCallName: string;
      };
      expect(start.toolCallId).toBe("tc-1");
      expect(start.toolCallName).toBe("myTool");

      const args = events[2] as BaseEvent & {
        toolCallId: string;
        delta: string;
      };
      expect(args.toolCallId).toBe("tc-1");
      expect(args.delta).toBe('{"key":"value"}');

      const end = events[3] as BaseEvent & { toolCallId: string };
      expect(end.toolCallId).toBe("tc-1");
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

      const stateEvent = events[1] as BaseEvent & {
        snapshot: Record<string, unknown>;
      };
      expect(stateEvent.snapshot).toEqual({ counter: 42, items: ["a", "b"] });
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

      const deltaEvent = events[1] as BaseEvent & { delta: unknown[] };
      expect(deltaEvent.delta).toEqual([
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

      const content1 = events[3] as BaseEvent & { content: string };
      expect(content1.content).toBe("Thinking step 1");

      const content2 = events[4] as BaseEvent & { content: string };
      expect(content2.content).toBe("Thinking step 2");
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
      const userStart = runStartedEvents[1] as BaseEvent & {
        threadId: string;
        runId: string;
      };
      expect(userStart.threadId).toBe("user-thread");
      expect(userStart.runId).toBe("user-run");
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
      const agent = new Agent({
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

      const first = events[1] as BaseEvent & { delta: string };
      const second = events[2] as BaseEvent & { delta: string };
      expect(first.delta).toBe("from generator");
      expect(second.delta).toBe(" factory");
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

      const forwarded = events[1] as BaseEvent & {
        customField: string;
        nestedData: { deep: { value: number } };
        arrayField: number[];
      };
      expect(forwarded.customField).toBe("custom-value");
      expect(forwarded.nestedData).toEqual({ deep: { value: 123 } });
      expect(forwarded.arrayField).toEqual([1, 2, 3]);
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
        const evt = contentEvents[i] as BaseEvent & { delta: string };
        expect(evt.type).toBe(EventType.TEXT_MESSAGE_CHUNK);
        expect(evt.delta).toBe(`chunk-${i}`);
      }
    });
  });
});
