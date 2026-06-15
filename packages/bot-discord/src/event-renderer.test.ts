import { describe, it, expect, vi } from "vitest";
import { createRunRenderer } from "./event-renderer.js";

function fakeChannel() {
  const sent: { id: string; content: string; edit: ReturnType<typeof vi.fn> }[] = [];
  let n = 0;
  return {
    sendTyping: vi.fn(async () => {}),
    send: vi.fn(async (payload: string | { content: string }) => {
      const id = `m${++n}`;
      const msg = {
        id,
        content: typeof payload === "string" ? payload : (payload.content ?? ""),
        edit: vi.fn(async (p: string | { content: string }) => {
          msg.content = typeof p === "string" ? p : (p.content ?? msg.content);
        }),
      };
      sent.push(msg);
      return msg;
    }),
    _sent: sent,
  };
}

describe("createRunRenderer", () => {
  it("fires a typing indicator on run start", async () => {
    const channel = fakeChannel();
    const r = createRunRenderer({ channel: channel as any });
    await r.subscriber.onRunStartedEvent?.({ event: {} } as any);
    expect(channel.sendTyping).toHaveBeenCalledTimes(1);
  });

  it("streams text deltas into a single edited message", async () => {
    const channel = fakeChannel();
    const r = createRunRenderer({ channel: channel as any });
    r.subscriber.onTextMessageStartEvent?.({ event: { messageId: "a" } } as any);
    r.subscriber.onTextMessageContentEvent?.({
      event: { messageId: "a", delta: "Hel" },
    } as any);
    r.subscriber.onTextMessageContentEvent?.({
      event: { messageId: "a", delta: "lo" },
    } as any);
    await r.subscriber.onTextMessageEndEvent?.({ event: { messageId: "a" } } as any);
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(channel._sent[0]!.content).toContain("Hello");
  });

  it("captures a tool call for the run loop", async () => {
    const channel = fakeChannel();
    const r = createRunRenderer({ channel: channel as any });
    await r.subscriber.onToolCallEndEvent?.({
      event: { toolCallId: "t1" },
      toolCallName: "render_card",
      toolCallArgs: { id: "x" },
    } as any);
    expect(r.getCapturedToolCalls()).toEqual([
      { toolCallId: "t1", toolCallName: "render_card", toolCallArgs: { id: "x" } },
    ]);
  });

  it("captures an on_interrupt custom event", () => {
    const channel = fakeChannel();
    const r = createRunRenderer({ channel: channel as any });
    r.subscriber.onCustomEvent?.({
      event: { name: "on_interrupt", value: { q: 1 } },
    } as any);
    expect(r.getPendingInterrupt()).toEqual({ eventName: "on_interrupt", value: { q: 1 } });
  });
});
