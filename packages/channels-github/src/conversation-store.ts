import { randomUUID } from "node:crypto";
import type { AbstractAgent, Message } from "@ag-ui/client";
import type { ConversationStore } from "@copilotkit/channels-core";
import type { ThreadMessage } from "@copilotkit/channels-ui";
import type { GitHubApiClient } from "./client.js";
import type { GitHubComment, ReplyTarget } from "./types.js";

const DEFAULT_MAX_MESSAGES = 50;

/** Options for {@link GitHubConversationStore}. */
export interface GitHubConversationStoreOptions {
  /** GitHub REST client that reads the issue comments and review threads. */
  client: GitHubApiClient;
  /** Resolves the login the bot posts as (`<slug>[bot]` for a GitHub App). Its comments become assistant messages. */
  botLogin: () => Promise<string>;
  /** Keep only the newest N messages of a conversation (default 50). */
  maxMessages?: number;
}

interface TranscriptEntry {
  comment: GitHubComment;
  text: string;
  isBot: boolean;
}

/** Lowercase a login and drop a leading `@` and a trailing `[bot]`. */
function botSlugOf(login: string) {
  return login
    .trim()
    .replace(/^@/, "")
    .replace(/\[bot\]$/i, "")
    .toLowerCase();
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Remove every `@slug` / `@slug[bot]` mention of the bot from `body`, the
 * same way ingress does, so history text matches the turn text the agent got.
 */
function stripBotMention(body: string, slug: string) {
  const mention = new RegExp(
    `(^|[^\\w-])@${escapeRegExp(slug)}(?:\\[bot\\])?(?![\\w-])[:,]?[ \\t]*`,
    "gi",
  );
  return body.replace(mention, "$1").trim();
}

/**
 * Conversation store backed by GitHub itself.
 *
 * Every turn rebuilds the agent's history from the conversation's comments:
 * the issue or PR conversation, or the PR review thread when the target has a
 * `reviewCommentId`. Comments by the bot become assistant messages. Other
 * comments become user messages, with the bot mention removed. Empty comments
 * are skipped, and only the newest `maxMessages` are kept.
 *
 * Each turn gets a fresh AG-UI `threadId`, so agent backends never see
 * internal (tool) messages of an earlier turn that GitHub does not hold.
 * The triggering comment is already on GitHub, so the store seeds the
 * inbound turn (`seedsInboundTurn = true`).
 *
 * A failed GitHub read is thrown, because a turn without its history would
 * also be missing the user's message.
 *
 * @example
 * ```ts
 * const store = new GitHubConversationStore({ client, botLogin: () => client.getAuthenticatedBotLogin() });
 * const { agent } = await store.getOrCreate(key, target, (threadId) => new HttpAgent({ url, threadId }));
 * ```
 */
export class GitHubConversationStore implements ConversationStore {
  readonly seedsInboundTurn = true;
  private readonly client: GitHubApiClient;
  private readonly botLogin: () => Promise<string>;
  private readonly maxMessages: number;

  constructor(options: GitHubConversationStoreOptions) {
    this.client = options.client;
    this.botLogin = options.botLogin;
    this.maxMessages = options.maxMessages ?? DEFAULT_MAX_MESSAGES;
  }

  /**
   * Build the agent for one turn, with its messages rebuilt from GitHub.
   *
   * @param _conversationKey - Unused; the reply target names the conversation.
   * @param target - The issue, PR, or review thread of the turn.
   * @param makeAgent - Makes the agent for the turn's fresh thread id.
   */
  async getOrCreate(
    _conversationKey: string,
    target: ReplyTarget,
    makeAgent: (threadId: string) => AbstractAgent,
  ) {
    const threadId = `github-${target.owner}-${target.repo}-${target.issueNumber}-${randomUUID()}`;
    const agent = makeAgent(threadId);
    const transcript = await this.transcriptOf(target);
    agent.messages = transcript.map(toAgentMessage);
    return { agent, threadId };
  }

  /**
   * The conversation's messages, oldest first, to back `Thread.getMessages()`.
   *
   * @param target - The issue, PR, or review thread to read.
   */
  async getMessages(target: ReplyTarget) {
    const transcript = await this.transcriptOf(target);
    return transcript.map((entry) => {
      const message: ThreadMessage = {
        text: entry.text,
        isBot: entry.isBot,
        ts: entry.comment.created_at,
      };
      return message;
    });
  }

  private async commentsOf(target: ReplyTarget) {
    const reviewCommentId = target.reviewCommentId;
    if (reviewCommentId === undefined) {
      return this.client.listIssueComments(target);
    }
    return this.client.listReviewThread(target, reviewCommentId);
  }

  private async transcriptOf(target: ReplyTarget) {
    const [login, comments] = await Promise.all([
      this.botLogin(),
      this.commentsOf(target),
    ]);
    const botLogin = login.toLowerCase();
    const slug = botSlugOf(login);
    const entries: TranscriptEntry[] = [];
    for (const comment of comments) {
      const isBot = comment.user.login.toLowerCase() === botLogin;
      const text = isBot
        ? comment.body.trim()
        : stripBotMention(comment.body, slug);
      if (text.length === 0) continue;
      entries.push({ comment, text, isBot });
    }
    return entries.slice(-this.maxMessages);
  }
}

function toAgentMessage(entry: TranscriptEntry) {
  const id = `github-comment-${entry.comment.id}`;
  const message: Message = entry.isBot
    ? { id, role: "assistant", content: entry.text }
    : { id, role: "user", content: entry.text };
  return message;
}
