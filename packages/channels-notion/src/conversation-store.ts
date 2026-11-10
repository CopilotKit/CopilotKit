import { randomUUID } from "node:crypto";
import type { AbstractAgent, Message } from "@ag-ui/client";
import type {
  AgentSession,
  ConversationStore,
} from "@copilotkit/channels-core";
import type { ThreadMessage } from "@copilotkit/channels-ui";
import type { NotionApiClient } from "./client.js";
import {
  addressedText,
  resolveTrigger,
  type NotionBotIdentity,
} from "./ingress.js";
import { richTextToPlainText } from "./render/rich-text.js";
import type { NotionComment, ReplyTarget } from "./types.js";

const DEFAULT_MAX_MESSAGES = 50;

/** Options for {@link NotionConversationStore}. */
export interface NotionConversationStoreOptions {
  /** Notion client that reads the discussion. */
  client: Pick<NotionApiClient, "listDiscussionComments">;
  /** Resolves the integration's bot user. Its comments become assistant messages. */
  bot: () => Promise<NotionBotIdentity>;
  /**
   * Text prefix that makes a comment a turn (default `@<bot name>`). It is
   * removed from user comments, the same way ingress removes it from the turn.
   */
  trigger?: string;
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
 * A leading bot mention or trigger is removed from user comments, so history
 * shows the same text as the turn. The inbound comment is already in the discussion, so the store seeds it
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
  private readonly trigger: string | undefined;
  private readonly maxMessages: number;

  constructor(options: NotionConversationStoreOptions) {
    this.client = options.client;
    this.bot = options.bot;
    this.trigger = options.trigger;
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
    const trigger = resolveTrigger(bot, this.trigger);
    const entries: DiscussionEntry[] = [];
    for (const comment of comments) {
      const entry = toEntry(comment, bot.id, trigger);
      if (entry.text) entries.push(entry);
    }
    return entries;
  }
}

function toEntry(
  comment: NotionComment,
  botId: string,
  trigger: string | undefined,
) {
  const isBot = comment.created_by.id === botId;
  const text = isBot
    ? richTextToPlainText(comment.rich_text)
    : addressedText(comment.rich_text, botId, trigger);
  const entry: DiscussionEntry = {
    id: comment.id,
    text: text.trim(),
    isBot,
    ts: comment.created_time,
  };
  return entry;
}

function toAgentMessage(entry: DiscussionEntry) {
  const message: Message = entry.isBot
    ? { id: entry.id, role: "assistant", content: entry.text }
    : { id: entry.id, role: "user", content: entry.text };
  return message;
}
