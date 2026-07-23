import { describe, it, expect, vi } from "vitest";
import { decideChannelResponse } from "@copilotkit/channels-core";
import { attachTelegramListener } from "../listener.js";
import { TelegramConversationStore } from "../conversation-store.js";
import type { IncomingTurn } from "@copilotkit/channels-core";

/**
 * Proves the Telegram ingress wiring (plan §2, the Telegram analog of
 * `channels-slack/src/__tests__/response-policy-wiring.test.ts`): every turn
 * the listener emits carries the `conversationKind` + `mentioned` the REAL
 * `decideChannelResponse` (channels-core, already unit-tested there) needs to
 * make the correct ignore / handler / auto-run call. This is not a re-test of
 * `decideChannelResponse` itself — it proves the Telegram-side values feed it
 * correctly, end to end from a raw grammY-shaped update through to the
 * engine's decision.
 */

const BOT_USER_ID = 1;
const BOT_USERNAME = "cpk_bot";

function fakeBot() {
  const handlers: Record<string, (ctx: unknown) => unknown> = {};
  return {
    on: (evt: string, h: (ctx: unknown) => unknown) => {
      handlers[evt] = h;
    },
    command: (name: string, h: (ctx: unknown) => unknown) => {
      handlers[`command:${name}`] = h;
    },
    handlers,
  };
}

function setup() {
  const bot = fakeBot();
  const turns: IncomingTurn[] = [];
  attachTelegramListener({
    bot: bot as unknown as Parameters<typeof attachTelegramListener>[0]["bot"],
    store: new TelegramConversationStore(),
    botUsername: BOT_USERNAME,
    botUserId: BOT_USER_ID,
    sink: {
      onTurn: (turn) => {
        turns.push(turn);
      },
      onInteraction: vi.fn(),
      onCommand: vi.fn(),
      onThreadStarted: vi.fn(),
      onReaction: vi.fn(),
      onModalSubmit: vi.fn(),
      onModalClose: vi.fn(),
    },
    downloadFile: async () => ({ ok: true, bytes: Buffer.from("stub") }),
  });
  return {
    turns,
    fireText: (message: Record<string, unknown>) =>
      bot.handlers["message:text"]?.({
        message,
        chat: message.chat,
      }),
  };
}

describe("Telegram ingress → decideChannelResponse (§2 wiring proof)", () => {
  it("a tagged group @mention auto-runs with no handlers", async () => {
    const f = setup();
    await f.fireText({
      text: `@${BOT_USERNAME} hello`,
      chat: { id: 9, type: "group" },
      from: { id: 5, first_name: "A" },
      message_id: 2,
    });
    const turn = f.turns[0]!;
    expect(
      decideChannelResponse({
        conversationKind: turn.conversationKind!,
        mentioned: turn.mentioned ?? false,
        hasMentionHandler: false,
        hasMessageHandler: false,
      }),
    ).toEqual({ action: "auto_run" });
  });

  it("an untagged group message is ignored with no onMessage handler", async () => {
    const f = setup();
    await f.fireText({
      text: "just talking",
      chat: { id: 9, type: "group" },
      from: { id: 5, first_name: "A" },
      message_id: 2,
    });
    const turn = f.turns[0]!;
    expect(
      decideChannelResponse({
        conversationKind: turn.conversationKind!,
        mentioned: turn.mentioned ?? false,
        hasMentionHandler: false,
        hasMessageHandler: false,
      }),
    ).toEqual({ action: "ignore" });
  });

  it("the SAME untagged group message is handled once an onMessage handler is registered", async () => {
    const f = setup();
    await f.fireText({
      text: "just talking",
      chat: { id: 9, type: "group" },
      from: { id: 5, first_name: "A" },
      message_id: 2,
    });
    const turn = f.turns[0]!;
    expect(
      decideChannelResponse({
        conversationKind: turn.conversationKind!,
        mentioned: turn.mentioned ?? false,
        hasMentionHandler: false,
        hasMessageHandler: true,
      }),
    ).toEqual({ action: "handler", handler: "message" });
  });

  it("an untagged forum-topic reply is ignored with no handler, handled once onMessage opts in", async () => {
    const f = setup();
    await f.fireText({
      text: "carry on",
      message_thread_id: 77,
      chat: { id: 9, type: "supergroup", is_forum: true },
      from: { id: 5, first_name: "A" },
      message_id: 3,
    });
    const turn = f.turns[0]!;
    expect(turn.conversationKind).toBe("thread");
    const input = {
      conversationKind: turn.conversationKind!,
      mentioned: turn.mentioned ?? false,
      hasMentionHandler: false,
    };
    expect(
      decideChannelResponse({ ...input, hasMessageHandler: false }),
    ).toEqual({ action: "ignore" });
    expect(
      decideChannelResponse({ ...input, hasMessageHandler: true }),
    ).toEqual({ action: "handler", handler: "message" });
  });

  it("a DM auto-runs regardless of handlers (already directly addressed)", async () => {
    const f = setup();
    await f.fireText({
      text: "hi bot",
      chat: { id: 9, type: "private" },
      from: { id: 5, first_name: "A" },
      message_id: 2,
    });
    const turn = f.turns[0]!;
    expect(
      decideChannelResponse({
        conversationKind: turn.conversationKind!,
        mentioned: turn.mentioned ?? false,
        hasMentionHandler: false,
        hasMessageHandler: false,
      }),
    ).toEqual({ action: "auto_run" });
  });

  it("a group reply-to-bot (no text mention) auto-runs — reply counts as an explicit tag", async () => {
    const f = setup();
    await f.fireText({
      text: "thanks!",
      chat: { id: 9, type: "group" },
      from: { id: 5, first_name: "A" },
      message_id: 3,
      reply_to_message: { from: { id: BOT_USER_ID }, message_id: 2 },
    });
    const turn = f.turns[0]!;
    expect(
      decideChannelResponse({
        conversationKind: turn.conversationKind!,
        mentioned: turn.mentioned ?? false,
        hasMentionHandler: false,
        hasMessageHandler: false,
      }),
    ).toEqual({ action: "auto_run" });
  });
});
