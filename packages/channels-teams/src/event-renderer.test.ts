import { describe, it, expect, vi } from "vitest";
import { createRunRenderer } from "./event-renderer.js";

/**
 * Stub the four callbacks the renderer drives (`post` / `update` / `typing` /
 * `recordAssistant`) and record every send in order. `post` returns a stable
 * activity id so later edits address the same message.
 */
function makeSink() {
  const posts: string[] = [];
  const updates: { id: string; text: string }[] = [];
  const recorded: string[] = [];
  const typing = vi.fn(async () => {});
  const post = vi.fn(async (text: string) => {
    posts.push(text);
    return "activity-1";
  });
  const update = vi.fn(async (id: string, text: string) => {
    updates.push({ id, text });
  });
  const recordAssistant = vi.fn((text: string) => {
    recorded.push(text);
  });
  return { posts, updates, recorded, typing, post, update, recordAssistant };
}

describe("createRunRenderer (Teams)", () => {
  it("accumulates deltas into the final streamed message and records it", async () => {
    // AG-UI delivers text one delta at a time; the renderer must accumulate
    // them itself (not forward the lagging per-event buffer) so the settled
    // Teams message reads "ECHO", not "E".
    const sink = makeSink();
    const { subscriber: sub } = createRunRenderer(sink);
    const id = "msg-1";

    await sub.onTextMessageStartEvent!({
      event: { messageId: id, role: "assistant" },
    } as never);
    sub.onTextMessageContentEvent!({
      event: { messageId: id, delta: "E" },
    } as never);
    sub.onTextMessageContentEvent!({
      event: { messageId: id, delta: "CHO" },
    } as never);
    await sub.onTextMessageEndEvent!({ event: { messageId: id } } as never);

    // Whatever the throttle split (single post, or post-then-edits), the last
    // text Teams sees is the fully-accumulated reply.
    const lastSent = sink.updates.at(-1)?.text ?? sink.posts.at(-1);
    expect(lastSent).toBe("ECHO");
    // A typing indicator fires once before the first post.
    expect(sink.typing).toHaveBeenCalledTimes(1);
    // The final text is committed to the conversation transcript.
    expect(sink.recorded).toEqual(["ECHO"]);
  });

  it("captures tool calls for the run loop to read", async () => {
    const sink = makeSink();
    const renderer = createRunRenderer(sink);

    renderer.subscriber.onToolCallEndEvent!({
      event: { toolCallId: "t1" },
      toolCallName: "show_card",
      toolCallArgs: { title: "Status" },
    } as never);

    expect(renderer.getCapturedToolCalls()).toEqual([
      {
        toolCallId: "t1",
        toolCallName: "show_card",
        toolCallArgs: { title: "Status" },
      },
    ]);
  });

  it("captures a custom interrupt event and JSON-parses its value", async () => {
    const sink = makeSink();
    const renderer = createRunRenderer(sink);

    renderer.subscriber.onCustomEvent!({
      event: { name: "on_interrupt", value: '{"confirmed":true}' },
    } as never);

    expect(renderer.getPendingInterrupt()).toEqual({
      eventName: "on_interrupt",
      value: { confirmed: true },
    });

    renderer.clearPendingInterrupt();
    expect(renderer.getPendingInterrupt()).toBeUndefined();
  });

  it("ignores custom events whose name isn't an interrupt", async () => {
    const sink = makeSink();
    const renderer = createRunRenderer(sink);

    renderer.subscriber.onCustomEvent!({
      event: { name: "telemetry", value: "{}" },
    } as never);

    expect(renderer.getPendingInterrupt()).toBeUndefined();
  });

  it("posts a visible message on a run error", async () => {
    const sink = makeSink();
    const { subscriber: sub } = createRunRenderer(sink);

    await sub.onRunErrorEvent!({ event: { message: "boom" } } as never);

    expect(sink.posts).toContain("⚠️ Agent error: boom");
  });
});
