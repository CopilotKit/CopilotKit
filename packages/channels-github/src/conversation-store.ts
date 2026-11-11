import { randomUUID } from "node:crypto";
import type { AbstractAgent, Message } from "@ag-ui/client";
import type { ConversationStore } from "@copilotkit/channels-core";
import type { ThreadMessage } from "@copilotkit/channels-ui";
import { isOwnComment, stripBotMarker } from "./bot-marker.js";
import type { GitHubApiClient } from "./client.js";
import { botSlugOf, stripBotMention } from "./ingress.js";
import { truncateText } from "./render/budget.js";
import type { GitHubComment, GitHubIssue, ReplyTarget } from "./types.js";

const DEFAULT_MAX_MESSAGES = 50;
/** Max characters of the issue or PR description in the context message. */
const DESCRIPTION_MAX = 8000;
/** Diff hunk lines kept in the context message, counted back from the commented line. */
const DIFF_HUNK_MAX_LINES = 60;

/** Options for {@link GitHubConversationStore}. */
export interface GitHubConversationStoreOptions {
  /** GitHub REST client that reads the issue comments and review threads. */
  client: GitHubApiClient;
  /**
   * Resolves the login the bot posts as (`<slug>[bot]` for a GitHub App). Its
   * comments with the hidden bot marker become assistant messages.
   */
  botLogin: () => Promise<string>;
  /** The name users mention (`botUsername`). The mention is removed from user messages. */
  botUsername: string;
  /** Keep only the newest N messages of a conversation (default 50). */
  maxMessages?: number;
}

interface TranscriptEntry {
  comment: GitHubComment;
  text: string;
  isBot: boolean;
}

/**
 * Conversation store backed by GitHub itself.
 *
 * Every turn rebuilds the agent's history from the conversation's comments:
 * the issue or PR conversation, or the PR review thread when the target has a
 * `reviewCommentId`. The adapter's own comments (see `isOwnComment`) become
 * assistant messages. Other comments become user messages, with the bot
 * mention removed. Empty comments are skipped, and only the newest
 * `maxMessages` are kept.
 *
 * The history starts with one context message: the issue or PR number, title,
 * URL, and description. For a review thread, it also names the file and line
 * and holds the diff hunk the thread is on.
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
  private readonly botUsername: string;
  private readonly maxMessages: number;

  constructor(options: GitHubConversationStoreOptions) {
    this.client = options.client;
    this.botLogin = options.botLogin;
    this.botUsername = options.botUsername;
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
    const [{ transcript, comments }, issue] = await Promise.all([
      this.readConversation(target),
      this.client.getIssue(target),
    ]);
    const reviewRoot = comments.find(
      (comment) => comment.id === target.reviewCommentId,
    );
    agent.messages = [
      contextMessage(target, issue, reviewRoot),
      ...transcript.map(toAgentMessage),
    ];
    return { agent, threadId };
  }

  /**
   * The conversation's messages, oldest first, to back `Thread.getMessages()`.
   *
   * @param target - The issue, PR, or review thread to read.
   */
  async getMessages(target: ReplyTarget) {
    const { transcript } = await this.readConversation(target);
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

  private async readConversation(target: ReplyTarget) {
    const [postingLogin, comments] = await Promise.all([
      this.botLogin(),
      this.commentsOf(target),
    ]);
    const slug = botSlugOf(this.botUsername);
    const entries: TranscriptEntry[] = [];
    for (const comment of comments) {
      const isBot = isOwnComment(comment, postingLogin);
      const text = isBot
        ? stripBotMarker(comment.body)
        : stripBotMention(comment.body, slug).text;
      if (text.length === 0) continue;
      entries.push({ comment, text, isBot });
    }
    return { transcript: entries.slice(-this.maxMessages), comments };
  }
}

/**
 * The first message of every turn: what the conversation is about. The
 * comments alone do not hold the issue description or the reviewed code.
 *
 * @param target - The conversation of the turn.
 * @param issue - The issue or pull request.
 * @param reviewRoot - The root comment of the review thread, when the turn is in one.
 */
export function contextMessage(
  target: ReplyTarget,
  issue: GitHubIssue,
  reviewRoot: GitHubComment | undefined,
) {
  const kind = issue.pull_request === undefined ? "Issue" : "Pull request";
  const description = issue.body?.trim()
    ? truncateText(issue.body.trim(), DESCRIPTION_MAX)
    : "(no description)";
  const parts = [
    "Context from GitHub for this conversation:",
    `${kind} #${issue.number} in ${target.owner}/${target.repo}: ${issue.title}`,
    issue.html_url,
    `Description:\n${description}`,
  ];
  if (reviewRoot?.path !== undefined) {
    const line = reviewRoot.line ?? reviewRoot.original_line;
    const where =
      line === null || line === undefined
        ? `\`${reviewRoot.path}\``
        : `\`${reviewRoot.path}\`, line ${line}`;
    parts.push(`This review thread is on ${where}.`);
    if (reviewRoot.diff_hunk) {
      const hunk = reviewRoot.diff_hunk
        .split("\n")
        .slice(-DIFF_HUNK_MAX_LINES)
        .join("\n");
      parts.push(`The diff up to that line:\n\`\`\`diff\n${hunk}\n\`\`\``);
    }
  }
  const message: Message = {
    id: `github-context-${target.owner}-${target.repo}-${target.issueNumber}`,
    role: "user",
    content: parts.join("\n\n"),
  };
  return message;
}

function toAgentMessage(entry: TranscriptEntry) {
  const id = `github-comment-${entry.comment.id}`;
  const message: Message = entry.isBot
    ? { id, role: "assistant", content: entry.text }
    : { id, role: "user", content: entry.text };
  return message;
}
