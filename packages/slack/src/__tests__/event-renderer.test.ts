import { describe, it, expect, vi } from "vitest";
import { createSlackEventRenderer } from "../event-renderer.js";

/**
 * Stub WebClient surface — only the methods the renderer touches.
 * Records every chat.postMessage / chat.update call in order.
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
  const client = {
    chat: {
      postMessage: vi.fn(
        async (args: { channel: string; thread_ts?: string; text: string }) => {
          postedTsCounter++;
          const ts = `${postedTsCounter}.000`;
          posts.push({ ...args, ts });
          return { ok: true, ts };
        },
      ),
      update: vi.fn(
        async (args: { channel: string; ts: string; text: string }) => {
          updates.push(args);
          return { ok: true };
        },
      ),
    },
  };
  return { client, posts, updates };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("createSlackEventRenderer", () => {
  it("accumulates deltas into the final Slack message (the ECHO regression)", async () => {
    // Reproduces the live bug: AG-UI's `textMessageBuffer` is the buffer
    // *before* the current delta — it lags by one — so a renderer that
    // forwards `textMessageBuffer` straight through ends up posting "E"
    // instead of "ECHO". The renderer must accumulate deltas on its own.
    const fake = makeFakeClient();
    const { subscriber: sub } = createSlackEventRenderer({
      client: fake.client as never,
      target: { channel: "C1", threadTs: "100.0" },
    });
    const id = "msg-1";

    await sub.onTextMessageStartEvent!({
      event: { messageId: id, role: "assistant" },
    } as never);
    // Note: textMessageBuffer here is "buffer before delta", as AG-UI does
    sub.onTextMessageContentEvent!({
      event: { messageId: id, delta: "E" },
      textMessageBuffer: "",
    } as never);
    sub.onTextMessageContentEvent!({
      event: { messageId: id, delta: "CHO" },
      textMessageBuffer: "E",
    } as never);
    await sub.onTextMessageEndEvent!({ event: { messageId: id } } as never);

    // Some intermediate updates may exist; the LAST update must be the
    // fully-accumulated text.
    expect(fake.posts).toHaveLength(1);
    expect(fake.posts[0]?.text).toBe("_thinking…_");
    expect(fake.updates.length).toBeGreaterThan(0);
    expect(fake.updates.at(-1)?.text).toBe("ECHO");
  });

  it("posts placeholder with thread_ts for thread replies, none for DMs (only on first content)", async () => {
    const fake = makeFakeClient();
    const { subscriber: dm } = createSlackEventRenderer({
      client: fake.client as never,
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

    const { subscriber: thread } = createSlackEventRenderer({
      client: fake.client as never,
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
    const { subscriber: sub } = createSlackEventRenderer({
      client: fake.client as never,
      target: { channel: "C1", threadTs: "100.0" },
    });
    await sub.onTextMessageStartEvent!({
      event: { messageId: "m1", role: "assistant" },
    } as never);
    await sub.onTextMessageEndEvent!({ event: { messageId: "m1" } } as never);
    expect(fake.posts).toHaveLength(0);
    expect(fake.updates).toHaveLength(0);
  });

  it("tool-call status: default is silent — no :wrench:/:white_check_mark: posts", async () => {
    const fake = makeFakeClient();
    const { subscriber: sub } = createSlackEventRenderer({
      client: fake.client as never,
      target: { channel: "C1", threadTs: "100.0" },
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
  });

  it("tool-call status: opt in with showToolStatus:true → START posts 🔧, END edits to ✅", async () => {
    const fake = makeFakeClient();
    const { subscriber: sub } = createSlackEventRenderer({
      client: fake.client as never,
      target: { channel: "C1", threadTs: "100.0" },
      showToolStatus: true,
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

  it("tool-call status: showToolStatus:['x'] → only the named tool surfaces", async () => {
    const fake = makeFakeClient();
    const { subscriber: sub } = createSlackEventRenderer({
      client: fake.client as never,
      target: { channel: "C1", threadTs: "100.0" },
      showToolStatus: ["search_flights"],
    });
    await sub.onToolCallStartEvent!({
      event: { toolCallId: "tc1", toolCallName: "manage_todos" },
    } as never);
    expect(fake.posts).toHaveLength(0);
    await sub.onToolCallStartEvent!({
      event: { toolCallId: "tc2", toolCallName: "search_flights" },
    } as never);
    expect(fake.posts).toHaveLength(1);
  });

  it("tool-call status: dedup by toolCallId — a repeated START (e.g. on graph resume) does not double-post", async () => {
    const fake = makeFakeClient();
    const { subscriber: sub } = createSlackEventRenderer({
      client: fake.client as never,
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

  it("mrkdwn: bold/italic/links/lists get translated before chat.update", async () => {
    const fake = makeFakeClient();
    const { subscriber: sub } = createSlackEventRenderer({
      client: fake.client as never,
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
    const { subscriber: sub } = createSlackEventRenderer({
      client: fake.client as never,
      target: { channel: "C1", threadTs: "100.0" },
    });
    await sub.onRunErrorEvent!({ event: { message: "boom" } } as never);
    expect(fake.posts).toHaveLength(1);
    expect(fake.posts[0]?.text).toContain("boom");
    expect(fake.posts[0]?.thread_ts).toBe("100.0");
  });

  it("markInterrupted: appends _(interrupted)_ to a partial reply and finalises", async () => {
    const fake = makeFakeClient();
    const { subscriber, markInterrupted } = createSlackEventRenderer({
      client: fake.client as never,
      target: { channel: "C1", threadTs: "100.0" },
    });
    await subscriber.onTextMessageStartEvent!({
      event: { messageId: "m1", role: "assistant" },
    } as never);
    subscriber.onTextMessageContentEvent!({
      event: { messageId: "m1", delta: "Once upon a time" },
      textMessageBuffer: "",
    } as never);
    // (some milliseconds later, the agent is interrupted)
    await markInterrupted();
    const last = fake.updates.at(-1)?.text ?? "";
    expect(last).toContain("Once upon a time");
    expect(last).toContain("_(interrupted)_");
  });

  it("markInterrupted: no partial reply yet → no Slack post created", async () => {
    const fake = makeFakeClient();
    const { subscriber, markInterrupted } = createSlackEventRenderer({
      client: fake.client as never,
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
    // When we abort the agent, AG-UI may fire RUN_ERROR. The renderer's
    // default behaviour is to post `:warning: Agent error: ...` — but if
    // we initiated the abort, the `_(interrupted)_` marker already
    // conveys the state, so no warning should land.
    const fake = makeFakeClient();
    const { subscriber, markInterrupted } = createSlackEventRenderer({
      client: fake.client as never,
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
    // No `:warning:` should have been posted.
    const warnings = fake.posts.filter((p) => p.text.includes(":warning:"));
    expect(warnings).toHaveLength(0);
  });

  it("markInterrupted: ignores late content events after the interrupt", async () => {
    const fake = makeFakeClient();
    const { subscriber, markInterrupted } = createSlackEventRenderer({
      client: fake.client as never,
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
    const { subscriber: sub } = createSlackEventRenderer({
      client: fake.client as never,
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

    // First posted message ended with "AAA"; second with "BBB".
    const lastUpdateForFirstTs = [...fake.updates]
      .reverse()
      .find((u) => u.ts === "1.000");
    const lastUpdateForSecondTs = [...fake.updates]
      .reverse()
      .find((u) => u.ts === "2.000");
    expect(lastUpdateForFirstTs?.text).toBe("AAA");
    expect(lastUpdateForSecondTs?.text).toBe("BBB");
  });
});
