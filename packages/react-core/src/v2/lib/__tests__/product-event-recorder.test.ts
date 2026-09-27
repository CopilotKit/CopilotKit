import { describe, expect, it, vi } from "vitest";
import type { ProductInteractionEvent } from "@copilotkit/learning";
import { createProductEventRecorder } from "../product-event-recorder";

const event: ProductInteractionEvent = {
  id: "event-1",
  actionId: "action-1",
  timestamp: 1_700_000_000_000,
  type: "interaction",
  action: "click",
  target: { tagName: "button", role: "button" },
};
const result = { id: "stored-1", duplicate: false };
const settle = async () => {
  for (let i = 0; i < 60; i++) await Promise.resolve();
};

describe("product event annotation adapter", () => {
  it("preserves event identity, correlation, timestamp and active thread", async () => {
    const record = vi.fn().mockResolvedValue(result);
    const recorder = createProductEventRecorder({
      record,
      getThreadId: () => "session-1",
      onError: vi.fn(),
    });
    recorder.onEvent(event);
    await settle();
    expect(record).toHaveBeenCalledExactlyOnceWith({
      threadId: "session-1",
      clientEventId: "event-1",
      occurredAt: "2023-11-14T22:13:20.000Z",
      title: "User click",
      data: { source: "copilotkit.learning", ...event },
    });
  });

  it("limits delivery to one in flight and fifty pending without retrying", async () => {
    let finish!: (value: typeof result) => void;
    const record = vi.fn().mockResolvedValue(result);
    record.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const onError = vi.fn();
    const recorder = createProductEventRecorder({
      record,
      getThreadId: () => "session-1",
      onError,
    });
    for (let i = 0; i < 100; i++)
      recorder.onEvent({ ...event, id: `event-${i}` });
    expect(record).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    finish(result);
    await settle();
    expect(record).toHaveBeenCalledTimes(51);
    expect(record.mock.calls.at(-1)?.[0].clientEventId).toBe("event-50");
  });

  it("reports failures and continues delivery even if the error callback throws", async () => {
    const record = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(result);
    const onError = vi.fn(() => {
      throw new Error("consumer error");
    });
    const recorder = createProductEventRecorder({
      record,
      getThreadId: () => "session-1",
      onError,
    });
    recorder.onEvent(event);
    recorder.onEvent({ ...event, id: "event-2" });
    await settle();
    expect(record).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledExactlyOnceWith(new Error("offline"));
  });

  it("discards pending work and later events when stopped", async () => {
    let finish!: (value: typeof result) => void;
    const record = vi.fn(
      () =>
        new Promise<typeof result>((resolve) => {
          finish = resolve;
        }),
    );
    const recorder = createProductEventRecorder({
      record,
      getThreadId: () => "session-1",
      onError: vi.fn(),
    });
    recorder.onEvent(event);
    recorder.onEvent({ ...event, id: "queued" });
    recorder.stop();
    finish(result);
    recorder.onEvent({ ...event, id: "after-unmount" });
    await settle();
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("contains rejected promises from asynchronous error callbacks", async () => {
    const onError = vi.fn(async () => {
      throw new Error("consumer error");
    });
    const recorder = createProductEventRecorder({
      record: vi.fn().mockRejectedValue(new Error("offline")),
      getThreadId: () => "session-1",
      onError,
    });
    recorder.onEvent(event);
    await settle();
    expect(onError).toHaveBeenCalledExactlyOnceWith(new Error("offline"));
  });

  it("keeps queued actions on their original threads across switches", async () => {
    let thread = "thread-a";
    let finish!: (value: typeof result) => void;
    const record = vi.fn().mockResolvedValue(result);
    record.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const recorder = createProductEventRecorder({
      record,
      getThreadId: () => thread,
      onError: vi.fn(),
    });
    recorder.onEvent(event);
    thread = "thread-b";
    recorder.onEvent({ ...event, id: "b", actionId: "b" });
    thread = "thread-c";
    finish(result);
    await settle();
    expect(record.mock.calls.map(([input]) => input.threadId)).toEqual([
      "thread-a",
      "thread-b",
    ]);
  });

  it("omits unbound and evicted outcomes instead of assigning the current thread", async () => {
    const record = vi.fn().mockResolvedValue(result);
    const recorder = createProductEventRecorder({
      record,
      getThreadId: () => "thread-b",
      onError: vi.fn(),
    });
    const outcome: ProductInteractionEvent = {
      id: "late",
      actionId: "action-0",
      timestamp: event.timestamp + 1,
      type: "dom-change",
      changes: { added: 1, removed: 0, attributes: 0 },
    };
    recorder.onEvent(outcome);
    expect(record).not.toHaveBeenCalled();
    for (let i = 0; i <= 256; i++) {
      recorder.onEvent({
        ...event,
        id: `action-${i}`,
        actionId: `action-${i}`,
      });
      await settle();
    }
    recorder.onEvent(outcome);
    await settle();
    expect(record).toHaveBeenCalledTimes(257);
  });
});
