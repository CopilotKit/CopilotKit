import { MemoryStore } from "@copilotkit/channels-core";
import type {
  IngressSink,
  PlatformAdapter,
  StateStore,
  SurfaceCapabilities,
  UserQuery,
} from "@copilotkit/channels-core";
import type { ChannelNode } from "@copilotkit/channels-ui";
import { NotionApiClient } from "./client.js";
import {
  clearPendingChoices,
  markJoined,
  readPendingChoices,
  savePendingChoices,
} from "./conversation-state.js";
import { NotionConversationStore } from "./conversation-store.js";
import { createRunRenderer } from "./event-renderer.js";
import { handleNotionEvent } from "./ingress.js";
import type { NotionBotIdentity } from "./ingress.js";
import { NOTION_LIMITS, truncateText } from "./render/budget.js";
import { renderNotionMessage } from "./render/message.js";
import type { RenderedChoice } from "./render/message.js";
import { markdownToRichText } from "./render/rich-text.js";
import type {
  NotionAdapterOptions,
  NotionMessageRef,
  NotionWebhookEvent,
  ReplyTarget,
} from "./types.js";
import { createWebhookHandler } from "./webhook.js";
import { NotionWebhookServer } from "./webhook-server.js";

/** Smallest gap between two edits of a comment written by `stream()`, in ms. */
const STREAM_THROTTLE_MS = 1000;

/**
 * Create the Notion comments adapter for `createChannel({ adapters })`.
 *
 * @param opts - Integration token, webhook verification token, and options.
 * @example
 * const channel = createChannel({
 *   adapters: [
 *     notion({
 *       token: process.env.NOTION_TOKEN!,
 *       verificationToken: process.env.NOTION_VERIFICATION_TOKEN,
 *       port: 3000,
 *     }),
 *   ],
 *   agent,
 * });
 */
export function notion(opts: NotionAdapterOptions) {
  return new NotionAdapter(opts);
}

/**
 * Notion comments as a channel surface.
 *
 * A comment is a turn when it mentions the bot, starts with the trigger text
 * (default `@<bot name>`), or is in a discussion the bot already replied in.
 * Replies go to the same discussion. Agent text streams by editing one comment
 * about once per second. Buttons and selects render as a numbered list, and a
 * reply with a number (or the option label) picks the option, so
 * `thread.awaitChoice` and `onClick` work.
 *
 * Inbound events arrive through {@link NotionAdapter.handleWebhook}. Mount it
 * in your HTTP framework, or set `port` to run the built-in `node:http` server.
 */
export class NotionAdapter implements PlatformAdapter {
  readonly platform = "notion";
  readonly capabilities: SurfaceCapabilities = {
    supportsMessageEvents: true,
    supportsModals: false,
    supportsTyping: false,
    supportsReactions: false,
    supportsStreaming: true,
    supportsEphemeral: false,
    supportsBlockingChoice: true,
  };
  readonly ackDeadlineMs = 10_000;
  readonly conversationStore: NotionConversationStore;
  /** The Notion API client the adapter uses. */
  readonly client: NotionApiClient;
  /**
   * Fetch-style handler for Notion webhook POSTs. It checks the
   * `X-Notion-Signature` header, answers 200 at once, and routes
   * `comment.created` events to the channel. Events that arrive before
   * `start()` are dropped.
   *
   * @example
   * app.post("/webhook", (c) => adapter.handleWebhook(c.req.raw));
   */
  readonly handleWebhook: (request: Request) => Promise<Response>;

  /** Joined discussions and pending choices. Not the engine's `stateStore`. */
  private readonly state: StateStore;
  private server: NotionWebhookServer | undefined;
  private botUser: Promise<NotionBotIdentity> | undefined;
  private sink: IngressSink | undefined;

  constructor(private readonly opts: NotionAdapterOptions) {
    this.client = new NotionApiClient(opts);
    this.state = opts.stateStore ?? new MemoryStore();
    this.conversationStore = new NotionConversationStore({
      client: this.client,
      bot: this.bot,
      trigger: opts.trigger,
    });
    this.handleWebhook = createWebhookHandler({
      verificationToken: opts.verificationToken,
      onVerificationToken: opts.onVerificationToken,
      onEvent: (event) => this.onEvent(event),
    });
  }

  /** Keep the sink, and start the built-in webhook server when `port` is set. */
  async start(sink: IngressSink) {
    this.sink = sink;
    const port = this.opts.port;
    if (port === undefined || this.server) return;
    const server = new NotionWebhookServer({
      handler: this.handleWebhook,
      path: this.opts.path,
    });
    await server.start(port);
    this.server = server;
  }

