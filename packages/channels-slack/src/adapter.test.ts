import { describe, it, expect, vi } from "vitest";
import { SlackAdapter } from "./adapter.js";
import type { ChannelNode } from "@copilotkit/channels-ui";
import type { InteractionEvent, IngressSink } from "@copilotkit/channels-core";

/**
 * Build an adapter with a mock Slack client injected. Constructing the real
 * Bolt `App` is side-effect-free (Socket Mode doesn't connect until `start()`),
 * but we never call `start()` here — every test drives the pure-ish egress and
 * decode methods against a fake `client`.
 */
function makeAdapter() {
  const chat = {
    postMessage: vi.fn(async (_arg: Record<string, unknown>) => ({
      ts: "200.5",
      channel: "C1",
    })),
    update: vi.fn(async (_arg: Record<string, unknown>) => ({})),
    delete: vi.fn(async (_arg: Record<string, unknown>) => ({})),
  };
  const adapter = new SlackAdapter({ botToken: "x", appToken: "y" });
  (adapter as unknown as { client: unknown }).client = { chat };
  (adapter as unknown as { botUserId: string }).botUserId = "UBOT";
  return { adapter, chat };
}

const section = (text: string): ChannelNode => ({
  type: "section",
  props: { children: [{ type: "text", props: { value: text } }] },
});

describe("SlackAdapter.post", () => {
  it("posts blocks + fallback text to the target channel/thread and returns a MessageRef", async () => {
    const { adapter, chat } = makeAdapter();
    const ref = await adapter.post({ channel: "C1", threadTs: "100.0" }, [
      section("hi"),
    ]);

    expect(chat.postMessage).toHaveBeenCalledTimes(1);
    const arg = chat.postMessage.mock.calls[0]![0] as {
      channel: string;
      thread_ts?: string;
      blocks: Array<{ type: string }>;
      text: string;
    };
    expect(arg.channel).toBe("C1");
    expect(arg.thread_ts).toBe("100.0");
    expect(arg.text).toBe("hi");
    expect(arg.blocks).toHaveLength(1);
    expect(arg.blocks[0]!.type).toBe("section");
    expect(arg.blocks.length).toBeLessThanOrEqual(50); // budget-clamped

    expect(ref.id).toBe("200.5");
    expect((ref as { channel?: string }).channel).toBe("C1");
  });

  it("renders a <Message accent> as a colored attachment with a short top-level text and NO fallback on the attachment", async () => {
    const { adapter, chat } = makeAdapter();
    const header = (text: string): ChannelNode => ({
      type: "header",
      props: { children: [{ type: "text", props: { value: text } }] },
    });
    await adapter.post({ channel: "C1" }, [
      {
        type: "message",
        props: {
          accent: "#27AE60",
          children: [header("Open issues"), section("ok")],
        },
      },
    ]);

    const arg = chat.postMessage.mock.calls[0]![0] as {
      text?: unknown;
      blocks?: unknown;
      attachments?: Array<{
        color: string;
        blocks: Array<{ type: string }>;
        fallback?: unknown;
      }>;
      unfurl_links?: boolean;
      unfurl_media?: boolean;
    };
    // Short top-level text (the notification/a11y summary) AND a colored
    // attachment card with { color, blocks } — never a legacy `fallback` on
    // the attachment (that triggers invalid_attachments). No top-level blocks.
    expect(arg.text).toBe("Open issues");
    expect(arg.blocks).toBeUndefined();
    expect(arg.attachments).toHaveLength(1);
    expect(arg.attachments![0]!.color).toBe("#27AE60");
    expect(arg.attachments![0]!.blocks[0]!.type).toBe("header");
    expect(arg.attachments![0]!.fallback).toBeUndefined();
    // Unfurling is suppressed on the post.
    expect(arg.unfurl_links).toBe(false);
    expect(arg.unfurl_media).toBe(false);
  });

  it("defaults fallback text to … when the IR has no text", async () => {
    const { adapter, chat } = makeAdapter();
    await adapter.post({ channel: "C1" }, [{ type: "divider", props: {} }]);
    const arg = chat.postMessage.mock.calls[0]![0] as { text: string };
    expect(arg.text).toBe("…");
  });

  it("uses the header as the short fallback summary — not a dump of the whole card", async () => {
    const { adapter, chat } = makeAdapter();
    const header = (text: string): ChannelNode => ({
      type: "header",
      props: { children: [{ type: "text", props: { value: text } }] },
    });
    await adapter.post({ channel: "C1" }, [
      {
        type: "message",
        props: {
          accent: "#27AE60",
          children: [
            header("Open CPK issues"),
            section("CPK-1 Checkout 500s"),
            section("CPK-2 Login broken"),
          ],
        },
      },
    ]);
    const arg = chat.postMessage.mock.calls[0]![0] as {
      text?: string;
    };
    // The short summary is the header only — it must NOT concatenate the row text.
    expect(arg.text).toBe("Open CPK issues");
    expect(arg.text).not.toContain("CPK-1");
  });
});

