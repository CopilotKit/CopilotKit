import { describe, it, expect, vi } from "vitest";
import type { SlackRenderTransport } from "../render/transport.js";
import { createRunRenderer } from "../event-renderer.js";

/**
 * Fake {@link SlackRenderTransport} — records every post / update call in
 * order. This is exactly the seam the managed Connector Outbox will drive, so
 * the renderer is verified Bolt-free (no `WebClient`).
 */
function makeFakeClient() {
  const posts: {
    channel: string;
    thread_ts?: string;
    text: string;
    ts: string;
  }[] = [];
  const updates: { channel: string; ts: string; text: string }[] = [];
  let postedTsCounter = 0;
  const transport: SlackRenderTransport = {
    setStatus: vi.fn(async () => {}),
    postMessage: vi.fn(
      async (args: { channel: string; thread_ts?: string; text: string }) => {
        postedTsCounter++;
        const ts = `${postedTsCounter}.000`;
        posts.push({ ...args, ts });
        return { ts };
      },
    ),
    updateMessage: vi.fn(
      async (args: { channel: string; ts: string; text: string }) => {
        updates.push(args);
      },
    ),
  };
  return { transport, posts, updates };
}

describe("createRunRenderer", () => {
  it("accumulates deltas into the final Slack message (the ECHO regression)", async () => {
    // Reproduces the live bug: AG-UI's `textMessageBuffer` is the buffer
    // *before* the current delta — it lags by one — so a renderer that
    // forwards `textMessageBuffer` straight through ends up posting "E"
    // instead of "ECHO". The renderer must accumulate deltas on its own.
    const fake = makeFakeClient();
    const { subscriber: sub } = createRunRenderer({
      transport: fake.transport,
      target: { channel: "C1", threadTs: "100.0" },
    });
    const id = "msg-1";

    await sub.onTextMessageStartEvent!({
      event: { messageId: id, role: "assistant" },
    } as never);
    sub.onTextMessageContentEvent!({
      event: { messageId: id, delta: "E" },
      textMessageBuffer: "",
    } as never);
    sub.onTextMessageContentEvent!({
      event: { messageId: id, delta: "CHO" },
      textMessageBuffer: "E",
    } as never);
    await sub.onTextMessageEndEvent!({ event: { messageId: id } } as never);

    // (a) Text streaming posts a placeholder then updates it; the LAST
    // update must be the fully-accumulated text.
    expect(fake.posts).toHaveLength(1);
    expect(fake.posts[0]?.text).toBe("_thinking…_");
    expect(fake.updates.length).toBeGreaterThan(0);
    expect(fake.updates.at(-1)?.text).toBe("ECHO");
  });

  it("posts placeholder with thread_ts for thread replies, none for DMs (only on first content)", async () => {
    const fake = makeFakeClient();
    const { subscriber: dm } = createRunRenderer({
      transport: fake.transport,
      target: { channel: "D1" },
    });
    await dm.onTextMessageStartEvent!({
      event: { messageId: "m1", role: "assistant" },
    } as never);
    // No content yet → no Slack post (per the D20 fix).
    expect(fake.posts).toHaveLength(0);
    // First content event triggers the placeholder.
    dm.onTextMessageContentEvent!({
      event: { messageId: "m1", delta: "hi" },
      textMessageBuffer: "",
    } as never);
    await dm.onTextMessageEndEvent!({ event: { messageId: "m1" } } as never);
    expect(fake.posts[0]?.thread_ts).toBeUndefined();

    const { subscriber: thread } = createRunRenderer({
      transport: fake.transport,
      target: { channel: "C1", threadTs: "100.0" },
    });
    await thread.onTextMessageStartEvent!({
      event: { messageId: "m2", role: "assistant" },
    } as never);
    thread.onTextMessageContentEvent!({
      event: { messageId: "m2", delta: "hi" },
      textMessageBuffer: "",
    } as never);
    await thread.onTextMessageEndEvent!({
      event: { messageId: "m2" },
    } as never);
    expect(fake.posts[1]?.thread_ts).toBe("100.0");
  });

  it("D20: a TEXT_MESSAGE_START + END with NO content events produces no Slack message", async () => {
    const fake = makeFakeClient();
    const { subscriber: sub } = createRunRenderer({
      transport: fake.transport,
      target: { channel: "C1", threadTs: "100.0" },
    });
    await sub.onTextMessageStartEvent!({
      event: { messageId: "m1", role: "assistant" },
    } as never);
    await sub.onTextMessageEndEvent!({ event: { messageId: "m1" } } as never);
    expect(fake.posts).toHaveLength(0);
    expect(fake.updates).toHaveLength(0);
  });

  it("captures EVERY tool-call-end (getCapturedToolCalls returns it)", async () => {
    const fake = makeFakeClient();
    const { subscriber: sub, getCapturedToolCalls } = createRunRenderer({
      transport: fake.transport,
      target: { channel: "C1", threadTs: "100.0" },
      showToolStatus: false,
    });
    await sub.onToolCallStartEvent!({
      event: { toolCallId: "tc1", toolCallName: "search_flights" },
    } as never);
    await sub.onToolCallEndEvent!({
      event: { toolCallId: "tc1" },
      toolCallName: "search_flights",
      toolCallArgs: { from: "SFO", to: "JFK" },
    } as never);

    const captured = getCapturedToolCalls();
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual({
      toolCallId: "tc1",
      toolCallName: "search_flights",
      toolCallArgs: { from: "SFO", to: "JFK" },
    });
  });

  it("captures partial args from onToolCallArgsEvent, finalised at END", async () => {
    const fake = makeFakeClient();
    const { subscriber: sub, getCapturedToolCalls } = createRunRenderer({
      transport: fake.transport,
      target: { channel: "C1", threadTs: "100.0" },
      showToolStatus: false,
    });
    sub.onToolCallArgsEvent!({
      event: { toolCallId: "tc1" },
      toolCallName: "manage_todos",
      partialToolCallArgs: { title: "partial" },
    } as never);
    await sub.onToolCallEndEvent!({
      event: { toolCallId: "tc1" },
      toolCallName: "manage_todos",
      toolCallArgs: { title: "final" },
    } as never);

    const captured = getCapturedToolCalls();
    expect(captured).toHaveLength(1);
    expect(captured[0]?.toolCallArgs).toEqual({ title: "final" });
  });

  it("tool-call status: showToolStatus default (true) → START posts 🔧, END edits to ✅", async () => {
    const fake = makeFakeClient();
    const { subscriber: sub } = createRunRenderer({
      transport: fake.transport,
      target: { channel: "C1", threadTs: "100.0" },
    });
    await sub.onToolCallStartEvent!({
      event: { toolCallId: "tc1", toolCallName: "search_flights" },
    } as never);
    expect(fake.posts).toHaveLength(1);
    expect(fake.posts[0]?.text).toContain(":wrench:");

    await sub.onToolCallEndEvent!({
      event: { toolCallId: "tc1" },
      toolCallName: "search_flights",
      toolCallArgs: {},
    } as never);
    expect(fake.updates).toHaveLength(1);
    expect(fake.updates[0]?.text).toContain(":white_check_mark:");
  });

  it("tool-call status: showToolStatus:false → no status posts but still captures", async () => {
    const fake = makeFakeClient();
    const { subscriber: sub, getCapturedToolCalls } = createRunRenderer({
      transport: fake.transport,
      target: { channel: "C1", threadTs: "100.0" },
      showToolStatus: false,
    });
    await sub.onToolCallStartEvent!({
      event: { toolCallId: "tc1", toolCallName: "search_flights" },
    } as never);
    await sub.onToolCallEndEvent!({
      event: { toolCallId: "tc1" },
      toolCallName: "search_flights",
      toolCallArgs: {},
    } as never);
    expect(fake.posts).toHaveLength(0);
    expect(fake.updates).toHaveLength(0);
    expect(getCapturedToolCalls()).toHaveLength(1);
  });

  it("tool-call status: dedup by toolCallId — a repeated START (e.g. on graph resume) does not double-post", async () => {
    const fake = makeFakeClient();
    const { subscriber: sub } = createRunRenderer({
      transport: fake.transport,
      target: { channel: "C1", threadTs: "100.0" },
      showToolStatus: true,
    });
    await sub.onToolCallStartEvent!({
      event: { toolCallId: "tc1", toolCallName: "schedule_meeting" },
    } as never);
    await sub.onToolCallStartEvent!({
      event: { toolCallId: "tc1", toolCallName: "schedule_meeting" },
    } as never);
    expect(fake.posts).toHaveLength(1);
  });

  it("interrupt: an on_interrupt custom event sets getPendingInterrupt", async () => {
    const fake = makeFakeClient();
    const {
      subscriber: sub,
      getPendingInterrupt,
      clearPendingInterrupt,
    } = createRunRenderer({
      transport: fake.transport,
      target: { channel: "C1", threadTs: "100.0" },
    });
    sub.onCustomEvent!({
      event: { name: "on_interrupt", value: { question: "Confirm?" } },
    } as never);
    const pending = getPendingInterrupt();
    expect(pending).toBeDefined();
    expect(pending?.eventName).toBe("on_interrupt");
    expect(pending?.value).toEqual({ question: "Confirm?" });

    clearPendingInterrupt();
    expect(getPendingInterrupt()).toBeUndefined();
  });

  it("interrupt: a JSON-string value is parsed", async () => {
    const fake = makeFakeClient();
    const { subscriber: sub, getPendingInterrupt } = createRunRenderer({
      transport: fake.transport,
      target: { channel: "C1", threadTs: "100.0" },
    });
    sub.onCustomEvent!({
      event: { name: "on_interrupt", value: JSON.stringify({ ok: true }) },
    } as never);
    expect(getPendingInterrupt()?.value).toEqual({ ok: true });
  });

  it("interrupt: a non-matching custom event is ignored", async () => {
    const fake = makeFakeClient();
    const { subscriber: sub, getPendingInterrupt } = createRunRenderer({
      transport: fake.transport,
      target: { channel: "C1", threadTs: "100.0" },
    });
    sub.onCustomEvent!({
      event: { name: "some_other_event", value: { x: 1 } },
    } as never);
    expect(getPendingInterrupt()).toBeUndefined();
  });

  it("mrkdwn: bold/italic/links/lists get translated before chat.update", async () => {
    const fake = makeFakeClient();
    const { subscriber: sub } = createRunRenderer({
      transport: fake.transport,
      target: { channel: "C1", threadTs: "100.0" },
    });
    await sub.onTextMessageStartEvent!({
      event: { messageId: "m1", role: "assistant" },
    } as never);
    sub.onTextMessageContentEvent!({
      event: {
        messageId: "m1",
        delta: "**hi** [docs](https://x.com)\n- a\n- b",
      },
      textMessageBuffer: "",
    } as never);
    await sub.onTextMessageEndEvent!({ event: { messageId: "m1" } } as never);
    const last = fake.updates.at(-1)?.text ?? "";
    expect(last).toContain("*hi*");
    expect(last).toContain("<https://x.com|docs>");
    expect(last).toContain("•  a");
  });

  it("posts a warning when RUN_ERROR fires", async () => {
    const fake = makeFakeClient();
    const { subscriber: sub } = createRunRenderer({
      transport: fake.transport,
      target: { channel: "C1", threadTs: "100.0" },
    });
    await sub.onRunErrorEvent!({ event: { message: "boom" } } as never);
    expect(fake.posts).toHaveLength(1);
    expect(fake.posts[0]?.text).toContain("boom");
    expect(fake.posts[0]?.thread_ts).toBe("100.0");
  });

  it("markInterrupted: appends _(interrupted)_ to a partial reply and finalises", async () => {
    const fake = makeFakeClient();
    const { subscriber, markInterrupted } = createRunRenderer({
      transport: fake.transport,
      target: { channel: "C1", threadTs: "100.0" },
    });
    await subscriber.onTextMessageStartEvent!({
      event: { messageId: "m1", role: "assistant" },
    } as never);
    subscriber.onTextMessageContentEvent!({
      event: { messageId: "m1", delta: "Once upon a time" },
      textMessageBuffer: "",
    } as never);
    await markInterrupted();
    const last = fake.updates.at(-1)?.text ?? "";
    expect(last).toContain("Once upon a time");
    expect(last).toContain("_(interrupted)_");
  });

  it("markInterrupted: no partial reply yet → no Slack post created", async () => {
    const fake = makeFakeClient();
    const { subscriber, markInterrupted } = createRunRenderer({
      transport: fake.transport,
      target: { channel: "C1", threadTs: "100.0" },
    });
    await subscriber.onTextMessageStartEvent!({
      event: { messageId: "m1", role: "assistant" },
    } as never);
    // No content events arrived yet — interrupted IMMEDIATELY.
    await markInterrupted();
    expect(fake.posts).toHaveLength(0);
    expect(fake.updates).toHaveLength(0);
  });

  it("markInterrupted: a RUN_ERROR event that arrives AFTER abort is suppressed", async () => {
    const fake = makeFakeClient();
    const { subscriber, markInterrupted } = createRunRenderer({
      transport: fake.transport,
      target: { channel: "C1", threadTs: "100.0" },
    });
    await subscriber.onTextMessageStartEvent!({
      event: { messageId: "m1", role: "assistant" },
    } as never);
    subscriber.onTextMessageContentEvent!({
      event: { messageId: "m1", delta: "partial" },
      textMessageBuffer: "",
    } as never);
    await markInterrupted();
    // Now AG-UI fires the late RUN_ERROR.
    await subscriber.onRunErrorEvent!({
      event: { message: "aborted" },
    } as never);
    const warnings = fake.posts.filter((p) => p.text.includes(":warning:"));
    expect(warnings).toHaveLength(0);
  });

  it("markInterrupted: ignores late content events after the interrupt", async () => {
    const fake = makeFakeClient();
    const { subscriber, markInterrupted } = createRunRenderer({
      transport: fake.transport,
      target: { channel: "C1", threadTs: "100.0" },
    });
    await subscriber.onTextMessageStartEvent!({
      event: { messageId: "m1", role: "assistant" },
    } as never);
    subscriber.onTextMessageContentEvent!({
      event: { messageId: "m1", delta: "partial" },
      textMessageBuffer: "",
    } as never);
    await markInterrupted();
    const postsBefore = fake.posts.length;
    // Late event after interrupt — should be ignored.
    subscriber.onTextMessageContentEvent!({
      event: { messageId: "m1", delta: " more text" },
      textMessageBuffer: "partial",
    } as never);
    expect(fake.posts.length).toBe(postsBefore);
  });

  it("does not bleed buffers between messages with different ids", async () => {
    const fake = makeFakeClient();
    const { subscriber: sub } = createRunRenderer({
      transport: fake.transport,
      target: { channel: "C1", threadTs: "100.0" },
    });
    await sub.onTextMessageStartEvent!({
      event: { messageId: "a", role: "assistant" },
    } as never);
    await sub.onTextMessageStartEvent!({
      event: { messageId: "b", role: "assistant" },
    } as never);
    sub.onTextMessageContentEvent!({
      event: { messageId: "a", delta: "AAA" },
      textMessageBuffer: "",
    } as never);
    sub.onTextMessageContentEvent!({
      event: { messageId: "b", delta: "BBB" },
      textMessageBuffer: "",
    } as never);
    await sub.onTextMessageEndEvent!({ event: { messageId: "a" } } as never);
    await sub.onTextMessageEndEvent!({ event: { messageId: "b" } } as never);

    const lastUpdateForFirstTs = fake.updates
      .filter((u) => u.ts === "1.000")
      .at(-1);
    const lastUpdateForSecondTs = fake.updates
      .filter((u) => u.ts === "2.000")
      .at(-1);
    expect(lastUpdateForFirstTs?.text).toBe("AAA");
    expect(lastUpdateForSecondTs?.text).toBe("BBB");
  });
});

