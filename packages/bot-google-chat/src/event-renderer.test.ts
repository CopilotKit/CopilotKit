import { describe, it, expect, vi } from "vitest";
import { createRunRenderer } from "./event-renderer.js";

function makeClient() {
  return {
    createMessage: vi.fn(async () => ({ name: "spaces/A/messages/M1" })),
    patchMessage: vi.fn(async () => {}),
    deleteMessage: vi.fn(async () => {}),
  } as any;
}

describe("createRunRenderer", () => {
  it("captures tool calls via the subscriber", async () => {
    const client = makeClient();
    const r = createRunRenderer({ client, target: { space: "spaces/A", thread: "spaces/A/threads/T" } });
    await r.subscriber.onToolCallEndEvent?.({
      event: { toolCallId: "tc1" }, toolCallName: "search", toolCallArgs: { q: "x" },
    } as any);
    expect(r.getCapturedToolCalls()).toEqual([{ toolCallId: "tc1", toolCallName: "search", toolCallArgs: { q: "x" } }]);
  });

  it("captures a custom interrupt event when its name is configured", async () => {
    const client = makeClient();
    const r = createRunRenderer({
      client, target: { space: "spaces/A" },
      interruptEventNames: new Set(["ask"]),
    });
    await r.subscriber.onCustomEvent?.({ event: { name: "ask", value: { q: "?" } } } as any);
    expect(r.getPendingInterrupt()).toEqual({ eventName: "ask", value: { q: "?" } });
    r.clearPendingInterrupt();
    expect(r.getPendingInterrupt()).toBeUndefined();
  });

  it("streams assistant text into an edit-in-place message", async () => {
    const client = makeClient();
    const r = createRunRenderer({ client, target: { space: "spaces/A", thread: "spaces/A/threads/T" } });
    await r.subscriber.onTextMessageStartEvent?.({ event: { messageId: "m1" } } as any);
    await r.subscriber.onTextMessageContentEvent?.({ event: { messageId: "m1", delta: "hello" } } as any);
    await r.subscriber.onTextMessageEndEvent?.({ event: { messageId: "m1" } } as any);
    expect(client.createMessage).toHaveBeenCalled();
  });
});
