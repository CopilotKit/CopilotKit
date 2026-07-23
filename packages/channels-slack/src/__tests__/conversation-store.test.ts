import { describe, it, expect } from "vitest";
import { SlackConversationStore } from "../conversation-store.js";
import { DM_SCOPE } from "../types.js";
import { FakeSlackConnector } from "../testing/fake-slack-connector.js";

const BOT = "UBOT0001";
const ATAI = "UATAI001";

interface RawMsg {
  ts: string;
  user?: string;
  bot_id?: string;
  text?: string;
  subtype?: string;
}

/**
 * A `FakeSlackConnector` preloaded with canned `getReplies`/`getHistory`
 * results (and an optional `getReplies` failure) — the store's ONLY source of
 * Slack data now that it takes a connector instead of a raw `WebClient` +
 * bot token (Task 3/T3s-4a).
 */
function makeFakeConnector(opts: {
  replies?: RawMsg[];
  history?: RawMsg[];
  throwOnReplies?: boolean;
}) {
  const connector = new FakeSlackConnector({
    getReplies: { messages: opts.replies ?? [] },
    getHistory: { messages: opts.history ?? [] },
    throwing: opts.throwOnReplies
      ? { getReplies: new Error("api down") }
      : undefined,
  });
  return connector;
}

function makeAgent() {
  return {
    messages: [] as { id: string; role: string; content: string }[],
    threadId: "",
  } as unknown as Parameters<SlackConversationStore["getOrCreate"]>[2] extends (
    threadId: string,
  ) => infer R
    ? R
    : never;
}