  /** Stop the built-in webhook server, and drop later events. */
  async stop() {
    this.sink = undefined;
    const server = this.server;
    this.server = undefined;
    await server?.stop();
  }

  render(ir: ChannelNode[]) {
    return renderNotionMessage(ir);
  }

  /**
   * Post the IR as a new comment in the target discussion. The discussion
   * becomes joined. When the IR has buttons or selects, the numbered choices
   * are stored so a later numbered reply picks one.
   */
  async post(target: ReplyTarget, ir: ChannelNode[]) {
    const { richText, choices } = this.render(ir);
    const comment = await this.client.createComment({
      discussionId: target.discussionId,
      richText,
    });
    const ref: NotionMessageRef = {
      id: comment.id,
      discussionId: target.discussionId,
    };
    await markJoined(this.state, target.discussionId);
    await this.refreshChoices(ref, choices);
    return ref;
  }

  /** Replace the body of a comment the bot posted, and its numbered choices. */
  async update(ref: NotionMessageRef, ir: ChannelNode[]) {
    const { richText, choices } = this.render(ir);
    await this.client.updateComment(ref.id, richText);
    await this.refreshChoices(ref, choices);
  }

  /** Delete a comment the bot posted, and the numbered choices it listed. */
  async delete(ref: NotionMessageRef) {
    await this.client.deleteComment(ref.id);
    await this.refreshChoices(ref, []);
  }

  /**
   * Stream text into one comment: the first chunk creates it, later chunks
   * edit it at most once per second, and the end writes the full text (cut to
   * `NOTION_LIMITS.commentText`). An empty stream posts nothing and returns a
   * ref with an empty `id`.
   */
  async stream(target: ReplyTarget, chunks: AsyncIterable<string>) {
    const ref: NotionMessageRef = { id: "", discussionId: target.discussionId };
    let text = "";
    let sent = "";
    let sentAt = 0;
    const send = async () => {
      const body = truncateText(text, NOTION_LIMITS.commentText);
      if (!body || body === sent) return;
      const richText = markdownToRichText(body);
      if (ref.id === "") {
        const comment = await this.client.createComment({
          discussionId: target.discussionId,
          richText,
        });
        ref.id = comment.id;
        await markJoined(this.state, target.discussionId);
      } else {
        await this.client.updateComment(ref.id, richText);
      }
      sent = body;
      sentAt = Date.now();
    };
    for await (const chunk of chunks) {
      text += chunk;
      const isDue = ref.id === "" || Date.now() - sentAt >= STREAM_THROTTLE_MS;
      if (isDue) await send();
    }
    await send();
    return ref;
  }

  createRunRenderer(target: ReplyTarget) {
    return createRunRenderer({
      client: this.client,
      target,
      interruptEventNames: this.opts.interruptEventNames,
      onFirstReply: () => markJoined(this.state, target.discussionId),
    });
  }

  /**
   * Always `undefined`. Notion has no interactive components: a numbered
   * reply comment is decoded during webhook ingress and reaches the channel
   * through `sink.onInteraction`.
   */
  decodeInteraction(_raw: unknown) {
    return undefined;
  }

  /** Always `undefined`: the adapter does not search Notion users. */
  async lookupUser(_query: UserQuery) {
    return undefined;
  }

  /** The discussion's un-resolved comments, oldest first. */
  async getMessages(target: ReplyTarget) {
    return this.conversationStore.getMessages(target);
  }

  /** The bot user, fetched once. A failed fetch is retried on the next call. */
  private readonly bot = () => {
    this.botUser ??= this.client.getBotUser().catch((error: unknown) => {
      this.botUser = undefined;
      throw error;
    });
    return this.botUser;
  };

  private async onEvent(event: NotionWebhookEvent) {
    const sink = this.sink;
    if (!sink) return;
    await handleNotionEvent(event, {
      sink,
      stateStore: this.state,
      client: this.client,
      bot: this.bot,
      trigger: this.opts.trigger,
    });
  }

  /**
   * Store the comment's numbered choices. A comment with no choices clears
   * the stored ones only when they belong to that same comment.
   */
  private async refreshChoices(
    ref: NotionMessageRef,
    choices: RenderedChoice[],
  ) {
    if (choices.length > 0) {
      await savePendingChoices(this.state, ref.discussionId, {
        messageRef: ref,
        choices,
      });
      return;
    }
    const pending = await readPendingChoices(this.state, ref.discussionId);
    if (pending?.messageRef.id === ref.id) {
      await clearPendingChoices(this.state, ref.discussionId);
    }
  }
}
