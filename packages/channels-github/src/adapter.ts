import { MemoryStore } from "@copilotkit/channels-core";
import type {
  IngressSink,
  PlatformAdapter,
  StateStore,
  SurfaceCapabilities,
  UserQuery,
} from "@copilotkit/channels-core";
import { toCanonicalEmoji } from "@copilotkit/channels-ui";
import type {
  ChannelNode,
  EmojiValue,
  MessageRef,
} from "@copilotkit/channels-ui";
import { createTokenProvider } from "./app-auth.js";
import { GitHubApiClient } from "./client.js";
import type { GitHubCommentRef, GitHubReactionContent } from "./client.js";
import { GitHubConversationStore } from "./conversation-store.js";
import { createRunRenderer as createGitHubRunRenderer } from "./event-renderer.js";
import { handleGitHubEvent } from "./ingress.js";
import { conversationKeyOf, messageRefOf, postedRefOf } from "./interaction.js";
import {
  clearPendingChoices,
  readPendingChoices,
  savePendingChoices,
} from "./pending-choices.js";
import { GITHUB_LIMITS, truncateText } from "./render/budget.js";
import { renderGitHubMessage } from "./render/message.js";
import type { RenderedChoice } from "./render/message.js";
import type {
  GitHubAdapterOptions,
  GitHubMessageRef,
  ReplyTarget,
} from "./types.js";
import { GitHubWebhookServer } from "./webhook-server.js";
import { createWebhookHandler } from "./webhook.js";
import type { GitHubWebhookEvent } from "./webhook.js";

/** Minimum time between two edits of a comment written by `stream()`, in ms. */
const STREAM_EDIT_INTERVAL_MS = 1000;

/** Reaction contents GitHub accepts, in the order GitHub lists them. */
const GITHUB_REACTION_CONTENTS = [
  "+1",
  "-1",
  "laugh",
  "confused",
  "heart",
  "hooray",
  "rocket",
  "eyes",
] as const satisfies readonly GitHubReactionContent[];

/** Canonical channel emoji names that have a GitHub reaction. */
const CANONICAL_TO_GITHUB_REACTION = new Map<string, GitHubReactionContent>([
  ["thumbs_up", "+1"],
  ["thumbs_down", "-1"],
  ["laugh", "laugh"],
  ["smile", "laugh"],
  ["heart", "heart"],
  ["tada", "hooray"],
  ["rocket", "rocket"],
  ["eyes", "eyes"],
]);

/**
 * GitHub reaction for an emoji: a GitHub content name as is (`"+1"`,
 * `"confused"`), or any form of a canonical emoji that has one.
 */
