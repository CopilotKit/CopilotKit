import { HttpAgent } from "@ag-ui/client";
import { describe, expect, it } from "vitest";
import { NotionConversationStore } from "./conversation-store.js";
import type { NotionComment, ReplyTarget, RichTextItem } from "./types.js";

const BOT_ID = "bot-1";
const TARGET: ReplyTarget = { pageId: "page-1", discussionId: "disc-1" };

function text(content: string): RichTextItem {
  return { type: "text", text: { content }, plain_text: content };
}

function mention(userId: string, name: string): RichTextItem {
  return {
    type: "mention",
    mention: { type: "user", user: { object: "user", id: userId } },
    plain_text: `@${name}`,
  };
}

let commentSeq = 0;

function comment(authorId: string, richText: RichTextItem[]) {
  commentSeq += 1;
  const value: NotionComment = {
    id: `c${commentSeq}`,
    discussion_id: TARGET.discussionId,
    parent: { type: "page_id", page_id: TARGET.pageId },
    created_by: { object: "user", id: authorId },
    created_time: `2026-11-10T00:00:0${commentSeq % 10}.000Z`,
    rich_text: richText,
  };
  return value;
}

/** Store over a fake Notion discussion that returns `comments` for TARGET only. */
function createStore(
  comments: NotionComment[],
  options: { maxMessages?: number; trigger?: string } = {},
) {
  const client = {
    async listDiscussionComments(pageId: string, discussionId: string) {
      const isTarget =
        pageId === TARGET.pageId && discussionId === TARGET.discussionId;
      return isTarget ? comments : [];
    },
  };
  return new NotionConversationStore({
    client,
    bot: async () => ({ id: BOT_ID, name: "Acme Bot" }),
    ...options,
  });
}

async function historyOf(store: NotionConversationStore) {
  const threadIds: string[] = [];
  const { agent } = await store.getOrCreate("key", TARGET, (threadId) => {
    threadIds.push(threadId);
    return new HttpAgent({ url: "http://agent.test", threadId });
  });
  return { messages: agent.messages, threadIds };
}

describe("NotionConversationStore.getOrCreate", () => {
  it("maps bot comments to assistant and others to user, without the leading bot mention", async () => {
    const first = comment("user-1", [
      mention(BOT_ID, "Helper"),
      text(" summarize this page"),
    ]);
    const reply = comment(BOT_ID, [text("Here is the **summary**.")]);
    const followUp = comment("user-2", [
      text("thanks "),
      mention(BOT_ID, "Helper"),
    ]);
    const store = createStore([first, reply, followUp]);

    const { messages } = await historyOf(store);

    expect(messages).toEqual([
      { id: first.id, role: "user", content: "summarize this page" },
      { id: reply.id, role: "assistant", content: "Here is the **summary**." },
      { id: followUp.id, role: "user", content: "thanks @Helper" },
    ]);
  });

  it("removes the plain-text trigger from user comments, like the turn text", async () => {
    const triggered = comment("user-1", [text("@Acme Bot summarize")]);
    const quoted = comment(BOT_ID, [text("@Acme Bot is me.")]);
    const store = createStore([triggered, quoted]);

    const { messages } = await historyOf(store);

    expect(messages).toEqual([
      { id: triggered.id, role: "user", content: "summarize" },
      { id: quoted.id, role: "assistant", content: "@Acme Bot is me." },
    ]);
  });

  it("skips comments with no text left", async () => {
    const onlyMention = comment("user-1", [mention(BOT_ID, "Helper")]);
    const question = comment("user-1", [text("What changed?")]);
    const store = createStore([onlyMention, question]);

    const { messages } = await historyOf(store);

    expect(messages).toEqual([
      { id: question.id, role: "user", content: "What changed?" },
    ]);
  });

  it("keeps only the last maxMessages comments", async () => {
    const comments = ["one", "two", "three", "four"].map((t) =>
      comment("user-1", [text(t)]),
    );
    const store = createStore(comments, { maxMessages: 2 });

    const { messages } = await historyOf(store);

    expect(messages.map((m) => m.content)).toEqual(["three", "four"]);
  });

  it("uses a fresh notion-<discussionId>-<uuid> thread id per turn", async () => {
    const store = createStore([]);

    const turn1 = await historyOf(store);
    const turn2 = await historyOf(store);

    const threadIds = [...turn1.threadIds, ...turn2.threadIds];
    for (const threadId of threadIds) {
      expect(threadId).toMatch(/^notion-disc-1-[0-9a-f-]{36}$/);
    }
    expect(turn1.threadIds[0]).not.toBe(turn2.threadIds[0]);
    expect(store.seedsInboundTurn).toBe(true);
  });
});

describe("NotionConversationStore inline discussions", () => {
  it("reads the history of an inline comment from its block, not the page", async () => {
    const question = comment("user-1", [text("what is a webhook?")]);
    const client = {
      // Notion lists comments per block: the page itself has none here.
      async listDiscussionComments(blockOrPageId: string) {
        return blockOrPageId === "block-7" ? [question] : [];
      },
    };
    const store = new NotionConversationStore({
      client,
      bot: async () => ({ id: BOT_ID, name: "Acme Bot" }),
    });

    const messages = await store.getMessages({ ...TARGET, blockId: "block-7" });

    expect(messages).toEqual([
      { text: "what is a webhook?", isBot: false, ts: question.created_time },
    ]);
  });
});

describe("NotionConversationStore.getMessages", () => {
  it("returns every comment as text, isBot and ts", async () => {
    const question = comment("user-1", [
      mention(BOT_ID, "Helper"),
      text(" hi"),
    ]);
    const answer = comment(BOT_ID, [text("Hello!")]);
    const store = createStore([question, answer], { maxMessages: 1 });

    const messages = await store.getMessages(TARGET);

    expect(messages).toEqual([
      { text: "hi", isBot: false, ts: question.created_time },
      { text: "Hello!", isBot: true, ts: answer.created_time },
    ]);
  });
});
