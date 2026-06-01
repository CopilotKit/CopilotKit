import { describe, it, expect, vi } from "vitest";
import { EventType } from "@ag-ui/client";
import type { BaseEvent } from "@ag-ui/client";
import type { DebugEventEnvelope } from "@copilotkit/shared";
import { DebugEventBus } from "../debug-event-bus";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createBaseEvent(
  overrides: Partial<BaseEvent> & { type: EventType } = {
    type: EventType.RUN_STARTED,
  },
): BaseEvent {
  return { type: overrides.type, ...overrides };
}

const defaultMetadata = {
  agentId: "test-agent",
  threadId: "thread-1",
  runId: "run-1",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DebugEventBus", () => {
  it("subscribe adds a listener and broadcast calls it with the correct envelope shape", () => {
    const bus = new DebugEventBus();
    const listener = vi.fn<[DebugEventEnvelope], void>();
    const event = createBaseEvent({ type: EventType.RUN_STARTED });

    bus.subscribe(listener);
    bus.broadcast(event, defaultMetadata);

    expect(listener).toHaveBeenCalledOnce();
    const envelope = listener.mock.calls[0][0];
    expect(envelope).toEqual(
      expect.objectContaining({
        agentId: "test-agent",
        threadId: "thread-1",
        runId: "run-1",
        event,
      }),
    );
    expect(typeof envelope.timestamp).toBe("number");
  });

  it("unsubscribe removes the listener so subsequent broadcasts don't reach it", () => {
    const bus = new DebugEventBus();
    const listener = vi.fn<[DebugEventEnvelope], void>();
    const event = createBaseEvent();

    const unsub = bus.subscribe(listener);
    unsub();
    bus.broadcast(event, defaultMetadata);

    expect(listener).not.toHaveBeenCalled();
  });

  it("multiple listeners all receive the same broadcast", () => {
    const bus = new DebugEventBus();
    const listenerA = vi.fn<[DebugEventEnvelope], void>();
    const listenerB = vi.fn<[DebugEventEnvelope], void>();
    const event = createBaseEvent();

    bus.subscribe(listenerA);
    bus.subscribe(listenerB);
    bus.broadcast(event, defaultMetadata);

    expect(listenerA).toHaveBeenCalledOnce();
    expect(listenerB).toHaveBeenCalledOnce();
    // Both receive the same envelope object
    expect(listenerA.mock.calls[0][0]).toBe(listenerB.mock.calls[0][0]);
  });

  it("listener errors are swallowed and other listeners still receive the event", () => {
    const bus = new DebugEventBus();
    const failingListener = vi
      .fn<[DebugEventEnvelope], void>()
      .mockImplementation(() => {
        throw new Error("boom");
      });
    const healthyListener = vi.fn<[DebugEventEnvelope], void>();
    const event = createBaseEvent();

    bus.subscribe(failingListener);
    bus.subscribe(healthyListener);

    // Should not throw
    expect(() => bus.broadcast(event, defaultMetadata)).not.toThrow();
    expect(failingListener).toHaveBeenCalledOnce();
    expect(healthyListener).toHaveBeenCalledOnce();
  });

  it("broadcasting with no listeners does not throw", () => {
    const bus = new DebugEventBus();
    const event = createBaseEvent();

    expect(() => bus.broadcast(event, defaultMetadata)).not.toThrow();
  });

  it("listenerCount reflects current count after subscribe and unsubscribe", () => {
    const bus = new DebugEventBus();

    expect(bus.listenerCount).toBe(0);

    const unsub1 = bus.subscribe(vi.fn());
    expect(bus.listenerCount).toBe(1);

    const unsub2 = bus.subscribe(vi.fn());
    expect(bus.listenerCount).toBe(2);

    unsub1();
    expect(bus.listenerCount).toBe(1);

    unsub2();
    expect(bus.listenerCount).toBe(0);
  });

  it("envelope has correct timestamp, agentId, threadId, runId, and the original event", () => {
    const bus = new DebugEventBus();
    const listener = vi.fn<[DebugEventEnvelope], void>();
    const event = createBaseEvent({ type: EventType.STEP_STARTED });
    const metadata = { agentId: "agent-x", threadId: "t-42", runId: "r-99" };

    const before = Date.now();
    bus.subscribe(listener);
    bus.broadcast(event, metadata);
    const after = Date.now();

    const envelope = listener.mock.calls[0][0];
    expect(envelope.agentId).toBe("agent-x");
    expect(envelope.threadId).toBe("t-42");
    expect(envelope.runId).toBe("r-99");
    expect(envelope.event).toBe(event);
    expect(envelope.timestamp).toBeGreaterThanOrEqual(before);
    expect(envelope.timestamp).toBeLessThanOrEqual(after);
  });

  it("RUN_STARTED event type passthrough: envelope.event is the original object, not a copy", () => {
    const bus = new DebugEventBus();
    const listener = vi.fn<[DebugEventEnvelope], void>();
    const event = createBaseEvent({ type: EventType.RUN_STARTED });

    bus.subscribe(listener);
    bus.broadcast(event, defaultMetadata);

    const envelope = listener.mock.calls[0][0];
    // Strict referential equality — the event is passed through, not cloned
    expect(envelope.event).toBe(event);
    expect(envelope.event.type).toBe(EventType.RUN_STARTED);
  });
});
