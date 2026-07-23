import { describe, it, expect } from "vitest";
import {
  conversationKeyOf,
  decodeInteraction,
  deriveConversationKey,
} from "../interaction.js";

describe("interaction", () => {
  it("builds the conversation key", () => {
    expect(conversationKeyOf({ chatId: "42", scope: "dm" })).toBe("tg:42:dm");
  });

  it("keys a non-forum group by the sender user (default userId)", () => {
    // No reply, fresh @mention: keyed by sender, not message_id.
    const ck = deriveConversationKey({
      message_id: 100,
      chat: { id: 9, type: "group" },
      from: { id: 5 },
    });
    expect(conversationKeyOf(ck)).toBe("tg:9:user:5");
  });

  it("keys a non-forum group identically across turns from the same user (continuity)", () => {
    const first = deriveConversationKey({
      message_id: 100,
      chat: { id: 9, type: "group" },
      from: { id: 5 },
    });
    const second = deriveConversationKey({
      message_id: 200,
      chat: { id: 9, type: "group" },
      from: { id: 5 },
    });
    expect(conversationKeyOf(first)).toBe(conversationKeyOf(second));
  });

  it("keys a forum supergroup by topic (is_forum: true)", () => {
    const ck = deriveConversationKey({
      message_id: 100,
      message_thread_id: 77,
      chat: { id: 9, type: "supergroup", is_forum: true },
      from: { id: 5 },
    });
    expect(conversationKeyOf(ck)).toBe("tg:9:topic:77");
  });

  it("keys a NON-forum group reply (message_thread_id set, is_forum false) by sender, not topic", () => {
    // Telegram sets message_thread_id on a reply in a regular supergroup — it
    // doubles as the reply-thread id. Without is_forum this must NOT be treated
    // as a topic, or every reply would spawn a new conversation.
    const ck = deriveConversationKey({
      message_id: 200,
      message_thread_id: 150,
      chat: { id: 9, type: "supergroup", is_forum: false },
      reply_to_message: { message_id: 100 },
      from: { id: 5 },
    });
    expect(conversationKeyOf(ck)).toBe("tg:9:user:5");
  });

  it("non-forum group callback omits messageThreadId on replyTarget", () => {
    const evt = decodeInteraction({
      callback_query: {
        id: "cbq3",
        data: "ck:nonforum",
        from: { id: 5, first_name: "Ada", username: "ada" },
        message: {
          message_id: 99,
          message_thread_id: 150,
          chat: { id: 9, type: "supergroup", is_forum: false },
          from: { id: 1, first_name: "Bot" },
        },
      },
    });
    expect(evt?.conversationKey).toBe("tg:9:user:5");
    expect(
      (evt?.replyTarget as { messageThreadId?: number }).messageThreadId,
    ).toBeUndefined();
  });

  it("forum supergroup callback sets messageThreadId on replyTarget", () => {
    const evt = decodeInteraction({
      callback_query: {
        id: "cbq4",
        data: "ck:forum",
        from: { id: 5, first_name: "Ada", username: "ada" },
        message: {
          message_id: 99,
          message_thread_id: 77,
          chat: { id: 9, type: "supergroup", is_forum: true },
          from: { id: 1, first_name: "Bot" },
        },
      },
    });
    expect(evt?.conversationKey).toBe("tg:9:topic:77");
    expect(
      (evt?.replyTarget as { messageThreadId?: number }).messageThreadId,
    ).toBe(77);
  });

  it("group callback_query resolves to the clicking user's key (matches ingress)", () => {
    // message.from is the BOT; cq.from is the clicking user (id 5). The key must
    // use the clicking user so it matches the listener's ingress key tg:9:user:5.
    const evt = decodeInteraction({
      callback_query: {
        id: "cbq2",
        data: "ck:group",
        from: { id: 5, first_name: "Ada", username: "ada" },
        message: {
          message_id: 99,
          chat: { id: 9, type: "group" },
          from: { id: 1, first_name: "Bot" },
        },
      },
    });
    expect(evt?.conversationKey).toBe("tg:9:user:5");
  });
  it("decodes a callback_query into an InteractionEvent", () => {
    const evt = decodeInteraction({
      callback_query: {
        id: "cbq1",
        data: "ck:abc",
        from: { id: 7, first_name: "Ada", username: "ada" },
        message: { message_id: 99, chat: { id: 42, type: "private" } },
      },
    });
    expect(evt?.id).toBe("ck:abc");
    expect(evt?.conversationKey).toBe("tg:42:dm");
    expect(evt?.messageRef).toMatchObject({ chatId: 42, messageId: 99 });
    expect(evt?.user).toMatchObject({ id: "7", name: "Ada", handle: "ada" });
  });
  it("returns undefined for non-callback payloads", () => {
    expect(decodeInteraction({ message: {} })).toBeUndefined();
  });
});