describe("createRunRenderer — native status mode", () => {
  function makePaneClient() {
    const statuses: {
      status: string;
      loading_messages?: string[];
      thread_ts?: string;
    }[] = [];
    const posts: { text: string; ts: string }[] = [];
    const updates: { ts: string; text: string }[] = [];
    let counter = 0;
    const transport: SlackRenderTransport = {
      setStatus: vi.fn(
        async (args: {
          status: string;
          loading_messages?: string[];
          thread_ts: string;
        }) => {
          statuses.push({
            status: args.status,
            loading_messages: args.loading_messages,
            thread_ts: args.thread_ts,
          });
        },
      ),
      postMessage: vi.fn(async (args: { text: string }) => {
        counter++;
        const ts = `${counter}.000`;
        posts.push({ text: args.text, ts });
        return { ts };
      }),
      updateMessage: vi.fn(async (args: { ts: string; text: string }) => {
        updates.push(args);
      }),
    };
    return { transport, statuses, posts };
  }

  it("sets native status on run start instead of posting a placeholder", async () => {
    const f = makePaneClient();
    const { subscriber: sub } = createRunRenderer({
      transport: f.transport,
      target: { channel: "D1", threadTs: "100.0" },
      status: {
        threadTs: "100.0",
        isPane: true,
        config: { thinking: "is pondering…", loadingMessages: ["a"] },
      },
    });
    await sub.onRunStartedEvent!({} as never);
    expect(f.posts).toHaveLength(0);
    expect(f.statuses[0]).toEqual({
      status: "is pondering…",
      loading_messages: ["a"],
      thread_ts: "100.0",
    });
  });

  it("surfaces tool calls as live status, not :wrench: rows", async () => {
    const f = makePaneClient();
    const { subscriber: sub } = createRunRenderer({
      transport: f.transport,
      target: { channel: "D1", threadTs: "100.0" },
      status: { threadTs: "100.0", isPane: true, config: {} },
    });
    await sub.onToolCallStartEvent!({
      event: { toolCallId: "t1", toolCallName: "search" },
    } as never);
    expect(f.posts).toHaveLength(0);
    expect(f.statuses.at(-1)?.status).toBe("is using `search`…");
  });

  it("showToolStatus:false suppresses the pane's `is using` status", async () => {
    const f = makePaneClient();
    const { subscriber: sub } = createRunRenderer({
      transport: f.transport,
      target: { channel: "D1", threadTs: "100.0" },
      status: { threadTs: "100.0", isPane: true, config: {} },
      showToolStatus: false,
    });
    await sub.onToolCallStartEvent!({
      event: { toolCallId: "t1", toolCallName: "search" },
    } as never);
    expect(f.posts).toHaveLength(0);
    expect(f.statuses.some((s) => s.status.includes("is using"))).toBe(false);
  });

  it("clears the status once a reply is posted", async () => {
    const f = makePaneClient();
    const { subscriber: sub } = createRunRenderer({
      transport: f.transport,
      target: { channel: "D1", threadTs: "100.0" },
      status: { threadTs: "100.0", isPane: true, config: {} },
    });
    await sub.onRunStartedEvent!({} as never);
    await sub.onTextMessageStartEvent!({
      event: { messageId: "m", role: "assistant" },
    } as never);
    sub.onTextMessageContentEvent!({
      event: { messageId: "m", delta: "hi" },
      textMessageBuffer: "",
    } as never);
    await sub.onTextMessageEndEvent!({ event: { messageId: "m" } } as never);
    expect(f.statuses.some((s) => s.status === "")).toBe(true);
  });

  it("clears the status on run finish when nothing was posted", async () => {
    const f = makePaneClient();
    const { subscriber: sub } = createRunRenderer({
      transport: f.transport,
      target: { channel: "D1", threadTs: "100.0" },
      status: { threadTs: "100.0", isPane: true, config: { thinking: "t" } },
    });
    await sub.onRunStartedEvent!({} as never);
    await sub.onRunFinishedEvent!({} as never);
    expect(f.statuses.at(-1)?.status).toBe("");
  });

  it("finish(): clears the status for a tool-only reply that streamed no text", async () => {
    // Regression: a turn whose reply is tool/file-only (e.g. a posted chart)
    // never streams text, so `onFirstReply` never fires and the native "is
    // thinking…" status would otherwise linger forever. `finish()` must clear
    // it as a backstop.
    const f = makePaneClient();
    const renderer = createRunRenderer({
      transport: f.transport,
      target: { channel: "C1", threadTs: "100.0" },
      status: { threadTs: "100.0", isPane: false, config: { thinking: "t" } },
    });
    const sub = renderer.subscriber;
    await sub.onRunStartedEvent!({} as never);
    // A tool runs to completion but NO TEXT_MESSAGE_* events are ever emitted.
    await sub.onToolCallStartEvent!({
      event: { toolCallId: "t1", toolCallName: "make_chart" },
    } as never);
    await sub.onToolCallEndEvent!({
      event: { toolCallId: "t1" },
      toolCallName: "make_chart",
      toolCallArgs: {},
    } as never);
    // Engine's turn-end hook.
    await renderer.finish!();
    // The last setStatus must be the clear (empty string).
    expect(f.statuses.at(-1)?.status).toBe("");
    expect(f.statuses.some((s) => s.status === "")).toBe(true);
  });

  it("finish(): does not re-clear once a streamed reply already cleared (postedReply guard)", async () => {
    const f = makePaneClient();
    const renderer = createRunRenderer({
      transport: f.transport,
      target: { channel: "C1", threadTs: "100.0" },
      status: { threadTs: "100.0", isPane: false, config: {} },
    });
    const sub = renderer.subscriber;
    await sub.onRunStartedEvent!({} as never);
    await sub.onTextMessageStartEvent!({
      event: { messageId: "m", role: "assistant" },
    } as never);
    sub.onTextMessageContentEvent!({
      event: { messageId: "m", delta: "hi" },
      textMessageBuffer: "",
    } as never);
    await sub.onTextMessageEndEvent!({ event: { messageId: "m" } } as never);
    // Posting the reply already cleared the status exactly once (onFirstReply).
    const clearsAfterReply = f.statuses.filter((s) => s.status === "").length;
    expect(clearsAfterReply).toBe(1);
    // finish() must NOT clear again — `postedReply` guards the backstop.
    await renderer.finish!();
    const clearsAfterFinish = f.statuses.filter((s) => s.status === "").length;
    expect(clearsAfterFinish).toBe(clearsAfterReply);
  });

  // ── Non-pane: a channel @-mention / thread (isPane:false) gets the native
  // "is thinking…" status instead of the old :hourglass: placeholder, and tool
  // progress flows to both :wrench: rows and the composer "is using…" status
  // (setStatus drives any thread anchor now, not just panes). ──────────────────
  it("non-pane thread: sets native status on run start (no :hourglass: placeholder)", async () => {
    const f = makePaneClient();
    const { subscriber: sub } = createRunRenderer({
      transport: f.transport,
      target: { channel: "C1", threadTs: "100.0" },
      status: { threadTs: "100.0", isPane: false, config: {} },
    });
    await sub.onRunStartedEvent!({} as never);
    expect(f.posts).toHaveLength(0);
    expect(f.statuses[0]?.status).toBe("is thinking…");
  });

  it("non-pane thread: tool calls post :wrench: rows and set composer status", async () => {
    const f = makePaneClient();
    const { subscriber: sub } = createRunRenderer({
      transport: f.transport,
      target: { channel: "C1", threadTs: "100.0" },
      status: { threadTs: "100.0", isPane: false, config: {} },
    });
    await sub.onToolCallStartEvent!({
      event: { toolCallId: "t1", toolCallName: "search" },
    } as never);
    expect(f.posts.at(-1)?.text).toContain(":wrench:");
    expect(f.statuses.some((s) => s.status.includes("is using"))).toBe(true);
  });

  it("uses the provided threadTs anchor (e.g. a DM's inbound ts) for setStatus", async () => {
    const f = makePaneClient();
    const { subscriber: sub } = createRunRenderer({
      transport: f.transport,
      // Flat DM: the channel target has no threadTs, but the adapter passes the
      // inbound message ts as the status anchor.
      target: { channel: "D1" },
      status: { threadTs: "999.000", isPane: false, config: {} },
    });
    await sub.onRunStartedEvent!({} as never);
    expect(f.statuses[0]?.status).toBe("is thinking…");
    expect(f.statuses[0]?.thread_ts).toBe("999.000");
  });
});
