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
    const r = createRunRenderer({
      client,
      target: { space: "spaces/A", thread: "spaces/A/threads/T" },
    });
    await r.subscriber.onToolCallEndEvent?.({
      event: { toolCallId: "tc1" },
      toolCallName: "search",
      toolCallArgs: { q: "x" },
    } as any);
    expect(r.getCapturedToolCalls()).toEqual([
      { toolCallId: "tc1", toolCallName: "search", toolCallArgs: { q: "x" } },
    ]);
  });

  it("captures a custom interrupt event when its name is configured", async () => {
    const client = makeClient();
    const r = createRunRenderer({
      client,
      target: { space: "spaces/A" },
      interruptEventNames: new Set(["ask"]),
    });
    await r.subscriber.onCustomEvent?.({
      event: { name: "ask", value: { q: "?" } },
    } as any);
    expect(r.getPendingInterrupt()).toEqual({
      eventName: "ask",
      value: { q: "?" },
    });
    r.clearPendingInterrupt();
    expect(r.getPendingInterrupt()).toBeUndefined();
  });

  it("streams assistant text into an edit-in-place message", async () => {
    const client = makeClient();
    const r = createRunRenderer({
      client,
      target: { space: "spaces/A", thread: "spaces/A/threads/T" },
    });
    await r.subscriber.onTextMessageStartEvent?.({
      event: { messageId: "m1" },
    } as any);
    await r.subscriber.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: "hello" },
    } as any);
    await r.subscriber.onTextMessageEndEvent?.({
      event: { messageId: "m1" },
    } as any);
    expect(client.createMessage).toHaveBeenCalled();
  });

  it("markInterrupted finishes a started-but-unended stream (resolves its placeholder)", async () => {
    const client = makeClient();
    const r = createRunRenderer({
      client,
      target: { space: "spaces/A", thread: "spaces/A/threads/T" },
    });
    // A stream that posted its `_thinking…_` placeholder via a content event
    // but never received TEXT_MESSAGE_END.
    await r.subscriber.onTextMessageStartEvent?.({
      event: { messageId: "m1" },
    } as any);
    await r.subscriber.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: "hi" },
    } as any);
    expect(client.createMessage).toHaveBeenCalled();

    await r.markInterrupted();

    // The placeholder must be resolved with the interrupted suffix appended,
    // not left dangling as `_thinking…_`.
    expect(client.patchMessage).toHaveBeenCalled();
    const patched = client.patchMessage.mock.calls
      .map((c: any[]) => c[1]?.text ?? "")
      .join("\n");
    expect(patched).toContain("interrupted");
  });

  it("markInterrupted does NOT post a message for an empty-buffer stream", async () => {
    const client = makeClient();
    const r = createRunRenderer({
      client,
      target: { space: "spaces/A", thread: "spaces/A/threads/T" },
    });
    // A stream that received START but no content — its buffer is empty, so
    // `ChunkedMessageStream` never posted a `_thinking…_` placeholder.
    await r.subscriber.onTextMessageStartEvent?.({
      event: { messageId: "m1" },
    } as any);
    expect(client.createMessage).not.toHaveBeenCalled();

    await r.markInterrupted();

    // No spurious post: appending the interrupted suffix to an empty buffer
    // would have triggered a placeholder + `_(interrupted)_` update.
    expect(client.createMessage).not.toHaveBeenCalled();
    expect(client.patchMessage).not.toHaveBeenCalled();
  });

  it("markInterrupted resolves a whitespace-only stream's placeholder (no dangle)", async () => {
    const client = makeClient();
    const r = createRunRenderer({
      client,
      target: { space: "spaces/A", thread: "spaces/A/threads/T" },
    });
    // A stream whose only content is whitespace. The dispatch posts a
    // `_thinking…_` placeholder for any buffer of length>0 (incl. whitespace),
    // so this MUST be resolved on interrupt — a trim()-based guard would skip
    // it and leave the placeholder dangling.
    await r.subscriber.onTextMessageStartEvent?.({
      event: { messageId: "m1" },
    } as any);
    await r.subscriber.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: "\n" },
    } as any);
    expect(client.createMessage).toHaveBeenCalled();

    await r.markInterrupted();

    // The whitespace-only placeholder must be resolved (a finish/patch happened
    // with the interrupted suffix), not left as a dangling `_thinking…_`.
    expect(client.patchMessage).toHaveBeenCalled();
    const patched = client.patchMessage.mock.calls
      .map((c: any[]) => c[1]?.text ?? "")
      .join("\n");
    expect(patched).toContain("interrupted");
  });

  it("patches a tool-status row to terminal when interrupted DURING the in-flight tool-start", async () => {
    const client = makeClient();
    const r = createRunRenderer({
      client,
      target: { space: "spaces/A", thread: "spaces/A/threads/T" },
    });

    // Make the tool-start createMessage hang until we resolve it, so we can
    // interrupt WHILE it is in flight (the sweep in markInterrupted runs before
    // the .set, the race this fix closes).
    let resolveCreate!: (v: { name: string }) => void;
    client.createMessage.mockImplementationOnce(
      () =>
        new Promise<{ name: string }>((res) => {
          resolveCreate = res;
        }),
    );

    const startPromise = r.subscriber.onToolCallStartEvent?.({
      event: { toolCallId: "tc1", toolCallName: "search" },
    } as any);

    // Interrupt while createMessage is still pending — its sweep of
    // toolStatusName runs now and cannot see tc1 (not registered yet).
    await r.markInterrupted();

    // Now the in-flight createMessage resolves; the re-check must patch the
    // just-created row to the terminal marker rather than registering it.
    resolveCreate({ name: "spaces/A/messages/TOOL1" });
    await startPromise;

    const patchedTexts = client.patchMessage.mock.calls.map(
      (c: any[]) => c[1]?.text ?? "",
    );
    expect(
      patchedTexts.some((t: string) => t.includes("⏹") && t.includes("search")),
    ).toBe(true);
    // The patch targeted the just-created tool row, not left dangling as `🔧`.
    expect(
      client.patchMessage.mock.calls.some(
        (c: any[]) => c[0] === "spaces/A/messages/TOOL1",
      ),
    ).toBe(true);
  });

  it("markInterrupted patches a dangling tool-status row to a terminal marker", async () => {
    const client = makeClient();
    const r = createRunRenderer({
      client,
      target: { space: "spaces/A", thread: "spaces/A/threads/T" },
    });
    // A tool-status row whose START posted (`🔧 …`) but whose END never arrived.
    await r.subscriber.onToolCallStartEvent?.({
      event: { toolCallId: "tc1", toolCallName: "search" },
    } as any);
    expect(client.createMessage).toHaveBeenCalled();
    const startText =
      (client.createMessage.mock.calls[0] as any[])[1]?.text ?? "";
    expect(startText).toContain("🔧");

    await r.markInterrupted();

    // The dangling row must be flipped to a terminal marker via patchMessage.
    expect(client.patchMessage).toHaveBeenCalled();
    const patchedTexts = client.patchMessage.mock.calls.map(
      (c: any[]) => c[1]?.text ?? "",
    );
    expect(
      patchedTexts.some((t: string) => t.includes("⏹") && t.includes("search")),
    ).toBe(true);
  });
});
