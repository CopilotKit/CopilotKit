import { describe, it, expect, vi } from "vitest";
import { attachSlackListener } from "../slack-listener.js";
import type { SlackCommand } from "../slack-listener.js";
import type { IncomingTurn, ResolvedSlackRespondToOptions } from "../types.js";
import { DM_SCOPE, resolveSlackRespondToOptions } from "../types.js";

const BOT_USER_ID = "UBOT0001";

type EventHandler = (args: {
  event: Record<string, unknown>;
  client: object;
}) => unknown;
type MessageHandler = (args: {
  message: Record<string, unknown>;
  client: object;
}) => unknown;
type CommandHandler = (args: {
  command: Record<string, unknown>;
  ack: () => Promise<void>;
  client: object;
}) => unknown;

function makeFakeApp() {
  let mention: EventHandler | undefined;
  let message: MessageHandler | undefined;
  let command: CommandHandler | undefined;
  const app = {
    event(name: string, handler: EventHandler) {
      if (name === "app_mention") mention = handler;
    },
    message(handler: MessageHandler) {
      message = handler;
    },
    command(_name: string, handler: CommandHandler) {
      command = handler;
    },
  };
  const client = {};
  return {
    app: app as unknown as Parameters<typeof attachSlackListener>[0]["app"],
    client,
    fireMention: (event: Record<string, unknown>) =>
      mention?.({ event, client }),
    fireMessage: (m: Record<string, unknown>) =>
      message?.({ message: m, client }),
    fireCommand: (cmd: Record<string, unknown>) =>
      command?.({ command: cmd, ack: async () => {}, client }),
  };
}

function setup(opts?: {
  assistantThreads?: Array<{ channel: string; threadTs: string }>;
  respondTo?: ResolvedSlackRespondToOptions;
}) {
  const turns: IncomingTurn[] = [];
  const onTurn = vi.fn(async (turn: IncomingTurn) => {
    turns.push(turn);
  });
  const commands: SlackCommand[] = [];
  const onCommand = vi.fn(async (cmd: SlackCommand) => {
    commands.push(cmd);
  });
  const fake = makeFakeApp();
  const assistantKeys = new Set(
    (opts?.assistantThreads ?? []).map((t) => `${t.channel}::${t.threadTs}`),
  );
  attachSlackListener({
    app: fake.app,
    botUserId: BOT_USER_ID,
    respondTo: opts?.respondTo,
    onTurn,
    onCommand,
    isAssistantThread: opts?.assistantThreads
      ? (channel, threadTs) => assistantKeys.has(`${channel}::${threadTs}`)
      : undefined,
  });
  return { ...fake, turns, onTurn, commands, onCommand };
}

