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

  it("preserves semantic observations on the action's thread after a switch", async () => {
    let thread = "thread-a";
    const record = vi.fn().mockResolvedValue(result);
    const recorder = createProductEventRecorder({
      record,
      getThreadId: () => thread,
      onError: vi.fn(),
    });
    const interaction: ProductInteractionEvent = {
      ...event,
      type: "interaction",
      action: "click",
      target: {
        tagName: "input",
        role: "checkbox",
        accessibleName: "Receipt attached",
        state: { checked: true },
      },
      context: {
        items: [
          { kind: "heading", tagName: "h1", accessibleName: "Expense review" },
        ],
      },
    };
    recorder.onEvent(interaction);
    thread = "thread-b";
    const outcome: ProductInteractionEvent = {
      id: "outcome-1",
      actionId: event.actionId,
      timestamp: event.timestamp + 1,
      type: "dom-change",
      changes: { added: 0, removed: 0, attributes: 1 },
      target: { tagName: "button", state: { disabled: true } },
      context: {
        items: [
          {
            kind: "status",
            tagName: "output",
            accessibleName: "Ready to review",
          },
        ],
        truncated: true,
      },
    };
    recorder.onEvent(outcome);
    await settle();
    expect(record.mock.calls.map(([input]) => input.threadId)).toEqual([
      "thread-a",
      "thread-a",
    ]);
    expect(record.mock.calls.map(([input]) => input.data)).toEqual([
      { source: "copilotkit.learning", ...interaction },
      { source: "copilotkit.learning", ...outcome },
    ]);
  });

  it("restores delta context for each new thread without repeating it on every action", async () => {
    let thread = "thread-a";
    const record = vi.fn().mockResolvedValue(result);
    const recorder = createProductEventRecorder({
      record,
      getThreadId: () => thread,
      onError: vi.fn(),
    });
    const context = {
      items: [
        { kind: "heading" as const, tagName: "h1", accessibleName: "Review" },
      ],
    };
    recorder.onEvent({ ...event, context });
    await settle();
    recorder.onEvent({ ...event, id: "a2", actionId: "a2" });
    await settle();
    thread = "thread-b";
    recorder.onEvent({ ...event, id: "b1", actionId: "b1" });
    await settle();
    recorder.onEvent({ ...event, id: "b2", actionId: "b2" });
    await settle();
    expect(record.mock.calls.map(([input]) => input.data.context)).toEqual([
      context,
      undefined,
      context,
      undefined,
    ]);
    expect(record.mock.calls.map(([input]) => input.threadId)).toEqual([
      "thread-a",
      "thread-a",
      "thread-b",
      "thread-b",
    ]);
  });

  it("restores context after a failed delivery and clears it when the screen disappears", async () => {
    const record = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(result);
    const recorder = createProductEventRecorder({
      record,
      getThreadId: () => "thread-a",
      onError: vi.fn(),
    });
    const context = {
      items: [
        { kind: "heading" as const, tagName: "h1", accessibleName: "Review" },
      ],
    };
    recorder.onEvent({ ...event, context });
    await settle();
    recorder.onEvent({ ...event, id: "next", actionId: "next" });
    await settle();
    expect(record.mock.calls[1][0].data.context).toEqual(context);
    recorder.onEvent({
      id: "removed",
      actionId: "next",
      timestamp: event.timestamp + 1,
      type: "dom-change",
      changes: { added: 0, removed: 1, attributes: 0 },
      context: { items: [] },
    });
    await settle();
    recorder.onEvent({ ...event, id: "later", actionId: "later" });
    await settle();
    expect(record.mock.calls[2][0].data.context).toEqual({ items: [] });
    expect(record.mock.calls[3][0].data).not.toHaveProperty("context");
  });

  it("restores context after the ingress kill switch stops dropping annotations", async () => {
    const record = vi
      .fn()
      .mockResolvedValueOnce(result)
      .mockResolvedValueOnce({ ...result, dropped: true })
      .mockResolvedValue(result);
    const recorder = createProductEventRecorder({
      record,
      getThreadId: () => "thread-a",
      onError: vi.fn(),
    });
    recorder.onEvent({
      ...event,
      context: {
        items: [
          { kind: "status", tagName: "output", accessibleName: "Pending" },
        ],
      },
    });
    await settle();
    const context = {
      items: [
        {
          kind: "status" as const,
          tagName: "output",
          accessibleName: "Approved",
        },
      ],
    };
    recorder.onEvent({ ...event, id: "dropped", actionId: "dropped", context });
    await settle();
    recorder.onEvent({ ...event, id: "restored", actionId: "restored" });
    await settle();
    expect(record.mock.calls[2][0].data.context).toEqual(context);
  });

  it("omits a delayed screen observation after a thread switch but keeps the request outcome", async () => {
    let thread = "thread-a";
    const record = vi.fn().mockResolvedValue(result);
    const recorder = createProductEventRecorder({
      record,
      getThreadId: () => thread,
      onError: vi.fn(),
    });
    recorder.onEvent(event);
    thread = "thread-b";
    recorder.onEvent({
      id: "request",
      actionId: event.actionId,
      timestamp: event.timestamp + 1,
      type: "request",
      request: {
        method: "POST",
        url: "https://example.test/api",
        durationMs: 1,
        status: 200,
        outcome: "success",
      },
    });
    recorder.onEvent({
      id: "observation",
      actionId: event.actionId,
      timestamp: event.timestamp + 51,
      type: "context",
      trigger: "request-completed",
      requestId: "request",
      context: {
        items: [{ kind: "status", tagName: "output", accessibleName: "Saved" }],
      },
    });
    await settle();
    expect(record.mock.calls.map(([input]) => input.clientEventId)).toEqual([
      event.id,
      "request",
    ]);
    expect(record.mock.calls.map(([input]) => input.threadId)).toEqual([
      "thread-a",
      "thread-a",
    ]);
    recorder.onEvent({ ...event, id: "b", actionId: "b" });
    recorder.onEvent({
      id: "b-context",
      actionId: "b",
      timestamp: event.timestamp + 52,
      type: "context",
      trigger: "request-completed",
      requestId: "b-request",
      context: {
        items: [{ kind: "status", tagName: "output", accessibleName: "Ready" }],
      },
    });
    await settle();
    expect(record.mock.calls.at(-1)?.[0]).toMatchObject({
      threadId: "thread-b",
      title: "Screen context after request",
      data: { type: "context", requestId: "b-request" },
    });
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

describe("standalone context and response routing", () => {
  it("routes screen observations to the selected thread without inventing an action", async () => {
    let thread: string | undefined = "a";
    const record = vi.fn().mockResolvedValue(result);
    const recorder = createProductEventRecorder({
      record,
      getThreadId: () => thread,
      onError: vi.fn(),
    });
    const context: ProductInteractionEvent = {
      id: "initial",
      timestamp: event.timestamp,
      type: "context",
      trigger: "initial",
      context: {
        items: [{ kind: "heading", tagName: "h1", accessibleName: "Dispatch" }],
      },
    };
    recorder.onEvent(context);
    thread = "b";
    recorder.onEvent({ ...context, id: "navigation", trigger: "navigation" });
    thread = undefined;
    recorder.onEvent({ ...context, id: "ambiguous", trigger: "screen-change" });
    await settle();
    expect(record.mock.calls.map(([input]) => input.threadId)).toEqual([
      "a",
      "b",
    ]);
    expect(record.mock.calls[0][0].data).not.toHaveProperty("actionId");
    recorder.stop();
  });
  it("keeps late response bodies on the initiating action's thread", async () => {
    let thread = "a";
    const record = vi.fn().mockResolvedValue(result);
    const recorder = createProductEventRecorder({
      record,
      getThreadId: () => thread,
      onError: vi.fn(),
    });
    recorder.onEvent(event);
    thread = "b";
    recorder.onEvent({
      id: "body",
      actionId: event.actionId,
      timestamp: event.timestamp + 20,
      type: "response",
      requestId: "request",
      response: {
        method: "POST",
        url: "https://app.test/api/drafts",
        body: { fields: { status: "Saved" }, omittedFieldCount: 0 },
      },
    });
    await settle();
    expect(record.mock.calls.map(([input]) => input.threadId)).toEqual([
      "a",
      "a",
    ]);
    expect(record.mock.calls[1][0].data.response.body.fields).toEqual({
      status: "Saved",
    });
    recorder.stop();
  });
});
