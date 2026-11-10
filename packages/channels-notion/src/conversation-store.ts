import { randomUUID } from "node:crypto";
import type { AbstractAgent, Message } from "@ag-ui/client";
import type {
  AgentSession,
  ConversationStore,
} from "@copilotkit/channels-core";
import type { ThreadMessage } from "@copilotkit/channels-ui";
import type { NotionApiClient } from "./client.js";
import { richTextToPlainText } from "./render/rich-text.js";
import type { NotionComment, ReplyTarget, RichTextItem } from "./types.js";

const DEFAULT_MAX_MESSAGES = 50;

/** Options for {@link NotionConversationStore}. */
export interface NotionConversationStoreOptions {
  /** Notion client that reads the discussion. */
  client: Pick<NotionApiClient, "listDiscussionComments">;
  /** Resolves the integration's bot user. Its comments become assistant messages. */
  bot: () => Promise<{ id: string }>;
  /** Most recent messages kept in the agent history (default 50). */
  maxMessages?: number;
}

/** One discussion comment as conversation history. */
interface DiscussionEntry {
  id: string;
  text: string;
  isBot: boolean;
  ts: string;
}

/**
 * Conversation store backed by the Notion discussion itself.
 *
 * Every turn gets a fresh agent `threadId` (`notion-<discussionId>-<uuid>`),
 * and `agent.messages` is rebuilt from the discussion's comments: the bot's
 * comments become assistant messages, everyone else's become user messages.
 * The inbound comment is already in the discussion, so the store seeds it
 * (`seedsInboundTurn`).
 *
 * Notion lists only un-resolved comments, so a resolved discussion has no
 * history.
 *
 * @example
 * const store = new NotionConversationStore({ client, bot: () => client.getBotUser() });
 * const { agent } = await store.getOrCreate(key, target, makeAgent);
 */
export class NotionConversationStore implements ConversationStore {
  readonly seedsInboundTurn = true;
  private readonly client: NotionConversationStoreOptions["client"];
  private readonly bot: NotionConversationStoreOptions["bot"];
  private readonly maxMessages: number;

  constructor(options: NotionConversationStoreOptions) {
    this.client = options.client;
    this.bot = options.bot;
    this.maxMessages = options.maxMessages ?? DEFAULT_MAX_MESSAGES;
  }

  /**
   * Make the agent for one turn, with history from the discussion.
   *
   * @param _conversationKey Engine conversation key (unused: the target names the discussion).
   * @param target Discussion to read.
   * @param makeAgent Builds the agent for a thread id.
   */
  async getOrCreate(
    _conversationKey: string,
    target: ReplyTarget,
    makeAgent: (threadId: string) => AbstractAgent,
  ) {
    const threadId = `notion-${target.discussionId}-${randomUUID()}`;
    const agent = makeAgent(threadId);
    const entries = await this.readDiscussion(target);
    const recent = entries.slice(-this.maxMessages);
    agent.messages = recent.map(toAgentMessage);
    const session: AgentSession = { agent };
    return session;
  }

  /** Back `Thread.getMessages()` with the discussion's comments, oldest first. */
  async getMessages(target: ReplyTarget) {
    const entries = await this.readDiscussion(target);
    return entries.map(
      (entry): ThreadMessage => ({
        text: entry.text,
        isBot: entry.isBot,
        ts: entry.ts,
      }),
    );
  }

  private async readDiscussion(target: ReplyTarget) {
    const [bot, comments] = await Promise.all([
      this.bot(),
      this.client.listDiscussionComments(target.pageId, target.discussionId),
    ]);
    const entries: DiscussionEntry[] = [];
    for (const comment of comments) {
      const entry = toEntry(comment, bot.id);
      if (entry.text) entries.push(entry);
    }
    return entries;
  }
}

function toEntry(comment: NotionComment, botId: string) {
  const isBot = comment.created_by.id === botId;
  const richText = isBot
    ? comment.rich_text
    : dropLeadingBotMention(comment.rich_text, botId);
  const entry: DiscussionEntry = {
    id: comment.id,
    text: richTextToPlainText(richText).trim(),
    isBot,
    ts: comment.created_time,
  };
  return entry;
}

/** Remove a mention of the bot when it is the first item of the comment. */
function dropLeadingBotMention(items: RichTextItem[], botId: string) {
  const [first, ...rest] = items;
  const isBotMention =
    first?.type === "mention" &&
    first.mention.type === "user" &&
    first.mention.user.id === botId;
  return isBotMention ? rest : items;
}

function toAgentMessage(entry: DiscussionEntry) {
  const message: Message = entry.isBot
    ? { id: entry.id, role: "assistant", content: entry.text }
    : { id: entry.id, role: "user", content: entry.text };
  return message;
}
