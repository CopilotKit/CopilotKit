import { describe, it, expect, vi } from "vitest";
import { attachSlackListener } from "../slack-listener.js";
import type { SlackConversationStore } from "../conversation-store.js";
import type { IncomingTurn } from "../types.js";
import { DM_SCOPE } from "../types.js";

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

/**
 * A tiny stand-in for SlackConversationStore. The listener only ever
 * calls `store.has(...)`; everything else (getOrCreate, save) is the
 * turn-runner's concern. The test controls which conversation keys are
 * "owned".
 */
function fakeStore(
  owned: Array<{ channelId: string; scope: string }> = [],
): SlackConversationStore {
  const ownedKeys = new Set(owned.map((o) => `${o.channelId}::${o.scope}`));
  return {
    has: vi.fn(async (k) => ownedKeys.has(`${k.channelId}::${k.scope}`)),
    getOrCreate: vi.fn(),
    save: vi.fn(),
  } as unknown as SlackConversationStore;
}

function setup(opts?: {
  ownedThreads?: Array<{ channelId: string; threadTs: string }>;
}) {
  const store = fakeStore(
    (opts?.ownedThreads ?? []).map((t) => ({
      channelId: t.channelId,
      scope: t.threadTs,
    })),
  );
  const turns: IncomingTurn[] = [];
  const onTurn = vi.fn(async (turn: IncomingTurn) => {
    turns.push(turn);
  });
  const fake = makeFakeApp();
  attachSlackListener({ app: fake.app, store, botUserId: BOT_USER_ID, onTurn });
  return { ...fake, turns, onTurn, store };
}

describe("slack-listener", () => {
  it("turns an @mention into a turn with the right reply target", async () => {
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
    });
  });

  it("threads a follow-up @mention into the existing thread", async () => {
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

  it("treats DM messages as flat replies (no threadTs)", async () => {
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
    });
    expect(f.turns[0]!.replyTarget.threadTs).toBeUndefined();
  });

  it("continues a tracked thread on a plain reply (no @mention)", async () => {
    const f = setup({ ownedThreads: [{ channelId: "C1", threadTs: "100.0" }] });
    await f.fireMessage({
      type: "message",
      channel: "C1",
      user: "UATAI001",
      ts: "400.0",
      thread_ts: "100.0",
      text: "carry on",
    });
    expect(f.turns).toHaveLength(1);
    expect(f.turns[0]!.userText).toBe("carry on");
  });

  it("ignores plain replies in threads it doesn't own", async () => {
    const f = setup(); // no seed
    await f.fireMessage({
      type: "message",
      channel: "C1",
      user: "UOTHER01",
      ts: "400.0",
      thread_ts: "999.0",
      text: "random thread chatter",
    });
    expect(f.turns).toHaveLength(0);
  });

  it("ignores top-level channel chatter with no @mention", async () => {
    const f = setup();
    await f.fireMessage({
      type: "message",
      channel: "C1",
      user: "UATAI001",
      ts: "500.0",
      text: "just talking",
    });
    expect(f.turns).toHaveLength(0);
  });

  it("skips messages from any bot (bot_id set, no user)", async () => {
    const f = setup({ ownedThreads: [{ channelId: "C1", threadTs: "100.0" }] });
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
    const f = setup({ ownedThreads: [{ channelId: "C1", threadTs: "100.0" }] });
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
    const f = setup({ ownedThreads: [{ channelId: "C1", threadTs: "100.0" }] });
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

  it("skips the message.channels echo of an @mention (duplicate event)", async () => {
    const f = setup({ ownedThreads: [{ channelId: "C1", threadTs: "100.0" }] });
    await f.fireMessage({
      type: "message",
      channel: "C1",
      user: "UATAI001",
      ts: "100.0",
      thread_ts: "100.0",
      text: `<@${BOT_USER_ID}> hello`,
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
        const f = setup({
          ownedThreads: [{ channelId: "C1", threadTs: "100.0" }],
        });
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

    it("processes a file_share upload in an owned thread (even with empty text)", async () => {
      const f = setup({
        ownedThreads: [{ channelId: "C1", threadTs: "100.0" }],
      });
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
    });
  });

  it("treats a group-DM (mpim) like a non-IM channel (ignored without thread_ts)", async () => {
    const f = setup();
    await f.fireMessage({
      type: "message",
      channel: "G1",
      channel_type: "mpim",
      user: "UATAI001",
      ts: "300.0",
      text: "ping in group dm",
    });
    expect(f.turns).toHaveLength(0);
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

  it("same thread_ts in different channels = different conversations (and not owned)", async () => {
    const f = setup({ ownedThreads: [{ channelId: "C1", threadTs: "100.0" }] });
    await f.fireMessage({
      type: "message",
      channel: "C2",
      user: "UATAI001",
      ts: "101.0",
      thread_ts: "100.0",
      text: "stranger in another channel",
    });
    expect(f.turns).toHaveLength(0);
  });

  it("A10: /agent slash command becomes a turn in the invoking channel (flat reply)", async () => {
    const f = setup();
    await f.fireCommand({
      channel_id: "C1",
      user_id: "UATAI001",
      text: "hello via slash",
    });
    expect(f.turns).toHaveLength(1);
    expect(f.turns[0]!.userText).toBe("hello via slash");
    expect(f.turns[0]!.replyTarget).toEqual({ channel: "C1" });
    expect(f.turns[0]!.conversation.scope).toBe("slash::UATAI001");
  });

  it("A10: /agent with empty text is a no-op (no turn)", async () => {
    const f = setup();
    await f.fireCommand({ channel_id: "C1", user_id: "UATAI001", text: "   " });
    expect(f.turns).toHaveLength(0);
  });

  it("A10: repeat /agent from same user reuses the same conversation scope", async () => {
    const f = setup();
    await f.fireCommand({ channel_id: "C1", user_id: "UATAI001", text: "one" });
    await f.fireCommand({ channel_id: "C1", user_id: "UATAI001", text: "two" });
    expect(f.turns[0]!.conversation.scope).toBe(f.turns[1]!.conversation.scope);
  });

  it("F-user-token: thread reply with both user and bot_id (xoxp- post) is treated as real user message", async () => {
    const f = setup({ ownedThreads: [{ channelId: "C1", threadTs: "100.0" }] });
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
  });
});