describe("SlackAdapter.update / delete use the stashed channel", () => {
  it("update edits the message at ref.id on its channel", async () => {
    const { adapter, chat } = makeAdapter();
    await adapter.update({ id: "200.5", channel: "C1" }, [section("edited")]);
    const arg = chat.update.mock.calls[0]![0] as {
      channel: string;
      ts: string;
    };
    expect(arg.channel).toBe("C1");
    expect(arg.ts).toBe("200.5");
  });

  it("update of an accent card sets a short top-level text and attachments with NO fallback", async () => {
    const { adapter, chat } = makeAdapter();
    const header = (text: string): ChannelNode => ({
      type: "header",
      props: { children: [{ type: "text", props: { value: text } }] },
    });
    await adapter.update({ id: "200.5", channel: "C1" }, [
      {
        type: "message",
        props: { accent: "#EB5757", children: [header("Updated")] },
      },
    ]);
    const arg = chat.update.mock.calls[0]![0] as {
      text?: unknown;
      blocks?: unknown;
      attachments?: Array<{ color: string; fallback?: unknown }>;
    };
    expect(arg.text).toBe("Updated");
    expect(arg.blocks).toBeUndefined();
    expect(arg.attachments![0]!.color).toBe("#EB5757");
    expect(arg.attachments![0]!.fallback).toBeUndefined();
  });

  it("delete removes the message at ref.id on its channel", async () => {
    const { adapter, chat } = makeAdapter();
    await adapter.delete({ id: "200.5", channel: "C1" });
    const arg = chat.delete.mock.calls[0]![0] as {
      channel: string;
      ts: string;
    };
    expect(arg.channel).toBe("C1");
    expect(arg.ts).toBe("200.5");
  });
});

describe("SlackAdapter.decodeInteraction", () => {
  it("decodes a block_actions payload to an opaque-id InteractionEvent", () => {
    const { adapter } = makeAdapter();
    const evt = adapter.decodeInteraction({
      type: "block_actions",
      channel: { id: "C1" },
      message: { ts: "1", thread_ts: "100.0" },
      actions: [{ action_id: "ck:z", value: '{"ok":1}' }],
    });
    expect(evt).toBeDefined();
    expect(evt!.id).toBe("ck:z");
    expect(evt!.value).toEqual({ ok: 1 });
    expect(evt!.conversationKey).toBe("C1::100.0");
  });
});

