import { describe, it, expect, vi } from "vitest";
import type { ChannelNode } from "@copilotkit/channels-ui";
import type { InteractionEvent, IngressSink } from "@copilotkit/channels-core";

/**
 * Capture the `action` handler `WebClientSlackConnector.startIngress` would
 * register on the real Bolt `App`, without starting a real socket. `App`
 * construction lives inside the connector now (Task 3b), not on the adapter,
 * so this is mocked at the `@slack/bolt` module level rather than via a field
 * swap on the adapter.
 */
let actionHandler:
  | ((args: { ack: () => Promise<void>; body: unknown }) => Promise<void>)
  | undefined;
/** Captures the `app_mention` handler `attachSlackListener` registers via `app.event`. */
let mentionHandler:
  | ((args: { event: Record<string, unknown>; client: object }) => unknown)
  | undefined;

vi.mock("@slack/bolt", () => ({
  App: class {
    init = vi.fn().mockResolvedValue(undefined);
    start = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn().mockResolvedValue(undefined);
    action(_matcher: unknown, handler: typeof actionHandler) {
      actionHandler = handler;
    }
    event(name: string, handler: typeof mentionHandler) {
      if (name === "app_mention") mentionHandler = handler;
    }
    command() {}
    message() {}
    assistant() {}
    view() {}
  },
  // `attachAssistant` (default-on) constructs one; a no-op stub is enough
  // since this test doesn't exercise pane behavior.
  Assistant: class {},
  LogLevel: { ERROR: "error", WARN: "warn", INFO: "info", DEBUG: "debug" },
}));

import { SlackAdapter } from "./adapter.js";
import { WebClientSlackConnector } from "./slack-connector.js";
import { FakeSlackConnector } from "./testing/fake-slack-connector.js";

/**
 * Build a credential-free adapter with a `FakeSlackConnector` bound via
 * `ɵbindConnector` (Task 3/T3s-4a: the adapter builds nothing from tokens —
 * every egress method routes through the bound connector). Constructing the
 * adapter is side-effect-free; we never call `start()` here — every test
 * drives the pure-ish egress and decode methods against the fake directly.
 */
function makeAdapter() {
  const adapter = new SlackAdapter({});
  const connector = new FakeSlackConnector();
  adapter.ɵbindConnector(connector);
  (adapter as unknown as { botUserId: string }).botUserId = "UBOT";
  return { adapter, connector };
}

const section = (text: string): ChannelNode => ({
  type: "section",
  props: { children: [{ type: "text", props: { value: text } }] },
});