function reactionContentOf(value: EmojiValue) {
  const native = GITHUB_REACTION_CONTENTS.find((content) => content === value);
  return native ?? CANONICAL_TO_GITHUB_REACTION.get(toCanonicalEmoji(value));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** Which comment kind a reply to `target` is: a review reply or an issue comment. */
function commentKindOf(target: ReplyTarget) {
  return target.reviewCommentId === undefined ? "issue" : "review";
}

/** Read a comment ref the adapter returned (or ingress reported) back into a comment and its target. */
function readCommentRef(ref: MessageRef) {
  const commentId = Number(ref.id);
  const { kind, owner, repo, issueNumber, installationId, reviewCommentId } =
    ref;
  const isGitHubRef =
    Number.isSafeInteger(commentId) &&
    (kind === "issue" || kind === "review") &&
    typeof owner === "string" &&
    typeof repo === "string" &&
    typeof issueNumber === "number";
  if (!isGitHubRef) {
    throw new Error(`[channels-github] not a GitHub comment ref: ${ref.id}`);
  }
  const comment: GitHubCommentRef = { kind, commentId };
  const target: ReplyTarget = {
    installationId:
      typeof installationId === "number" ? installationId : undefined,
    owner,
    repo,
    issueNumber,
    reviewCommentId:
      typeof reviewCommentId === "number" ? reviewCommentId : undefined,
  };
  return { comment, target };
}

/**
 * Create a GitHub adapter for `createChannel({ adapters: [...] })`.
 *
 * The bot answers `@mentions` in issue and PR conversations and in PR review
 * threads. Mount `adapter.handleWebhook` in your HTTP framework, or set
 * `port` to run the built-in webhook server.
 *
 * @param opts - Auth (`appId` + `privateKey`, or `token`), `webhookSecret`, `botUsername`, and optional server, API, and state settings.
 *
 * @example
 * ```ts
 * const adapter = github({
 *   appId: process.env.GITHUB_APP_ID!,
 *   privateKey: process.env.GITHUB_PRIVATE_KEY!,
 *   webhookSecret: process.env.GITHUB_WEBHOOK_SECRET!,
 *   botUsername: "my-app",
 *   port: 3000,
 * });
 * const channel = createChannel({ identifyUser: "platform", adapters: [adapter], agent });
 * channel.onMention(({ thread }) => thread.runAgent());
 * ```
 */
export function github(opts: GitHubAdapterOptions) {
  return new GitHubAdapter(opts);
}

/**
 * GitHub {@link PlatformAdapter}: issue comments, PR conversation comments,
 * and PR review threads.
 *
 * - Ingress: `issue_comment.created` and `pull_request_review_comment.created`
 *   webhooks that mention the bot become turns. A reply to an open numbered
 *   choice list becomes an interaction, so `thread.awaitChoice` and button
 *   handlers work.
 * - Egress: GitHub-flavored Markdown comments. Agent replies stream through
 *   throttled comment edits; the trigger comment gets an `eyes` reaction while
 *   the agent writes.
 * - History: every turn rebuilds the agent's messages from the comments on
 *   GitHub.
 */
export class GitHubAdapter implements PlatformAdapter {
  readonly platform = "github";
  readonly capabilities: SurfaceCapabilities = {
    supportsMessageEvents: true,
    supportsModals: false,
    supportsTyping: true,
    supportsReactions: true,
    supportsStreaming: true,
    supportsEphemeral: false,
    supportsBlockingChoice: true,
  };
  readonly ackDeadlineMs = 10000;
  readonly conversationStore: GitHubConversationStore;
  /** The GitHub REST client the adapter posts with. */
  readonly client: GitHubApiClient;
  /**
   * Web-standard webhook handler. It verifies `X-Hub-Signature-256` and reads
   * the delivery's state (the open choice list) before it answers. When that
   * read fails, it answers `500`. Otherwise it answers `200` and routes the
   * delivery to the channel in the background. GitHub does not retry a failed
   * delivery by itself, but you can redeliver it from the webhook settings.
   * Mount it in Hono, Next.js route handlers, Workers, or any `Request` host.
   * Deliveries that arrive before `start()` or after `stop()` are dropped.
   *
   * @example
   * ```ts
   * app.post("/github/webhook", (c) => adapter.handleWebhook(c.req.raw));
   * ```
   */
  readonly handleWebhook: (request: Request) => Promise<Response>;

  private readonly opts: GitHubAdapterOptions;
  /** Adapter-private state (pending choice lists). Not the channel's store. */
  private readonly state: StateStore;
  private readonly server: GitHubWebhookServer;
  private sink: IngressSink | undefined;
  private postingLogin: Promise<string> | undefined;

  constructor(opts: GitHubAdapterOptions) {
    this.opts = opts;
    this.state = opts.stateStore ?? new MemoryStore();
    this.client = new GitHubApiClient({
      auth: createTokenProvider(opts),
      apiBaseUrl: opts.apiBaseUrl,
      fetch: opts.fetch,
    });
    this.conversationStore = new GitHubConversationStore({
      client: this.client,
      botLogin: () => this.botPostingLogin(),
      botUsername: opts.botUsername,
    });
    this.handleWebhook = createWebhookHandler({
      secret: opts.webhookSecret,
      onEvent: (event) => this.onEvent(event),
    });
    this.server = new GitHubWebhookServer({
      handler: this.handleWebhook,
      path: opts.path,
    });
  }

  /** Begin routing deliveries to `sink`, and start the built-in server when `port` is set. */
  async start(sink: IngressSink) {
    this.sink = sink;
    const port = this.opts.port;
    if (port === undefined) return;
    await this.server.start(port);
  }

  /** Stop routing deliveries and stop the built-in server. */
  async stop() {
    this.sink = undefined;
    await this.server.stop();
  }

  /** Lower channel IR to a comment body plus its numbered choices. */
  render(ir: ChannelNode[]) {
    return renderGitHubMessage(ir);
  }

  /**
   * Post `ir` as a new comment. A comment with a numbered choice list becomes
   * the conversation's pending choice list, so a numbered reply answers it.
   */
  async post(target: ReplyTarget, ir: ChannelNode[]) {
    const { body, choices } = this.render(ir);
    const created = await this.createComment(target, body);
    const comment: GitHubCommentRef = {
      kind: commentKindOf(target),
      commentId: created.id,
    };
    await this.refreshPendingChoices(target, comment, choices);
    return messageRefOf(postedRefOf(target, comment));
  }

  /** Edit a comment the adapter posted, and refresh its pending choice list. */
  async update(ref: MessageRef, ir: ChannelNode[]) {
    const { comment, target } = readCommentRef(ref);
    const { body, choices } = this.render(ir);
    await this.updateComment(target, comment, body);
    await this.refreshPendingChoices(target, comment, choices);
  }

  /**
   * Stream text into one comment: the first non-empty chunk creates it, later
   * chunks edit it at most once per second, and the full text is written at
   * the end. Text longer than a comment is truncated.
   *
   * @throws Error when `chunks` holds no text (GitHub rejects empty comments).
   */
  async stream(target: ReplyTarget, chunks: AsyncIterable<string>) {
    let text = "";
    let comment: GitHubCommentRef | undefined;
    let postedBody = "";
    let lastWriteAt = 0;
    for await (const chunk of chunks) {
      text += chunk;
      if (text.trim() === "") continue;
      const body = truncateText(text, GITHUB_LIMITS.commentBody);
      if (comment === undefined) {
        const created = await this.createComment(target, body);
        comment = { kind: commentKindOf(target), commentId: created.id };
      } else {
        const isUnchanged = body === postedBody;
        const isTooSoon = Date.now() - lastWriteAt < STREAM_EDIT_INTERVAL_MS;
        if (isUnchanged || isTooSoon) continue;
        await this.updateComment(target, comment, body);
      }
      postedBody = body;
      lastWriteAt = Date.now();
    }
    if (comment === undefined) {
      throw new Error(
        "[channels-github] stream() got no text; GitHub cannot post an empty comment",
      );
    }
    const finalBody = truncateText(text, GITHUB_LIMITS.commentBody);
    if (finalBody !== postedBody) {
      await this.updateComment(target, comment, finalBody);
    }
    return messageRefOf(postedRefOf(target, comment));
  }

  /** Delete a comment the adapter posted, and drop its pending choice list. */
  async delete(ref: MessageRef) {
    const { comment, target } = readCommentRef(ref);
    if (comment.kind === "issue") {
      await this.client.deleteIssueComment(target, comment.commentId);
    } else {
      await this.client.deleteReviewComment(target, comment.commentId);
    }
    await this.refreshPendingChoices(target, comment, []);
  }

  /** The AG-UI run renderer for one turn. It reacts `eyes` on the trigger comment. */
  createRunRenderer(target: ReplyTarget) {
    const triggerCommentRef: GitHubCommentRef | undefined =
      target.triggerCommentId === undefined
        ? undefined
        : { kind: commentKindOf(target), commentId: target.triggerCommentId };
    return createGitHubRunRenderer({
      client: this.client,
      target,
      triggerCommentRef,
      interruptEventNames: this.opts.interruptEventNames,
    });
  }

  /**
   * Always `undefined`. GitHub has no interactive controls: a numbered reply
   * to a choice list arrives as a comment webhook, and ingress decodes it
   * into an interaction there.
   */
  decodeInteraction(_raw: unknown) {
    return undefined;
  }

  /** Always `undefined`. The adapter does not search GitHub users. */
  async lookupUser(_q: UserQuery) {
    return undefined;
  }

  /** The conversation's comments, oldest first, read from GitHub. */
  async getMessages(target: ReplyTarget) {
    return this.conversationStore.getMessages(target);
  }

  /**
   * React on a comment. Accepts GitHub content names (`"+1"`, `"confused"`)
   * and the channel emoji that have a GitHub reaction (`thumbs_up`,
   * `thumbs_down`, `laugh`, `smile`, `heart`, `tada`, `rocket`, `eyes`).
   */
  async addReaction(
    target: ReplyTarget,
    messageRef: MessageRef,
    emoji: EmojiValue,
  ) {
    const content = reactionContentOf(emoji);
    if (content === undefined) return this.unsupportedReaction(emoji);
    try {
      const { comment } = readCommentRef(messageRef);
      await this.client.addReaction(target, comment, content);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  /**
   * Remove the bot's reaction from a comment. GitHub answers a repeated
   * reaction POST with the existing reaction, which gives its id for the
   * delete.
   */
  async removeReaction(
    target: ReplyTarget,
    messageRef: MessageRef,
    emoji: EmojiValue,
  ) {
    const content = reactionContentOf(emoji);
    if (content === undefined) return this.unsupportedReaction(emoji);
    try {
      const { comment } = readCommentRef(messageRef);
      const reactionId = await this.client.addReaction(
        target,
        comment,
        content,
      );
      await this.client.removeReaction(target, comment, reactionId);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }

  private unsupportedReaction(emoji: EmojiValue) {
    return {
      ok: false,
      error: `GitHub has no "${emoji}" reaction. Use one of: ${GITHUB_REACTION_CONTENTS.join(", ")}`,
    };
  }

  private async onEvent(event: GitHubWebhookEvent) {
    const sink = this.sink;
    if (sink === undefined) return undefined;
    return handleGitHubEvent(event, {
      sink,
      stateStore: this.state,
      botLogin: () => this.opts.botUsername,
    });
  }

  /**
   * The exact login the bot posts as (`<slug>[bot]` for an App), read once
   * from GitHub. History needs it to tell the bot's comments apart.
   */
  private botPostingLogin() {
    this.postingLogin ??= this.client
      .getAuthenticatedBotLogin()
      .catch((error: unknown) => {
        this.postingLogin = undefined;
        throw error;
      });
    return this.postingLogin;
  }

  private createComment(target: ReplyTarget, body: string) {
    const reviewCommentId = target.reviewCommentId;
    if (reviewCommentId === undefined) {
      return this.client.createIssueComment(target, body);
    }
    return this.client.replyToReviewComment(target, reviewCommentId, body);
  }

  private async updateComment(
    target: ReplyTarget,
    comment: GitHubCommentRef,
    body: string,
  ) {
    if (comment.kind === "issue") {
      await this.client.updateIssueComment(target, comment.commentId, body);
      return;
    }
    await this.client.updateReviewComment(target, comment.commentId, body);
  }

  /**
   * Keep the conversation's pending choice list in line with `comment`: a
   * comment with choices becomes the list; a comment that was the list and
   * has no choices now (edited or deleted) clears it.
   */
  private async refreshPendingChoices(
    target: ReplyTarget,
    comment: GitHubCommentRef,
    choices: RenderedChoice[],
  ) {
    const key = conversationKeyOf(target);
    if (choices.length > 0) {
      await savePendingChoices(this.state, key, {
        messageRef: postedRefOf(target, comment),
        choices,
      });
      return;
    }
    const pending = await readPendingChoices(this.state, key);
    if (pending?.messageRef.id === comment.commentId) {
      await clearPendingChoices(this.state, key);
    }
  }
}