describe("SlackAdapter.getMessages", () => {
  it("maps conversations.replies to ThreadMessage[] (text/ts/isBot/resolved user)", async () => {
    const { adapter } = makeAdapter();
    const replies = vi.fn(async (_arg: { channel: string; ts: string }) => ({
      messages: [
        { ts: "100.0", text: "hello", user: "U1" },
        { ts: "100.1", text: "bot reply", bot_id: "B1" },
        { ts: "100.2", text: "joined", subtype: "channel_join", user: "U9" },
      ],
    }));
    const info = vi.fn(async (_arg: { user: string }) => ({
      user: { id: "U1", name: "ana", real_name: "Ana Smith" },
    }));
    (adapter as unknown as { client: unknown }).client = {
      conversations: { replies },
      users: { info },
    };

    const msgs = await adapter.getMessages({
      channel: "C1",
      threadTs: "100.0",
    });

    expect(replies).toHaveBeenCalledTimes(1);
    const arg = replies.mock.calls[0]![0] as { channel: string; ts: string };
    expect(arg.channel).toBe("C1");
    expect(arg.ts).toBe("100.0");

    // System (channel_join) subtype is skipped; the two real messages remain.
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toEqual({
      text: "hello",
      ts: "100.0",
      isBot: false,
      user: { id: "U1", name: "Ana Smith", email: undefined },
    });
    expect(msgs[1]!.isBot).toBe(true);
    expect(msgs[1]!.text).toBe("bot reply");
    expect(msgs[1]!.user).toBeUndefined();
  });

  it("returns [] for a flat target with no threadTs (nothing to fetch)", async () => {
    const { adapter } = makeAdapter();
    const replies = vi.fn();
    (adapter as unknown as { client: unknown }).client = {
      conversations: { replies },
    };
    const msgs = await adapter.getMessages({ channel: "C1" });
    expect(msgs).toEqual([]);
    expect(replies).not.toHaveBeenCalled();
  });

  it("returns [] when conversations.replies throws", async () => {
    const { adapter } = makeAdapter();
    (adapter as unknown as { client: unknown }).client = {
      conversations: {
        replies: vi.fn(async () => {
          throw new Error("rate_limited");
        }),
      },
    };
    const msgs = await adapter.getMessages({
      channel: "C1",
      threadTs: "100.0",
    });
    expect(msgs).toEqual([]);
  });
});

describe("SlackAdapter.postFile", () => {
  it("uploads via files.uploadV2 with channel_id/thread_ts/file and returns ok", async () => {
    const { adapter } = makeAdapter();
    const uploadV2 = vi.fn(async (_arg: Record<string, unknown>) => ({
      ok: true,
    }));
    (adapter as unknown as { client: { files: unknown } }).client = {
      files: { uploadV2 },
    };

    const res = await adapter.postFile(
      { channel: "C1", threadTs: "100.0" },
      {
        bytes: new Uint8Array([1, 2, 3]),
        filename: "chart.png",
        title: "Chart",
        altText: "alt",
      },
    );

    expect(res).toEqual({ ok: true });
    expect(uploadV2).toHaveBeenCalledTimes(1);
    const arg = uploadV2.mock.calls[0]![0] as {
      channel_id: string;
      thread_ts?: string;
      filename: string;
      title?: string;
      alt_text?: string;
      file: unknown;
    };
    expect(arg.channel_id).toBe("C1");
    expect(arg.thread_ts).toBe("100.0");
    expect(arg.filename).toBe("chart.png");
    expect(arg.title).toBe("Chart");
    expect(arg.alt_text).toBe("alt");
    expect(Buffer.isBuffer(arg.file)).toBe(true);
  });

  it("omits thread_ts when the target has none", async () => {
    const { adapter } = makeAdapter();
    const uploadV2 = vi.fn(async (_arg: Record<string, unknown>) => ({
      ok: true,
    }));
    (adapter as unknown as { client: { files: unknown } }).client = {
      files: { uploadV2 },
    };

    await adapter.postFile(
      { channel: "C1" },
      { bytes: new Uint8Array([1]), filename: "x.png" },
    );

    const arg = uploadV2.mock.calls[0]![0] as { thread_ts?: string };
    expect(arg.thread_ts).toBeUndefined();
  });

  it("returns ok:false with the error message when uploadV2 throws", async () => {
    const { adapter } = makeAdapter();
    const uploadV2 = vi.fn(async () => {
      throw new Error("upload_failed");
    });
    (adapter as unknown as { client: { files: unknown } }).client = {
      files: { uploadV2 },
    };

    const res = await adapter.postFile(
      { channel: "C1" },
      { bytes: new Uint8Array([1]), filename: "x.png" },
    );

    expect(res).toEqual({ ok: false, error: "upload_failed" });
  });
});