describe("slack-listener", () => {
  it("resolves partial respondTo config against Slack routing defaults", () => {
    // `threadReplies` is REMOVED (superseded by the engine's §2 response
    // policy) — the resolved shape only carries the two hard adapter
    // pre-filters that still gate BEFORE the engine sees a turn.
    expect(resolveSlackRespondToOptions()).toEqual({
      directMessages: true,
      appMentions: { reply: "thread" },
    });
    expect(
      resolveSlackRespondToOptions({ appMentions: { reply: "channel" } }),
    ).toEqual({
      directMessages: true,
      appMentions: { reply: "channel" },
    });
  });

  it("turns an @mention into a turn with the right reply target, tagged (§2)", async () => {
    const f = setup();
    await f.fireMention({
      type: "app_mention",
      channel: "C1",
      ts: "100.0",
      text: `<@${BOT_USER_ID}> hello there`,
    });
    expect(f.turns).toHaveLength(1);
    expect(f.turns[0]).toMatchObject({
      conversation: { channelId: "C1", scope: "100.0" },
      replyTarget: { channel: "C1", threadTs: "100.0" },
      userText: "hello there",
      // A top-level mention has no thread_ts of its own to continue.
      conversationKind: "channel",
      mentioned: true,
    });
  });

  it("ignores @mentions when appMentions is disabled", async () => {
    const f = setup({
      respondTo: {
        directMessages: true,
        appMentions: false,
      },
    });
    await f.fireMention({
      type: "app_mention",
      channel: "C1",
      ts: "100.0",
      text: `<@${BOT_USER_ID}> hello there`,
    });
    expect(f.turns).toHaveLength(0);
  });

  it("can reply to @mentions in-channel instead of in-thread", async () => {
    const f = setup({
      respondTo: {
        directMessages: true,
        appMentions: { reply: "channel" },
      },
    });
    await f.fireMention({
      type: "app_mention",
      channel: "C1",
      ts: "100.0",
      text: `<@${BOT_USER_ID}> hello there`,
    });
    expect(f.turns).toHaveLength(1);
    expect(f.turns[0]).toMatchObject({
      conversation: { channelId: "C1", scope: "100.0" },
      replyTarget: { channel: "C1" },
      userText: "hello there",
      mentioned: true,
    });
    expect(f.turns[0]!.replyTarget.threadTs).toBeUndefined();
  });

  it("threads a follow-up @mention into the existing thread, tagged + thread kind (§2)", async () => {
    const f = setup();
    await f.fireMention({
      type: "app_mention",
      channel: "C1",
      ts: "200.0",
      thread_ts: "100.0",
      text: `<@${BOT_USER_ID}> follow-up`,
    });
    expect(f.turns[0]!.replyTarget).toEqual({
      channel: "C1",
      threadTs: "100.0",
    });
    expect(f.turns[0]).toMatchObject({
      conversationKind: "thread",
      mentioned: true,
    });
  });

  it("ignores @mentions with no real text", async () => {
    const f = setup();
    await f.fireMention({
      type: "app_mention",
      channel: "C1",
      ts: "100.0",
      text: `<@${BOT_USER_ID}>   `,
    });
    expect(f.turns).toHaveLength(0);
  });

  it("treats DM messages as flat replies (no threadTs), directly addressed (§2)", async () => {
    const f = setup();
    await f.fireMessage({
      type: "message",
      channel: "D1",
      channel_type: "im",
      user: "UATAI001",
      ts: "300.0",
      text: "hi bot",
    });
    expect(f.turns[0]).toMatchObject({
      conversation: { channelId: "D1", scope: DM_SCOPE },
      replyTarget: { channel: "D1" },
      userText: "hi bot",
      conversationKind: "direct_message",
      mentioned: false,
    });
    expect(f.turns[0]!.replyTarget.threadTs).toBeUndefined();
  });

  it("ignores DM messages when directMessages is disabled", async () => {
    const f = setup({
      respondTo: {
        directMessages: false,
        appMentions: { reply: "thread" },
      },
    });
    await f.fireMessage({
      type: "message",
      channel: "D1",
      channel_type: "im",
      user: "UATAI001",
      ts: "300.0",
      text: "hi bot",
    });
    expect(f.turns).toHaveLength(0);
  });

  it("directMessages: false is a DM-only pre-filter — shared channel/thread surfaces are unaffected", async () => {
    // §2: respondTo.appMentions / respondTo.directMessages are hard adapter
    // pre-filters that gate ONLY their own surface, sitting before the
    // engine's response policy. Disabling DMs must not also drop channel or
    // thread turns.
    const f = setup({
      respondTo: {
        directMessages: false,
        appMentions: { reply: "thread" },
      },
    });
    await f.fireMessage({
      type: "message",
      channel: "C1",
      user: "UATAI001",
      ts: "500.0",
      text: "top-level channel chatter",
    });
    expect(f.turns).toHaveLength(1);
    expect(f.turns[0]).toMatchObject({ conversationKind: "channel" });

    await f.fireMessage({
      type: "message",
      channel: "C1",
      user: "UATAI001",
      ts: "501.0",
      thread_ts: "500.0",
      text: "plain thread reply",
    });
    expect(f.turns).toHaveLength(2);
    expect(f.turns[1]).toMatchObject({ conversationKind: "thread" });
  });

  it("skips a pane message (assistant thread) — owned by the Assistant middleware", async () => {
    const f = setup({
      assistantThreads: [{ channel: "D1", threadTs: "100.0" }],
    });
    await f.fireMessage({
      type: "message",
      channel: "D1",
      channel_type: "im",
      user: "UATAI001",
      ts: "300.0",
      thread_ts: "100.0",
      text: "in the pane",
    });
    // Exactly one turn per pane message is the Assistant middleware's job; the
    // listener must NOT double-deliver it.
    expect(f.turns).toHaveLength(0);
  });

  it("still flows an ordinary threaded DM that is NOT an assistant thread (per-thread gate)", async () => {
    const f = setup({
      assistantThreads: [{ channel: "D1", threadTs: "999.0" }],
    });
    await f.fireMessage({
      type: "message",
      channel: "D1",
      channel_type: "im",
      user: "UATAI001",
      ts: "300.0",
      thread_ts: "100.0", // a different thread — not the assistant one
      text: "ordinary threaded dm",
    });
    // The guard is per-thread, never per-config: a non-assistant threaded DM
    // is unaffected and flows as a flat DM (shipped behavior).
    expect(f.turns).toHaveLength(1);
    expect(f.turns[0]).toMatchObject({
      conversation: { channelId: "D1", scope: DM_SCOPE },
      replyTarget: { channel: "D1" },
      conversationKind: "direct_message",
    });
  });

  it("leaves flat DMs untouched even when an assistant predicate is present", async () => {
    const f = setup({
      assistantThreads: [{ channel: "D1", threadTs: "100.0" }],
    });
    await f.fireMessage({
      type: "message",
      channel: "D1",
      channel_type: "im",
      user: "UATAI001",
      ts: "300.0",
      text: "flat dm, no thread", // no thread_ts → not a pane message
    });
    expect(f.turns).toHaveLength(1);
    expect(f.turns[0]!.replyTarget.threadTs).toBeUndefined();
  });

  it("forwards a plain thread reply (untagged) with conversationKind:thread, mentioned:false (§2)", async () => {
    // §2 (ratified, D3): the listener no longer gates plain thread replies on
    // thread ownership — that decision now lives in the engine's response
    // policy (`decideChannelResponse`), which requires a mention for a shared
    // thread by default. The listener's job is only to forward + tag.
    const f = setup();
    await f.fireMessage({
      type: "message",
      channel: "C1",
      user: "UATAI001",
      ts: "400.0",
      thread_ts: "100.0",
      text: "carry on",
    });
    expect(f.turns).toHaveLength(1);
    expect(f.turns[0]).toMatchObject({
      conversation: { channelId: "C1", scope: "100.0" },
      replyTarget: { channel: "C1", threadTs: "100.0" },
      userText: "carry on",
      conversationKind: "thread",
      mentioned: false,
    });
  });

  it("forwards a plain thread reply in a thread the bridge has never seen before (no more ownership gate)", async () => {
    // Previously gated on `store.has(...)` (thread ownership); §2 removes
    // that check entirely — ownership is no longer a forwarding concern.
    const f = setup();
    await f.fireMessage({
      type: "message",
      channel: "C1",
      user: "UOTHER01",
      ts: "400.0",
      thread_ts: "999.0",
      text: "random thread chatter",
    });
    expect(f.turns).toHaveLength(1);
    expect(f.turns[0]).toMatchObject({
      conversation: { channelId: "C1", scope: "999.0" },
      conversationKind: "thread",
      mentioned: false,
    });
  });

  it("forwards top-level channel chatter with no @mention as conversationKind:channel, mentioned:false (§2)", async () => {
    // §2 (ratified, D3): top-level, untagged channel chatter is no longer
    // dropped at ingress — it is forwarded and the engine's response policy
    // ignores it unless an `onMessage` handler opts in.
    const f = setup();
    await f.fireMessage({
      type: "message",
      channel: "C1",
      user: "UATAI001",
      ts: "500.0",
      text: "just talking",
    });
    expect(f.turns).toHaveLength(1);
    expect(f.turns[0]).toMatchObject({
      conversation: { channelId: "C1", scope: "500.0" },
      replyTarget: { channel: "C1", threadTs: "500.0" },
      userText: "just talking",
      conversationKind: "channel",
      mentioned: false,
    });
  });

  it("skips messages from any bot (bot_id set, no user)", async () => {
    const f = setup();
    await f.fireMessage({
      type: "message",
      channel: "C1",
      bot_id: "BOTHER01",
      ts: "600.0",
      thread_ts: "100.0",
      text: "bot chatter",
    });
    expect(f.turns).toHaveLength(0);
  });

  it("skips its own messages (user matches botUserId)", async () => {
    const f = setup();
    await f.fireMessage({
      type: "message",
      channel: "C1",
      user: BOT_USER_ID,
      ts: "600.0",
      thread_ts: "100.0",
      text: "my own echo",
    });
    expect(f.turns).toHaveLength(0);
  });

  it("skips subtyped events (edits, joins, etc.)", async () => {
    const f = setup();
    await f.fireMessage({
      type: "message",
      subtype: "message_changed",
      channel: "C1",
      ts: "700.0",
      thread_ts: "100.0",
      text: "edited text",
    });
    expect(f.turns).toHaveLength(0);
  });

  it("skips the message.channels echo of an @mention (duplicate event), thread or top-level", async () => {
    const f = setup();
    // Threaded mention echo.
    await f.fireMessage({
      type: "message",
      channel: "C1",
      user: "UATAI001",
      ts: "100.0",
      thread_ts: "100.0",
      text: `<@${BOT_USER_ID}> hello`,
    });
    // Top-level mention echo — §2 forwards untagged top-level chatter, so the
    // dedup guard must ALSO cover this case now (it used to be moot, since
    // top-level chatter was dropped outright regardless).
    await f.fireMessage({
      type: "message",
      channel: "C1",
      user: "UATAI001",
      ts: "101.0",
      text: `<@${BOT_USER_ID}> hello again`,
    });
    expect(f.turns).toHaveLength(0);
  });

  describe("subtype filter (cases F4..F7)", () => {
    const subtypes = [
      "message_changed",
      "message_deleted",
      "channel_join",
      "channel_leave",
      "channel_rename",
      "channel_topic",
      "channel_purpose",
      "bot_message",
      "thread_broadcast",
      "pinned_item",
      "unpinned_item",
    ];
    for (const subtype of subtypes) {
      it(`ignores subtype=${subtype}`, async () => {
        const f = setup();
        await f.fireMessage({
          type: "message",
          subtype,
          channel: "C1",
          ts: "999.0",
          thread_ts: "100.0",
          text: "subtyped",
        });
        expect(f.turns).toHaveLength(0);
      });
    }

    it("forwards a file_share upload in a shared thread (§2 — no more ownership gate)", async () => {
      const f = setup();
      await f.fireMessage({
        type: "message",
        subtype: "file_share",
        channel: "C1",
        user: "UATAI001",
        ts: "999.0",
        thread_ts: "100.0",
        text: "",
        files: [{ id: "F1", name: "data.csv", mimetype: "text/csv" }],
      });
      expect(f.turns).toHaveLength(1);
      expect(f.turns[0]).toMatchObject({ conversationKind: "thread" });
    });
  });

  it("treats a group-DM (mpim) like a non-IM channel (forwarded as conversationKind:channel, §2)", async () => {
    const f = setup();
    await f.fireMessage({
      type: "message",
      channel: "G1",
      channel_type: "mpim",
      user: "UATAI001",
      ts: "300.0",
      text: "ping in group dm",
    });
    expect(f.turns).toHaveLength(1);
    expect(f.turns[0]).toMatchObject({ conversationKind: "channel" });
  });

  it("strips multiple @mentions of the bot from a single message", async () => {
    const f = setup();
    await f.fireMention({
      type: "app_mention",
      channel: "C1",
      ts: "100.0",
      text: `<@${BOT_USER_ID}> hello there <@${BOT_USER_ID}> again`,
    });
    expect(f.turns).toHaveLength(1);
    expect(f.turns[0]!.userText).toBe("hello there again");
  });

  it("strips @mentions of OTHER users too (so the agent sees clean text)", async () => {
    const f = setup();
    await f.fireMention({
      type: "app_mention",
      channel: "C1",
      ts: "100.0",
      text: `<@${BOT_USER_ID}> tell <@UOTHER01> hi`,
    });
    expect(f.turns[0]!.userText).toBe("tell hi");
  });

  it("conversation key is keyed on channelId + scope", async () => {
    const f = setup();
    await f.fireMention({
      type: "app_mention",
      channel: "C1",
      ts: "100.0",
      text: `<@${BOT_USER_ID}> first`,
    });
    await f.fireMention({
      type: "app_mention",
      channel: "C1",
      ts: "200.0",
      text: `<@${BOT_USER_ID}> second`,
    });
    expect(f.turns[0]!.conversation.scope).toBe("100.0");
    expect(f.turns[1]!.conversation.scope).toBe("200.0");
    expect(f.turns[0]!.conversation.scope).not.toBe(
      f.turns[1]!.conversation.scope,
    );
  });

  it("same thread_ts in different channels are independent conversations (both forwarded, §2)", async () => {
    const f = setup();
    await f.fireMessage({
      type: "message",
      channel: "C1",
      user: "UATAI001",
      ts: "101.0",
      thread_ts: "100.0",
      text: "in channel one",
    });
    await f.fireMessage({
      type: "message",
      channel: "C2",
      user: "UATAI001",
      ts: "102.0",
      thread_ts: "100.0",
      text: "stranger in another channel",
    });
    expect(f.turns).toHaveLength(2);
    expect(f.turns[0]!.conversation).toEqual({
      channelId: "C1",
      scope: "100.0",
    });
    expect(f.turns[1]!.conversation).toEqual({
      channelId: "C2",
      scope: "100.0",
    });
  });

  it("forwards a slash command to onCommand with normalized fields (flat reply target)", async () => {
    const f = setup();
    await f.fireCommand({
      command: "/triage",
      channel_id: "C1",
      user_id: "UATAI001",
      text: "hello via slash",
    });
    expect(f.commands).toHaveLength(1);
    expect(f.commands[0]!.command).toBe("/triage");
    expect(f.commands[0]!.text).toBe("hello via slash");
    expect(f.commands[0]!.replyTarget).toEqual({ channel: "C1" });
    expect(f.commands[0]!.conversation.scope).toBe("slash::UATAI001");
    // A slash command is NOT a turn — routing/handling is the engine's job.
    expect(f.turns).toHaveLength(0);
  });

  it("forwards a command even with empty text (the handler decides what to do)", async () => {
    const f = setup();
    await f.fireCommand({
      command: "/triage",
      channel_id: "C1",
      user_id: "UATAI001",
      text: "   ",
    });
    expect(f.commands).toHaveLength(1);
    expect(f.commands[0]!.text).toBe("");
  });

  it("forwards trigger_id from a slash command to the SlackCommand", async () => {
    const f = setup();
    await f.fireCommand({
      command: "/triage",
      channel_id: "C1",
      user_id: "UATAI001",
      text: "hello",
      trigger_id: "T999.888",
    });
    expect(f.commands).toHaveLength(1);
    expect(f.commands[0]!.triggerId).toBe("T999.888");
  });

  it("repeat command from same user reuses the same conversation scope", async () => {
    const f = setup();
    await f.fireCommand({
      command: "/triage",
      channel_id: "C1",
      user_id: "UATAI001",
      text: "one",
    });
    await f.fireCommand({
      command: "/triage",
      channel_id: "C1",
      user_id: "UATAI001",
      text: "two",
    });
    expect(f.commands[0]!.conversation.scope).toBe(
      f.commands[1]!.conversation.scope,
    );
  });

  it("F-user-token: thread reply with both user and bot_id (xoxp- post) is treated as real user message", async () => {
    const f = setup();
    await f.fireMessage({
      type: "message",
      channel: "C1",
      user: "UATAI001",
      bot_id: "B0XYZAPP",
      ts: "400.0",
      thread_ts: "100.0",
      text: "follow-up via user token",
    });
    expect(f.turns).toHaveLength(1);
    expect(f.turns[0]).toMatchObject({ conversationKind: "thread" });
  });
});
