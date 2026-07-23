import { describe, it, expect, vi } from "vitest";
import { attachTelegramListener } from "../listener.js";
import { TelegramConversationStore } from "../conversation-store.js";

function fakeBot() {
  const handlers: Record<string, Function> = {};
  return {
    on: (evt: string, h: Function) => {
      handlers[evt] = h;
    },
    command: (name: string, h: Function) => {
      handlers[`command:${name}`] = h;
    },
    api: { answerCallbackQuery: vi.fn(async () => {}) },
    handlers,
  } as any;
}
const sink = () => ({
  onTurn: vi.fn(),
  onInteraction: vi.fn(),
  onCommand: vi.fn(),
  onThreadStarted: vi.fn(),
  onReaction: vi.fn(),
  onModalSubmit: vi.fn(),
  onModalClose: vi.fn(),
});

describe("attachTelegramListener", () => {
  it("routes a DM text message to onTurn", async () => {
    const bot = fakeBot();
    const s = sink();
    attachTelegramListener({
      bot,
      store: new TelegramConversationStore(),
      botUsername: "cpk_bot",
      botUserId: 1,
      sink: s,
      downloadFile: async () => ({ ok: true, bytes: Buffer.from("stub") }),
    });
    await bot.handlers["message:text"]({
      message: {
        text: "hello",
        chat: { id: 9, type: "private" },
        from: { id: 5, first_name: "A" },
        message_id: 2,
      },
      chat: { id: 9, type: "private" },
    });
    expect(s.onTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        userText: "hello",
        conversationKey: "tg:9:dm",
      }),
    );
  });
  it("routes /triage@cpk_bot to onCommand and ignores other bots' commands", async () => {
    const bot = fakeBot();
    const s = sink();
    attachTelegramListener({
      bot,
      store: new TelegramConversationStore(),
      botUsername: "cpk_bot",
      botUserId: 1,
      sink: s,
      downloadFile: async () => ({ ok: true, bytes: Buffer.from("stub") }),
    });
    const mk = (text: string) => ({
      message: {
        text,
        entities: [
          {
            type: "bot_command",
            offset: 0,
            length: (text.split(" ")[0] ?? "").length,
          },
        ],
        chat: { id: 9, type: "group" },
        from: { id: 5, first_name: "A" },
        message_id: 2,
      },
      chat: { id: 9, type: "group" },
    });
    await bot.handlers["message:text"](mk("/triage@cpk_bot do it"));
    expect(s.onCommand).toHaveBeenCalledWith(
      expect.objectContaining({ command: "triage", text: "do it" }),
    );
    s.onCommand.mockClear();
    await bot.handlers["message:text"](mk("/triage@other_bot do it"));
    expect(s.onCommand).not.toHaveBeenCalled();
  });
  it("ignores the bot's own messages (loop guard)", async () => {
    const bot = fakeBot();
    const s = sink();
    attachTelegramListener({
      bot,
      store: new TelegramConversationStore(),
      botUsername: "cpk_bot",
      botUserId: 1,
      sink: s,
      downloadFile: async () => ({ ok: true, bytes: Buffer.from("stub") }),
    });
    await bot.handlers["message:text"]({
      message: {
        text: "hi",
        chat: { id: 9, type: "private" },
        from: { id: 1, first_name: "Bot" },
        message_id: 2,
      },
      chat: { id: 9, type: "private" },
    });
    expect(s.onTurn).not.toHaveBeenCalled();
  });
  it("acks every callback query", async () => {
    const bot = fakeBot();
    const s = sink();
    attachTelegramListener({
      bot,
      store: new TelegramConversationStore(),
      botUsername: "cpk_bot",
      botUserId: 1,
      sink: s,
      downloadFile: async () => ({ ok: true, bytes: Buffer.from("stub") }),
    });
    const ctx: any = {
      update: {
        callback_query: {
          id: "c",
          data: "ck:x",
          from: { id: 5, first_name: "A" },
          message: { message_id: 9, chat: { id: 42, type: "private" } },
        },
      },
      answerCallbackQuery: vi.fn(async () => {}),
    };
    await bot.handlers["callback_query:data"](ctx);
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(s.onInteraction).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ck:x" }),
    );
  });

  // ── Group gating ──────────────────────────────────────────────────────

  it("group plain text without @mention → NOT answered", async () => {
    const bot = fakeBot();
    const s = sink();
    attachTelegramListener({
      bot,
      store: new TelegramConversationStore(),
      botUsername: "cpk_bot",
      botUserId: 1,
      sink: s,
      downloadFile: async () => ({ ok: true, bytes: Buffer.from("stub") }),
    });
    await bot.handlers["message:text"]({
      message: {
        text: "hello everyone",
        chat: { id: 9, type: "group" },
        from: { id: 5, first_name: "A" },
        message_id: 2,
      },
      chat: { id: 9, type: "group" },
    });
    expect(s.onTurn).not.toHaveBeenCalled();
  });

  it("group @mention → answered with stripped text", async () => {
    const bot = fakeBot();
    const s = sink();
    attachTelegramListener({
      bot,
      store: new TelegramConversationStore(),
      botUsername: "cpk_bot",
      botUserId: 1,
      sink: s,
      downloadFile: async () => ({ ok: true, bytes: Buffer.from("stub") }),
    });
    await bot.handlers["message:text"]({
      message: {
        text: "@cpk_bot hello",
        chat: { id: 9, type: "group" },
        from: { id: 5, first_name: "A" },
        message_id: 2,
      },
      chat: { id: 9, type: "group" },
    });
    expect(s.onTurn).toHaveBeenCalledWith(
      expect.objectContaining({ userText: "hello" }),
    );
  });

  it("group reply-to-bot → answered", async () => {
    const bot = fakeBot();
    const s = sink();
    attachTelegramListener({
      bot,
      store: new TelegramConversationStore(),
      botUsername: "cpk_bot",
      botUserId: 1,
      sink: s,
      downloadFile: async () => ({ ok: true, bytes: Buffer.from("stub") }),
    });
    await bot.handlers["message:text"]({
      message: {
        text: "thanks!",
        chat: { id: 9, type: "group" },
        from: { id: 5, first_name: "A" },
        message_id: 3,
        reply_to_message: { from: { id: 1 }, message_id: 2 },
      },
      chat: { id: 9, type: "group" },
    });
    expect(s.onTurn).toHaveBeenCalledWith(
      expect.objectContaining({ userText: "thanks!" }),
    );
  });

  // ── /start command ────────────────────────────────────────────────────

  it("/start in private → onThreadStarted called with dm key", async () => {
    const bot = fakeBot();
    const s = sink();
    attachTelegramListener({
      bot,
      store: new TelegramConversationStore(),
      botUsername: "cpk_bot",
      botUserId: 1,
      sink: s,
      downloadFile: async () => ({ ok: true, bytes: Buffer.from("stub") }),
    });
    await bot.handlers["command:start"]({
      chat: { id: 9, type: "private" },
      message: {
        message_id: 1,
        chat: { id: 9, type: "private" },
        from: { id: 5, first_name: "A" },
      },
    });
    expect(s.onThreadStarted).toHaveBeenCalledWith(
      expect.objectContaining({ conversationKey: "tg:9:dm" }),
    );
  });

  it("/start in group → onThreadStarted NOT called", async () => {
    const bot = fakeBot();
    const s = sink();
    attachTelegramListener({
      bot,
      store: new TelegramConversationStore(),
      botUsername: "cpk_bot",
      botUserId: 1,
      sink: s,
      downloadFile: async () => ({ ok: true, bytes: Buffer.from("stub") }),
    });
    await bot.handlers["command:start"]({
      chat: { id: 9, type: "group" },
      message: {
        message_id: 1,
        chat: { id: 9, type: "group" },
        from: { id: 5, first_name: "A" },
      },
    });
    expect(s.onThreadStarted).not.toHaveBeenCalled();
  });

  // ── Bug 1: is_forum gating of message_thread_id ───────────────────────

  it("non-forum group reply (message_thread_id set, is_forum false) → user key, no messageThreadId", async () => {
    const bot = fakeBot();
    const s = sink();
    attachTelegramListener({
      bot,
      store: new TelegramConversationStore(),
      botUsername: "cpk_bot",
      botUserId: 1,
      sink: s,
      downloadFile: async () => ({ ok: true, bytes: Buffer.from("stub") }),
    });
    await bot.handlers["message:text"]({
      message: {
        text: "thanks!",
        message_thread_id: 150,
        chat: { id: 9, type: "supergroup", is_forum: false },
        from: { id: 5, first_name: "A" },
        message_id: 3,
        reply_to_message: { from: { id: 1 }, message_id: 2 },
      },
      chat: { id: 9, type: "supergroup", is_forum: false },
    });
    expect(s.onTurn).toHaveBeenCalledWith(
      expect.objectContaining({ conversationKey: "tg:9:user:5" }),
    );
    const replyTarget = s.onTurn.mock.calls[0]?.[0]?.replyTarget;
    expect(replyTarget.messageThreadId).toBeUndefined();
  });

  it("forum supergroup @mention (is_forum true) → topic key with messageThreadId set", async () => {
    const bot = fakeBot();
    const s = sink();
    attachTelegramListener({
      bot,
      store: new TelegramConversationStore(),
      botUsername: "cpk_bot",
      botUserId: 1,
      sink: s,
      downloadFile: async () => ({ ok: true, bytes: Buffer.from("stub") }),
    });
    await bot.handlers["message:text"]({
      message: {
        text: "@cpk_bot hello",
        message_thread_id: 77,
        chat: { id: 9, type: "supergroup", is_forum: true },
        from: { id: 5, first_name: "A" },
        message_id: 3,
      },
      chat: { id: 9, type: "supergroup", is_forum: true },
    });
    expect(s.onTurn).toHaveBeenCalledWith(
      expect.objectContaining({ conversationKey: "tg:9:topic:77" }),
    );
    const replyTarget = s.onTurn.mock.calls[0]?.[0]?.replyTarget;
    expect(replyTarget.messageThreadId).toBe(77);
  });

  // ── Bug 2: ack failure must not block dispatch ─────────────────────────

  it("callback ack rejects → onInteraction is STILL called", async () => {
    const bot = fakeBot();
    const s = sink();
    attachTelegramListener({
      bot,
      store: new TelegramConversationStore(),
      botUsername: "cpk_bot",
      botUserId: 1,
      sink: s,
      downloadFile: async () => ({ ok: true, bytes: Buffer.from("stub") }),
    });
    const ctx: any = {
      update: {
        callback_query: {
          id: "c",
          data: "ck:stale",
          from: { id: 5, first_name: "A" },
          message: { message_id: 9, chat: { id: 42, type: "private" } },
        },
      },
      answerCallbackQuery: vi.fn(async () => {
        throw new Error("query is too old");
      }),
    };
    await bot.handlers["callback_query:data"](ctx);
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(s.onInteraction).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ck:stale" }),
    );
  });

  // ── Callback ack even on undecodable payload ──────────────────────────

  it("ack fires even when callback_query has no message (undecodable)", async () => {
    const bot = fakeBot();
    const s = sink();
    attachTelegramListener({
      bot,
      store: new TelegramConversationStore(),
      botUsername: "cpk_bot",
      botUserId: 1,
      sink: s,
      downloadFile: async () => ({ ok: true, bytes: Buffer.from("stub") }),
    });
    // callback_query has data but NO message → decodeInteraction returns undefined
    const ctx: any = {
      update: {
        callback_query: {
          id: "c",
          data: "ck:y",
          from: { id: 5, first_name: "A" },
        },
      },
      answerCallbackQuery: vi.fn(async () => {}),
    };
    await bot.handlers["callback_query:data"](ctx);
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(s.onInteraction).not.toHaveBeenCalled();
  });

  // ── User-message delivery (enqueue) ────────────────────────────────────

  it("DM text enqueues the user message on the store before onTurn", async () => {
    const bot = fakeBot();
    const s = sink();
    const store = new TelegramConversationStore();
    const enqueue = vi.spyOn(store, "enqueueUserMessage");
    attachTelegramListener({
      bot,
      store,
      botUsername: "cpk_bot",
      botUserId: 1,
      sink: s,
      downloadFile: async () => ({ ok: true, bytes: Buffer.from("stub") }),
    });
    await bot.handlers["message:text"]({
      message: {
        text: "hello",
        chat: { id: 9, type: "private" },
        from: { id: 5, first_name: "A" },
        message_id: 2,
      },
      chat: { id: 9, type: "private" },
    });
    expect(enqueue).toHaveBeenCalledWith("tg:9:dm", "hello");
    expect(s.onTurn).toHaveBeenCalled();
  });

  it("commands do NOT enqueue a user message", async () => {
    const bot = fakeBot();
    const s = sink();
    const store = new TelegramConversationStore();
    const enqueue = vi.spyOn(store, "enqueueUserMessage");
    attachTelegramListener({
      bot,
      store,
      botUsername: "cpk_bot",
      botUserId: 1,
      sink: s,
      downloadFile: async () => ({ ok: true, bytes: Buffer.from("stub") }),
    });
    const text = "/triage do it";
    await bot.handlers["message:text"]({
      message: {
        text,
        entities: [
          { type: "bot_command", offset: 0, length: "/triage".length },
        ],
        chat: { id: 9, type: "private" },
        from: { id: 5, first_name: "A" },
        message_id: 2,
      },
      chat: { id: 9, type: "private" },
    });
    expect(s.onCommand).toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("group photo with @mention caption enqueues array content (text + image) and fires onTurn", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: { get: (_: string) => null },
        arrayBuffer: async () => new TextEncoder().encode("JPEGDATA").buffer,
      })) as any,
    );
    const bot = fakeBot();
    const s = sink();
    const store = new TelegramConversationStore();
    const enqueue = vi.spyOn(store, "enqueueUserMessage");
    attachTelegramListener({
      bot,
      store,
      botUsername: "cpk_bot",
      botUserId: 1,
      sink: s,
      downloadFile: async () => ({ ok: true, bytes: Buffer.from("stub") }),
    });
    await bot.handlers["message:photo"]({
      chat: { id: 9, type: "group" },
      message: {
        photo: [{ file_id: "small" }, { file_id: "large" }],
        caption: "@cpk_bot look",
        chat: { id: 9, type: "group" },
        from: { id: 5, first_name: "A" },
        message_id: 2,
      },
    });
    expect(enqueue).toHaveBeenCalledTimes(1);
    const content = enqueue.mock.calls[0]?.[1];
    expect(Array.isArray(content)).toBe(true);
    const arr = content as any[];
    expect(arr[0]).toEqual({ type: "text", text: "look" });
    expect(arr.some((p) => p.type === "image")).toBe(true);
    expect(s.onTurn).toHaveBeenCalledWith(
      expect.objectContaining({ userText: "look" }),
    );
    vi.unstubAllGlobals();
  });

  it("group photo without @mention caption is NOT answered (no enqueue, no onTurn)", async () => {
    const bot = fakeBot();
    const s = sink();
    const store = new TelegramConversationStore();
    const enqueue = vi.spyOn(store, "enqueueUserMessage");
    attachTelegramListener({
      bot,
      store,
      botUsername: "cpk_bot",
      botUserId: 1,
      sink: s,
      downloadFile: async () => ({ ok: true, bytes: Buffer.from("stub") }),
    });
    await bot.handlers["message:photo"]({
      chat: { id: 9, type: "group" },
      message: {
        photo: [{ file_id: "large" }],
        caption: "nice pic",
        chat: { id: 9, type: "group" },
        from: { id: 5, first_name: "A" },
        message_id: 2,
      },
    });
    expect(enqueue).not.toHaveBeenCalled();
    expect(s.onTurn).not.toHaveBeenCalled();
  });

  // ── Bug 1: case-insensitive mention gating ────────────────────────────

  it("group @MyBot (wrong case) with botUsername=mybot → IS answered", async () => {
    const bot = fakeBot();
    const s = sink();
    attachTelegramListener({
      bot,
      store: new TelegramConversationStore(),
      botUsername: "mybot",
      botUserId: 1,
      sink: s,
      downloadFile: async () => ({ ok: true, bytes: Buffer.from("stub") }),
    });
    await bot.handlers["message:text"]({
      message: {
        text: "@MyBot hello",
        chat: { id: 9, type: "group" },
        from: { id: 5, first_name: "A" },
        message_id: 2,
      },
      chat: { id: 9, type: "group" },
    });
    expect(s.onTurn).toHaveBeenCalledWith(
      expect.objectContaining({ userText: "hello" }),
    );
  });

  it("group @mybotextra does NOT match botUsername=mybot (word boundary)", async () => {
    const bot = fakeBot();
    const s = sink();
    attachTelegramListener({
      bot,
      store: new TelegramConversationStore(),
      botUsername: "mybot",
      botUserId: 1,
      sink: s,
      downloadFile: async () => ({ ok: true, bytes: Buffer.from("stub") }),
    });
    await bot.handlers["message:text"]({
      message: {
        text: "@mybotextra hello",
        chat: { id: 9, type: "group" },
        from: { id: 5, first_name: "A" },
        message_id: 2,
      },
      chat: { id: 9, type: "group" },
    });
    expect(s.onTurn).not.toHaveBeenCalled();
  });

  // ── Bug 2: mid-message mention strip ─────────────────────────────────

  it("group mid-message @mention is stripped from userText", async () => {
    const bot = fakeBot();
    const s = sink();
    attachTelegramListener({
      bot,
      store: new TelegramConversationStore(),
      botUsername: "cpk_bot",
      botUserId: 1,
      sink: s,
      downloadFile: async () => ({ ok: true, bytes: Buffer.from("stub") }),
    });
    await bot.handlers["message:text"]({
      message: {
        text: "hey @cpk_bot what's up",
        chat: { id: 9, type: "group" },
        from: { id: 5, first_name: "A" },
        message_id: 2,
      },
      chat: { id: 9, type: "group" },
    });
    expect(s.onTurn).toHaveBeenCalledWith(
      expect.objectContaining({ userText: "hey what's up" }),
    );
  });

  // ── Bug 3: inbound recordMessage ─────────────────────────────────────

  it("inbound DM records the user turn via store.recordMessage with stripped text + ts", async () => {
    const bot = fakeBot();
    const s = sink();
    const store = new TelegramConversationStore();
    const record = vi.spyOn(store, "recordMessage");
    attachTelegramListener({
      bot,
      store,
      botUsername: "cpk_bot",
      botUserId: 1,
      sink: s,
      downloadFile: async () => ({ ok: true, bytes: Buffer.from("stub") }),
    });
    await bot.handlers["message:text"]({
      message: {
        text: "hello bot",
        chat: { id: 9, type: "private" },
        from: { id: 5, first_name: "A" },
        message_id: 2,
      },
      chat: { id: 9, type: "private" },
    });
    expect(record).toHaveBeenCalledWith(
      "tg:9:dm",
      expect.objectContaining({ text: "hello bot", isBot: false, ts: "2" }),
    );
  });

  // ── Bug 1: per-user group conversation keying ─────────────────────────

  it("group @mention records inbound with STRIPPED text (no @mention) and ts", async () => {
    const bot = fakeBot();
    const s = sink();
    const store = new TelegramConversationStore();
    const record = vi.spyOn(store, "recordMessage");
    attachTelegramListener({
      bot,
      store,
      botUsername: "cpk_bot",
      botUserId: 1,
      sink: s,
      downloadFile: async () => ({ ok: true, bytes: Buffer.from("stub") }),
    });
    await bot.handlers["message:text"]({
      message: {
        text: "@cpk_bot hello there",
        chat: { id: 9, type: "group" },
        from: { id: 5, first_name: "A" },
        message_id: 7,
      },
      chat: { id: 9, type: "group" },
    });
    expect(record).toHaveBeenCalledWith(
      "tg:9:user:5",
      expect.objectContaining({ text: "hello there", isBot: false, ts: "7" }),
    );
  });

  it("group @mention twice by same user → SAME conversationKey (continuity)", async () => {
    const bot = fakeBot();
    const s = sink();
    attachTelegramListener({
      bot,
      store: new TelegramConversationStore(),
      botUsername: "cpk_bot",
      botUserId: 1,
      sink: s,
      downloadFile: async () => ({ ok: true, bytes: Buffer.from("stub") }),
    });
    const mk = (message_id: number) => ({
      message: {
        text: "@cpk_bot hi",
        chat: { id: 9, type: "group" },
        from: { id: 5, first_name: "A" },
        message_id,
      },
      chat: { id: 9, type: "group" },
    });
    await bot.handlers["message:text"](mk(10));
    await bot.handlers["message:text"](mk(20));
    expect(s.onTurn).toHaveBeenCalledTimes(2);
    const firstKey = s.onTurn.mock.calls[0]?.[0]?.conversationKey;
    const secondKey = s.onTurn.mock.calls[1]?.[0]?.conversationKey;
    expect(firstKey).toBe("tg:9:user:5");
    expect(secondKey).toBe("tg:9:user:5");
  });

  // ── Bug 2: /start single-dispatch ─────────────────────────────────────

  it("/start text in private fires onThreadStarted only, NOT onCommand", async () => {
    const bot = fakeBot();
    const s = sink();
    attachTelegramListener({
      bot,
      store: new TelegramConversationStore(),
      botUsername: "cpk_bot",
      botUserId: 1,
      sink: s,
      downloadFile: async () => ({ ok: true, bytes: Buffer.from("stub") }),
    });
    // The message:text bot_command branch must return early for /start.
    await bot.handlers["message:text"]({
      message: {
        text: "/start",
        entities: [{ type: "bot_command", offset: 0, length: "/start".length }],
        chat: { id: 9, type: "private" },
        from: { id: 5, first_name: "A" },
        message_id: 2,
      },
      chat: { id: 9, type: "private" },
    });
    expect(s.onCommand).not.toHaveBeenCalled();
    // The dedicated bot.command("start") handler is what emits onThreadStarted.
    await bot.handlers["command:start"]({
      chat: { id: 9, type: "private" },
      message: {
        message_id: 2,
        chat: { id: 9, type: "private" },
        from: { id: 5, first_name: "A" },
      },
    });
    expect(s.onThreadStarted).toHaveBeenCalledTimes(1);
  });

  it("/start@cpk_bot text in group also returns early (no onCommand)", async () => {
    const bot = fakeBot();
    const s = sink();
    attachTelegramListener({
      bot,
      store: new TelegramConversationStore(),
      botUsername: "cpk_bot",
      botUserId: 1,
      sink: s,
      downloadFile: async () => ({ ok: true, bytes: Buffer.from("stub") }),
    });
    await bot.handlers["message:text"]({
      message: {
        text: "/start@cpk_bot",
        entities: [
          { type: "bot_command", offset: 0, length: "/start@cpk_bot".length },
        ],
        chat: { id: 9, type: "group" },
        from: { id: 5, first_name: "A" },
        message_id: 2,
      },
      chat: { id: 9, type: "group" },
    });
    expect(s.onCommand).not.toHaveBeenCalled();
  });

  // ── message_reaction loop guard ───────────────────────────────────────

  it("message_reaction from the bot itself is NOT dispatched to onReaction", async () => {
    const bot = fakeBot();
    const s = sink();
    attachTelegramListener({
      bot,
      store: new TelegramConversationStore(),
      botUsername: "cpk_bot",
      botUserId: 1,
      sink: s,
      downloadFile: async () => ({ ok: true, bytes: Buffer.from("stub") }),
    });
    await bot.handlers["message_reaction"]({
      update: {
        message_reaction: {
          chat: { id: 42, type: "private" },
          message_id: 7,
          user: { id: 1, username: "cpk_bot" },
          old_reaction: [],
          new_reaction: [{ type: "emoji", emoji: "👍" }],
        },
      },
    });
    expect(s.onReaction).not.toHaveBeenCalled();
  });

  it("message_reaction from another user IS dispatched to onReaction", async () => {
    const bot = fakeBot();
    const s = sink();
    attachTelegramListener({
      bot,
      store: new TelegramConversationStore(),
      botUsername: "cpk_bot",
      botUserId: 1,
      sink: s,
      downloadFile: async () => ({ ok: true, bytes: Buffer.from("stub") }),
    });
    await bot.handlers["message_reaction"]({
      update: {
        message_reaction: {
          chat: { id: 42, type: "private" },
          message_id: 7,
          user: { id: 5, username: "ada" },
          old_reaction: [],
          new_reaction: [{ type: "emoji", emoji: "👍" }],
        },
      },
    });
    expect(s.onReaction).toHaveBeenCalledTimes(1);
  });

  // ── Bug 4: empty botUsername guard ────────────────────────────────────

  it("group bare '@' with empty botUsername is NOT answered", async () => {
    const bot = fakeBot();
    const s = sink();
    attachTelegramListener({
      bot,
      store: new TelegramConversationStore(),
      botUsername: "",
      botUserId: 1,
      sink: s,
      downloadFile: async () => ({ ok: true, bytes: Buffer.from("stub") }),
    });
    await bot.handlers["message:text"]({
      message: {
        text: "@ hello",
        chat: { id: 9, type: "group" },
        from: { id: 5, first_name: "A" },
        message_id: 2,
      },
      chat: { id: 9, type: "group" },
    });
    expect(s.onTurn).not.toHaveBeenCalled();
  });
});