describe("SlackAdapter.capabilities / ackDeadlineMs", () => {
  it("reports the Slack surface capabilities", () => {
    const { adapter } = makeAdapter();
    expect(adapter.capabilities.supportsTyping).toBe(false);
    expect(adapter.capabilities.supportsStreaming).toBe(true);
    expect(adapter.capabilities.maxBlocksPerMessage).toBe(50);
    expect(adapter.ackDeadlineMs).toBe(3000);
    expect(adapter.platform).toBe("slack");
  });
});

describe("SlackAdapter.resolveUser", () => {
  it("resolves a sender id to a richer PlatformUser (name + email) and caches it", async () => {
    const { adapter } = makeAdapter();
    const info = vi.fn(async (_arg: { user: string }) => ({
      user: {
        id: "U1",
        name: "ana",
        real_name: "Ana Smith",
        profile: { real_name: "Ana Smith", email: "ana@example.com" },
      },
    }));
    (adapter as unknown as { client: { users: unknown } }).client = {
      users: { info },
    };

    const u = await adapter.resolveUser("U1");
    expect(u).toEqual({
      id: "U1",
      name: "Ana Smith",
      email: "ana@example.com",
    });

    // Second call is served from cache (no extra users.info call).
    const u2 = await adapter.resolveUser("U1");
    expect(u2).toEqual(u);
    expect(info).toHaveBeenCalledTimes(1);
  });

  it("falls back to a bare { id } when users.info fails", async () => {
    const { adapter } = makeAdapter();
    const info = vi.fn(async () => {
      throw new Error("not_found");
    });
    (adapter as unknown as { client: { users: unknown } }).client = {
      users: { info },
    };

    const u = await adapter.resolveUser("U2");
    expect(u).toEqual({ id: "U2" });
  });
});

describe("SlackAdapter action wiring", () => {
  it("decodes a captured block_actions body and forwards to sink.onInteraction", async () => {
    const { adapter } = makeAdapter();

    // Capture the handler Bolt would register, without starting sockets.
    let actionHandler:
      | ((args: { ack: () => Promise<void>; body: unknown }) => Promise<void>)
      | undefined;
    const app = {
      action: vi.fn((_matcher: unknown, handler: typeof actionHandler) => {
        actionHandler = handler;
      }),
      init: vi.fn(async () => {}),
      start: vi.fn(async () => {}),
    };
    (adapter as unknown as { app: unknown }).app = app;
    // auth.test is awaited in start(); attachSlackListener reads app.event etc.
    (adapter as unknown as { client: { auth: unknown } }).client = {
      ...(adapter as unknown as { client: object }).client,
      auth: { test: vi.fn(async () => ({ user_id: "UBOT" })) },
    } as never;
    // attachSlackListener calls app.command/event/message and (default-on)
    // attachAssistant calls app.assistant — stub them.
    Object.assign(app, {
      command: vi.fn(),
      event: vi.fn(),
      message: vi.fn(),
      assistant: vi.fn(),
      view: vi.fn(),
    });

    const received: InteractionEvent[] = [];
    const sink: IngressSink = {
      onTurn: vi.fn(),
      onInteraction: (evt) => {
        received.push(evt);
      },
      onCommand: vi.fn(),
      onThreadStarted: vi.fn(),
      onReaction: vi.fn(),
      onModalSubmit: vi.fn(async () => {}),
      onModalClose: vi.fn(),
    };
    await adapter.start(sink);

    expect(actionHandler).toBeDefined();
    const ack = vi.fn(async () => {});
    await actionHandler!({
      ack,
      body: {
        type: "block_actions",
        channel: { id: "C1" },
        message: { ts: "1", thread_ts: "100.0" },
        actions: [{ action_id: "ck:z", value: '{"ok":1}' }],
      },
    });

    expect(ack).toHaveBeenCalledTimes(1);
    expect(received).toHaveLength(1);
    expect(received[0]!.id).toBe("ck:z");
    expect(received[0]!.conversationKey).toBe("C1::100.0");
  });
});