describe("SlackConversationStore", () => {
  it("mints a unique threadId per turn under a stable conversation prefix", async () => {
    const connector = makeFakeConnector({ replies: [] });
    const store = new SlackConversationStore({
      connector,
      botUserId: BOT,
    });
    const s1 = await store.getOrCreate(
      { channelId: "C1", scope: "100.0" },
      { channel: "C1", threadTs: "100.0" },
      () => makeAgent() as never,
    );
    const s2 = await store.getOrCreate(
      { channelId: "C1", scope: "100.0" },
      { channel: "C1", threadTs: "100.0" },
      () => makeAgent() as never,
    );
    // Threads are unique per turn so the server-side LangGraph thread never
    // accumulates internal messages across turns (the "Message not found"
    // balloon). Slack is the durable history; each turn rebuilds from it.
    expect(s1.threadId).not.toBe(s2.threadId);
    // …but both carry the stable conversation prefix so the turn's origin
    // stays identifiable (and recovery can fall back to it).
    expect(s1.threadId).toMatch(/^slack-C1-100\.0-/);
    expect(s2.threadId).toMatch(/^slack-C1-100\.0-/);
  });

  it("populates agent.messages from the thread history fetched via Slack", async () => {
    const connector = makeFakeConnector({
      replies: [
        { ts: "100.0", user: ATAI, text: `<@${BOT}> hello` },
        { ts: "100.5", user: BOT, text: "Hi back!" },
        { ts: "101.0", user: ATAI, text: "follow-up" },
      ],
    });
    const store = new SlackConversationStore({
      connector,
      botUserId: BOT,
    });
    const s = await store.getOrCreate(
      { channelId: "C1", scope: "100.0" },
      { channel: "C1", threadTs: "100.0" },
      () => makeAgent() as never,
    );
    const msgs = (
      s.agent as unknown as {
        messages: Array<{ role: string; content: string }>;
      }
    ).messages;
    expect(msgs.map((m) => ({ r: m.role, c: m.content }))).toEqual([
      { r: "user", c: "hello" }, // bot mention stripped
      { r: "assistant", c: "Hi back!" },
      { r: "user", c: "follow-up" },
    ]);
  });

  it("folds consecutive bot messages into one assistant turn (chunked replies)", async () => {
    const connector = makeFakeConnector({
      replies: [
        { ts: "100.0", user: ATAI, text: `<@${BOT}> long question` },
        { ts: "100.5", user: BOT, text: "First chunk of the answer." },
        { ts: "100.6", user: BOT, text: "Second chunk." },
        { ts: "100.7", user: BOT, text: "Third and final chunk." },
      ],
    });
    const store = new SlackConversationStore({
      connector,
      botUserId: BOT,
    });
    const s = await store.getOrCreate(
      { channelId: "C1", scope: "100.0" },
      { channel: "C1", threadTs: "100.0" },
      () => makeAgent() as never,
    );
    const msgs = (
      s.agent as unknown as {
        messages: Array<{ role: string; content: string }>;
      }
    ).messages;
    expect(msgs).toHaveLength(2);
    expect(msgs[1]!.role).toBe("assistant");
    expect(msgs[1]!.content).toContain("First chunk");
    expect(msgs[1]!.content).toContain("Second chunk.");
    expect(msgs[1]!.content).toContain("Third and final chunk.");
  });

  it("skips status messages and the thinking placeholder", async () => {
    const connector = makeFakeConnector({
      replies: [
        { ts: "100.0", user: ATAI, text: `<@${BOT}> please search` },
        { ts: "100.5", user: BOT, text: "_thinking…_" },
        { ts: "100.6", user: BOT, text: ":wrench: Calling `search`…" },
        { ts: "100.7", user: BOT, text: ":white_check_mark: `search`" },
        { ts: "100.8", user: BOT, text: "Here are the results." },
      ],
    });
    const store = new SlackConversationStore({
      connector,
      botUserId: BOT,
    });
    const s = await store.getOrCreate(
      { channelId: "C1", scope: "100.0" },
      { channel: "C1", threadTs: "100.0" },
      () => makeAgent() as never,
    );
    const msgs = (
      s.agent as unknown as {
        messages: Array<{ role: string; content: string }>;
      }
    ).messages;
    expect(msgs).toHaveLength(2);
    expect(msgs[1]!.content).toBe("Here are the results.");
  });

  it("ignores subtyped messages (edits, joins, etc.)", async () => {
    const connector = makeFakeConnector({
      replies: [
        { ts: "100.0", user: ATAI, text: "<@" + BOT + "> hi" },
        { ts: "100.1", subtype: "channel_join", text: "joined" },
        { ts: "100.2", subtype: "message_changed", user: ATAI, text: "edited" },
      ],
    });
    const store = new SlackConversationStore({
      connector,
      botUserId: BOT,
    });
    const s = await store.getOrCreate(
      { channelId: "C1", scope: "100.0" },
      { channel: "C1", threadTs: "100.0" },
      () => makeAgent() as never,
    );
    const msgs = (
      s.agent as unknown as {
        messages: Array<{ role: string; content: string }>;
      }
    ).messages;
    expect(msgs).toHaveLength(1);
  });

  it("DM scope uses conversations.history (chronological after reverse) instead of replies", async () => {
    // Slack returns history newest-first; the store reverses it.
    const connector = makeFakeConnector({
      history: [
        { ts: "200.0", user: ATAI, text: "third" },
        { ts: "100.0", user: BOT, text: "second" },
        { ts: "50.0", user: ATAI, text: "first" },
      ],
    });
    const store = new SlackConversationStore({
      connector,
      botUserId: BOT,
    });
    const s = await store.getOrCreate(
      { channelId: "D1", scope: DM_SCOPE },
      { channel: "D1" },
      () => makeAgent() as never,
    );
    const msgs = (
      s.agent as unknown as {
        messages: Array<{ role: string; content: string }>;
      }
    ).messages;
    expect(msgs.map((m) => m.content)).toEqual(["first", "second", "third"]);
  });

  it("has() returns true after the bot has replied; uses Slack lookup on cache miss", async () => {
    const connector = makeFakeConnector({
      replies: [
        { ts: "100.0", user: ATAI, text: "<@" + BOT + "> hi" },
        { ts: "100.5", user: BOT, text: "Hello!" },
      ],
    });
    const store = new SlackConversationStore({
      connector,
      botUserId: BOT,
    });
    // Fresh store, no in-process cache — must hit Slack to discover ownership.
    expect(await store.has({ channelId: "C1", scope: "100.0" })).toBe(true);
    // Second call should be cached (no extra Slack call).
    expect(await store.has({ channelId: "C1", scope: "100.0" })).toBe(true);
    expect(connector.calls.filter((c) => c.op === "getReplies")).toHaveLength(
      1,
    );
  });

  it("has() returns false for threads we've never replied in", async () => {
    const connector = makeFakeConnector({
      replies: [{ ts: "100.0", user: ATAI, text: "hey everyone" }],
    });
    const store = new SlackConversationStore({
      connector,
      botUserId: BOT,
    });
    expect(await store.has({ channelId: "C1", scope: "100.0" })).toBe(false);
  });

  it("has() returns false gracefully when Slack API fails", async () => {
    const connector = makeFakeConnector({ throwOnReplies: true });
    const store = new SlackConversationStore({
      connector,
      botUserId: BOT,
    });
    expect(await store.has({ channelId: "C1", scope: "100.0" })).toBe(false);
  });

  it("getOrCreate marks the conversation as owned even when Slack history doesn't yet include the bot's reply", async () => {
    // After an @mention, the bot will reply within seconds. A follow-up
    // arriving before the bot's reply lands shouldn't be silently dropped.
    const connector = makeFakeConnector({
      replies: [{ ts: "100.0", user: ATAI, text: "<@" + BOT + "> hi" }],
    });
    const store = new SlackConversationStore({
      connector,
      botUserId: BOT,
    });
    await store.getOrCreate(
      { channelId: "C1", scope: "100.0" },
      { channel: "C1", threadTs: "100.0" },
      () => makeAgent() as never,
    );
    // Now has() should be true even though the bot hasn't replied to Slack
    // yet — getOrCreate eagerly marked it.
    expect(await store.has({ channelId: "C1", scope: "100.0" })).toBe(true);
  });

  it("save() is a no-op (Slack is the source of truth)", () => {
    const connector = makeFakeConnector({ replies: [] });
    const store = new SlackConversationStore({
      connector,
      botUserId: BOT,
    });
    expect(() =>
      store.save({ channelId: "C1", scope: "100.0" }, {} as never),
    ).not.toThrow();
  });
});