describe("SlackAdapter.post", () => {
  it("posts blocks + fallback text to the target channel/thread and returns a MessageRef", async () => {
    const { adapter, connector } = makeAdapter();
    connector.results.postMessage = { ts: "200.5", channel: "C1" };
    const ref = await adapter.post({ channel: "C1", threadTs: "100.0" }, [
      section("hi"),
    ]);

    expect(connector.calls.filter((c) => c.op === "postMessage")).toHaveLength(
      1,
    );
    const arg = connector.calls[0]!.args as {
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
    const { adapter, connector } = makeAdapter();
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

    const arg = connector.calls[0]!.args as {
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
    const { adapter, connector } = makeAdapter();
    await adapter.post({ channel: "C1" }, [{ type: "divider", props: {} }]);
    const arg = connector.calls[0]!.args as { text: string };
    expect(arg.text).toBe("…");
  });

  it("uses the header as the short fallback summary — not a dump of the whole card", async () => {
    const { adapter, connector } = makeAdapter();
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
    const arg = connector.calls[0]!.args as {
      text?: string;
    };
    // The short summary is the header only — it must NOT concatenate the row text.
    expect(arg.text).toBe("Open CPK issues");
    expect(arg.text).not.toContain("CPK-1");
  });
});

describe("SlackAdapter.update / delete use the stashed channel", () => {
  it("update edits the message at ref.id on its channel", async () => {
    const { adapter, connector } = makeAdapter();
    await adapter.update({ id: "200.5", channel: "C1" }, [section("edited")]);
    const arg = connector.calls[0]!.args as {
      channel: string;
      ts: string;
    };
    expect(connector.calls[0]!.op).toBe("updateMessage");
    expect(arg.channel).toBe("C1");
    expect(arg.ts).toBe("200.5");
  });

  it("update of an accent card sets a short top-level text and attachments with NO fallback", async () => {
    const { adapter, connector } = makeAdapter();
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
    const arg = connector.calls[0]!.args as {
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
    const { adapter, connector } = makeAdapter();
    await adapter.delete({ id: "200.5", channel: "C1" });
    const arg = connector.calls[0]!.args as {
      channel: string;
      ts: string;
    };
    expect(connector.calls[0]!.op).toBe("deleteMessage");
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
    const { adapter, connector } = makeAdapter();
    connector.results.getReplies = {
      messages: [
        { ts: "100.0", text: "hello", user: "U1" },
        { ts: "100.1", text: "bot reply", bot_id: "B1" },
        { ts: "100.2", text: "joined", subtype: "channel_join", user: "U9" },
      ],
    };
    connector.results.getUserInfo = {
      user: { id: "U1", name: "ana", real_name: "Ana Smith" },
    };

    const msgs = await adapter.getMessages({
      channel: "C1",
      threadTs: "100.0",
    });

    const repliesCalls = connector.calls.filter((c) => c.op === "getReplies");
    expect(repliesCalls).toHaveLength(1);
    const arg = repliesCalls[0]!.args as { channel: string; ts: string };
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
    const { adapter, connector } = makeAdapter();
    const msgs = await adapter.getMessages({ channel: "C1" });
    expect(msgs).toEqual([]);
    expect(connector.calls).toHaveLength(0);
  });

  it("returns [] when conversations.replies throws", async () => {
    const { adapter, connector } = makeAdapter();
    connector.results.throwing = { getReplies: new Error("rate_limited") };
    const msgs = await adapter.getMessages({
      channel: "C1",
      threadTs: "100.0",
    });
    expect(msgs).toEqual([]);
  });
});

describe("SlackAdapter.postFile", () => {
  it("uploads via files.uploadV2 with channel_id/thread_ts/file and returns ok", async () => {
    const { adapter, connector } = makeAdapter();

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
    const uploadCalls = connector.calls.filter((c) => c.op === "uploadFile");
    expect(uploadCalls).toHaveLength(1);
    const arg = uploadCalls[0]!.args as {
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
    const { adapter, connector } = makeAdapter();

    await adapter.postFile(
      { channel: "C1" },
      { bytes: new Uint8Array([1]), filename: "x.png" },
    );

    const arg = connector.calls[0]!.args as { thread_ts?: string };
    expect(arg.thread_ts).toBeUndefined();
  });

  it("returns ok:false with the error message when uploadV2 throws", async () => {
    const { adapter, connector } = makeAdapter();
    connector.results.throwing = { uploadFile: new Error("upload_failed") };

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
    const { adapter, connector } = makeAdapter();
    connector.results.getUserInfo = {
      user: {
        id: "U1",
        name: "ana",
        real_name: "Ana Smith",
        profile: { real_name: "Ana Smith", email: "ana@example.com" },
      },
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
    expect(connector.calls.filter((c) => c.op === "getUserInfo")).toHaveLength(
      1,
    );
  });

  it("falls back to a bare { id } when users.info fails", async () => {
    const { adapter, connector } = makeAdapter();
    connector.results.throwing = { getUserInfo: new Error("not_found") };

    const u = await adapter.resolveUser("U2");
    expect(u).toEqual({ id: "U2" });
  });
});

/**
 * Build a credential-free adapter bound to a REAL `WebClientSlackConnector`
 * (the credential-owning connector a runner would construct) whose internal
 * `WebClient` is patched with a fake `auth.test` — used by the ingress tests
 * below, which exercise the full `adapter.start()` → `connector.startIngress()`
 * → `attachSlackListener` path against the mocked `@slack/bolt` `App` (see the
 * `vi.mock("@slack/bolt", …)` above), not the `FakeSlackConnector`.
 */
function makeIngressAdapter() {
  const adapter = new SlackAdapter({});
  const connector = new WebClientSlackConnector({
    botToken: "x",
    appToken: "y",
  });
  (connector as unknown as { client: { auth: unknown } }).client = {
    auth: { test: vi.fn(async () => ({ user_id: "UBOT" })) },
  };
  adapter.ɵbindConnector(connector);
  return { adapter, connector };
}

describe("SlackAdapter action wiring", () => {
  it("decodes a captured block_actions body and forwards to sink.onInteraction", async () => {
    const { adapter } = makeIngressAdapter();

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

describe("SlackAdapter ingress → sink.onTurn (T3s-3a review follow-up)", () => {
  it("carries conversationKind/mentioned from a raw Slack event through the adapter's normalization to what the sink receives", async () => {
    // Proves the §2 signals aren't just tsc-covered (as they were before this
    // test): the FULL adapter.start() → connector.startIngress() →
    // attachSlackListener → sink.onTurn path actually forwards
    // conversationKind/mentioned end to end, not just the listener's own
    // IncomingTurn shape (already covered by response-policy-wiring.test.ts).
    const { adapter } = makeIngressAdapter();

    const received: Array<{ conversationKind?: string; mentioned?: boolean }> =
      [];
    const sink: IngressSink = {
      onTurn: (turn) => {
        received.push(turn);
      },
      onInteraction: vi.fn(),
      onCommand: vi.fn(),
      onThreadStarted: vi.fn(),
      onReaction: vi.fn(),
      onModalSubmit: vi.fn(async () => {}),
      onModalClose: vi.fn(),
    };
    await adapter.start(sink);

    expect(mentionHandler).toBeDefined();
    await mentionHandler!({
      event: {
        type: "app_mention",
        channel: "C1",
        ts: "100.0",
        text: "<@UBOT> hello",
      },
      client: {},
    });

    expect(received).toHaveLength(1);
    // A top-level @mention: conversationKind "channel" (no thread_ts of its
    // own to continue), and always tagged.
    expect(received[0]!.conversationKind).toBe("channel");
    expect(received[0]!.mentioned).toBe(true);
  });
});
