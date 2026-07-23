import type { InlineKeyboardButton } from "grammy/types";
import type {
  PlatformAdapter,
  SurfaceCapabilities,
  IngressSink,
  InteractionEvent,
  RunRenderer,
  ReplyTarget as BotReplyTarget,
  ConversationStore,
  MessageRef,
  PlatformUser,
  UserQuery,
  CommandSpec,
  ChannelEgress,
  ProviderEffect,
  EffectResultFor,
} from "@copilotkit/channels-core";
import type {
  ChannelNode,
  ThreadMessage,
  EmojiValue,
  EphemeralResult,
} from "@copilotkit/channels-ui";
import { toPlatformEmoji } from "@copilotkit/channels-ui";
import { TelegramConversationStore } from "./conversation-store.js";
import { createRunRenderer } from "./event-renderer.js";
import { decodeInteraction, conversationKeyOf } from "./interaction.js";
import { renderTelegram } from "./render/telegram.js";
import { ChunkedEditStream } from "./chunked-edit-stream.js";
import { telegramHtml } from "./telegram-html.js";
import { withTelegramFormatFallback, stripHtml } from "./format-fallback.js";
import { DM_SCOPE } from "./types.js";
import type {
  TelegramConnector,
  TelegramReplyMarkup,
  TelegramSentMessage,
} from "./telegram-connector.js";
import { TELEGRAM_ALLOWED_UPDATES } from "./telegram-connector.js";
import type {
  ConversationKey,
  ReplyTarget,
  TelegramAdapterOptions,
  TelegramInlineButton,
  TelegramMessageRef,
  TelegramPayload,
} from "./types.js";

export { TELEGRAM_ALLOWED_UPDATES };

/**
 * Telegram `PlatformAdapter`: ingress via grammY (long-polling or webhook,
 * OWNED by the bound {@link TelegramConnector}), egress via the package's HTML
 * renderer + chunked-edit streaming.
 *
 * CREDENTIAL-FREE: the adapter builds nothing from a bot token; it only
 * renders and normalizes. Every credentialed Telegram operation routes
 * through a runner-INJECTED {@link TelegramConnector} (see
 * {@link TelegramAdapter.ɵbindConnector}) — typically a
 * `new GrammyTelegramConnector({ token, mode, webhook })`. Running the
 * adapter unbound throws (see the `connector` getter) — that's the intended
 * "you need a custom ChannelRunner" signpost for running Channels without
 * CopilotKit Intelligence.
 */
export class TelegramAdapter implements PlatformAdapter {
  readonly platform = "telegram";
  readonly capabilities: SurfaceCapabilities = {
    supportsModals: false,
    supportsTyping: true,
    supportsReactions: true,
    supportsEphemeral: false,
    supportsStreaming: true,
    supportsSuggestedPrompts: false,
    supportsThreadTitle: true,
  };
  readonly ackDeadlineMs = 3000;

  /**
   * The runner-injected {@link TelegramConnector} — set exactly once, via
   * {@link ɵbindConnector}, before `start()`/any egress call. The adapter
   * holds NO credentials and builds nothing from a bot token; every
   * credentialed operation routes through this connector. `undefined` until
   * bound — the `connector` getter throws a clear error if anything runs
   * unbound.
   */
  private boundConnector: TelegramConnector | undefined;
  botUsername = "";
  botUserId = 0;
  /** Credential-free conversation store (in-memory; never holds a token). */
  private readonly store = new TelegramConversationStore();

  constructor(private readonly opts: TelegramAdapterOptions) {
    // Credential-free construction: nothing token-shaped is built here. The
    // grammY Bot/socket AND the egress client both live inside a
    // runner-injected TelegramConnector (see ɵbindConnector).
  }

  /**
   * @internal Connector-injection seam. A runner (a custom `ChannelRunner`, or
   * the managed Connector Outbox's own binding path) calls this with a
   * credential-owning `TelegramConnector` — typically a
   * `new GrammyTelegramConnector({ token, mode, webhook })` — BEFORE
   * `start()` or any egress method runs. Every `PlatformAdapter` method this
   * class implements delegates to the bound connector; there is no
   * adapter-owned fallback. Marked with the ɵ prefix (Angular-style
   * internal-API marker) to signal this is plumbing for a runner, not a
   * user-facing option.
   */
  ɵbindConnector(connector: TelegramConnector): void {
    this.boundConnector = connector;
  }

  /**
   * The credentialed {@link TelegramConnector} every egress method routes
   * through — the one bound via {@link ɵbindConnector}. Throws if the
   * adapter is run unbound: running Channels without CopilotKit Intelligence
   * requires a custom `ChannelRunner` that supplies a connector (see docs).
   */
  private get connector(): TelegramConnector {
    if (!this.boundConnector) {
      throw new Error(
        "Telegram channel has no connector: running Channels without " +
          "CopilotKit Intelligence requires a custom ChannelRunner that " +
          "supplies a TelegramConnector (see docs).",
      );
    }
    return this.boundConnector;
  }

  /** Greeting text to post on conversation start (wired by the example's onThreadStarted). */
  get greeting(): string | undefined {
    return this.opts.greeting;
  }

  /** Suggested prompt chips to surface on conversation start. */
  get suggestedPrompts(): { title: string; message: string }[] | undefined {
    return this.opts.suggestedPrompts;
  }

  /**
   * The declarative egress entry point (Channel Runner plan §2, design D2:
   * "adapter owns the effect→native mapping"): renders IR via the adapter's
   * own `render()`/HTML logic and routes every op to a RUNNER-supplied
   * `connector` instead of this adapter's internal one — driving the exact
   * same native Telegram calls the `PlatformAdapter` methods below build,
   * just against a different credentialed sender (e.g. the Intelligence
   * Connector Outbox). Every op here is a thin call into the SAME
   * `*Via(connector, …)` helper the `PlatformAdapter` method (via
   * `this.connector`) also calls — one egress implementation, two entry
   * points.
   */
  makeEgress(connector: TelegramConnector): ChannelEgress {
    return {
      send: async <E extends ProviderEffect>(
        effect: E,
      ): Promise<EffectResultFor<E>> => {
        switch (effect.op) {
          case "post":
            return (await this.postVia(
              connector,
              effect.target,
              effect.ir,
            )) as EffectResultFor<E>;
          case "update":
            await this.updateVia(connector, effect.ref, effect.ir);
            return effect.ref as EffectResultFor<E>;
          case "delete":
            await this.deleteVia(connector, effect.ref);
            return undefined as EffectResultFor<E>;
          case "react":
            return (await (effect.add
              ? this.addReactionVia(
                  connector,
                  effect.target,
                  effect.ref,
                  effect.emoji,
                )
              : this.removeReactionVia(
                  connector,
                  effect.target,
                  effect.ref,
                  effect.emoji,
                ))) as EffectResultFor<E>;
          case "ephemeral":
            return (await this.postEphemeralVia(
              connector,
              effect.target,
              effect.user,
              effect.ir,
              { fallbackToDM: effect.fallbackToDM },
            )) as EffectResultFor<E>;
          case "file":
            return (await this.postFileVia(
              connector,
              effect.target,
              effect.file,
            )) as EffectResultFor<E>;
          case "suggested":
            return {
              ok: false,
              error: "telegram does not support suggested prompts",
            } as EffectResultFor<E>;
          case "title":
            return (await this.setThreadTitleVia(
              connector,
              effect.target,
              effect.title,
            )) as EffectResultFor<E>;
        }
      },
      stream: (target, chunks) => this.streamVia(connector, target, chunks),
      createRunRenderer: (target) =>
        this.createRunRendererVia(connector, target),
      getMessages: (target) => this.getMessages(target),
      lookupUser: (q) => this.lookupUserVia(connector, q),
    };
  }

  /**
   * Delegates ALL ingress ownership to `this.connector`: the grammY `Bot`,
   * `getMe()`, the resilience boundary, every raw event subscription
   * (text/media/callback_query/message_reaction/`/start`, including the
   * mention-stripping/loop-guard — resolved from the connector's OWN
   * `getMe()` inside `startIngress`), and long-polling vs webhook startup
   * all live in the connector's `startIngress` — this method only hands over
   * the sink and the adapter's own (credential-free) conversation store,
   * then records the connection facts (`botUserId`/`botUsername`) for the
   * adapter's own bookkeeping. Throws (via the `connector` getter) if no
   * connector has been bound via `ɵbindConnector`.
   */
  async start(sink: IngressSink): Promise<void> {
    const connector = this.connector; // throws if unbound
    const conn = await connector.startIngress({ sink, store: this.store });
    this.botUserId = conn.botUserId;
    this.botUsername = conn.botUsername;
  }

  async stop(): Promise<void> {
    // Lenient (not the throwing `connector` getter): stopping an adapter that
    // was never bound/started is a harmless no-op, not a signpost-worthy error.
    await this.boundConnector?.stopIngress();
  }

  render(ir: ChannelNode[]): TelegramPayload {
    return renderTelegram(ir);
  }

  async post(target: BotReplyTarget, ir: ChannelNode[]): Promise<MessageRef> {
    return this.postVia(this.connector, target, ir);
  }

  /**
   * `post`'s connector-parameterized body. Shared by the `PlatformAdapter`
   * method (via `this.connector`) and `makeEgress` (via an injected
   * connector) so there is exactly one implementation of the effect→native
   * mapping.
   */
  private async postVia(
    connector: TelegramConnector,
    target: BotReplyTarget,
    ir: ChannelNode[],
  ): Promise<MessageRef> {
    const t = target as ReplyTarget;
    const p = renderTelegram(ir);
    const replyMarkup = this.toReplyMarkup(p.inlineKeyboard);
    const photos = p.photos ?? [];
    const hasText = p.text.trim().length > 0;

    let sent: TelegramSentMessage;

    if (hasText) {
      // Text (with optional photos riding along as separate messages). The
      // returned ref references the text message.
      sent = await withTelegramFormatFallback(
        (o) =>
          connector.sendMessage({
            chatId: t.chatId,
            text: o.text,
            parseMode: o.parseMode,
            messageThreadId: t.messageThreadId,
            replyMarkup,
            replyToMessageId: t.replyToMessageId,
          }),
        p.text,
      );
      // Photos ride along as separate messages.
      for (const photo of photos) {
        await connector.sendPhoto({
          chatId: t.chatId,
          url: photo.url,
          caption: photo.caption,
          messageThreadId: t.messageThreadId,
        });
      }
    } else if (photos.length > 0) {
      // Image-only render: skip the empty sendMessage (Telegram rejects an
      // empty text body with a "message text is empty" error that the format
      // fallback does NOT catch) and post the photo(s) instead. The first
      // photo carries the inline keyboard and reply-to; the ref references it.
      const [first, ...rest] = photos;
      sent = await connector.sendPhoto({
        chatId: t.chatId,
        url: first!.url,
        caption: first!.caption,
        messageThreadId: t.messageThreadId,
        replyMarkup,
        replyToMessageId: t.replyToMessageId,
      });
      for (const photo of rest) {
        await connector.sendPhoto({
          chatId: t.chatId,
          url: photo.url,
          caption: photo.caption,
          messageThreadId: t.messageThreadId,
        });
      }
    } else {
      // Nothing to post (no text, no photos). Return a harmless empty ref —
      // update()/delete() guard against a 0 messageId, so nothing is edited.
      return { id: "", chatId: t.chatId, messageId: 0 } as TelegramMessageRef;
    }

    const ref: TelegramMessageRef = {
      id: `${sent.chatId}:${sent.messageId}`,
      chatId: sent.chatId,
      messageId: sent.messageId,
    };

    // Record the outbound message for lightweight within-session context.
    // Store the plain-text form (not raw HTML) since getMessages feeds this
    // back to the agent as context. Skip when the stripped text is empty
    // (image-only post) to avoid recording a blank bot turn into history.
    const plainText = stripHtml(p.text);
    if (plainText.trim()) {
      this.store.recordMessage(this.conversationKeyForTarget(t), {
        text: plainText,
        ts: String(sent.messageId),
        isBot: true,
      });
    }

    return ref;
  }

  async update(ref: MessageRef, ir: ChannelNode[]): Promise<void> {
    return this.updateVia(this.connector, ref, ir);
  }

  /** `update`'s connector-parameterized body (see {@link postVia}). */
  private async updateVia(
    connector: TelegramConnector,
    ref: MessageRef,
    ir: ChannelNode[],
  ): Promise<void> {
    const r = ref as TelegramMessageRef;
    // Guard against a bogus ref (e.g. the empty ref returned by stream() when
    // no chunk was posted): a message id of 0/undefined can never be edited.
    if (!r || !r.messageId) return;
    const p = renderTelegram(ir);
    // Guard against an image-only IR (empty text). Calling editMessageText with
    // "" triggers a "message text is empty" error from Telegram (NOT caught by
    // withTelegramFormatFallback). Calling it on a photo ref triggers "there is
    // no text in the message to edit". Editing media is unsupported — no-op.
    if (!p.text.trim()) return;
    const replyMarkup = this.toReplyMarkup(p.inlineKeyboard);
    try {
      await withTelegramFormatFallback(
        (o) =>
          connector.editMessageText({
            chatId: r.chatId,
            messageId: r.messageId,
            text: o.text,
            parseMode: o.parseMode,
            replyMarkup,
          }),
        p.text,
      );
    } catch (err) {
      // Telegram rejects an edit whose text equals the current text. That is a
      // no-op from our perspective, so swallow it; let other errors propagate.
      if (
        err instanceof Error &&
        /message is not modified/i.test(err.message)
      ) {
        return;
      }
      throw err;
    }
  }

  async stream(
    target: BotReplyTarget,
    chunks: AsyncIterable<string>,
  ): Promise<MessageRef> {
    return this.streamVia(this.connector, target, chunks);
  }

  /** `stream`'s connector-parameterized body (see {@link postVia}). */
  private async streamVia(
    connector: TelegramConnector,
    target: BotReplyTarget,
    chunks: AsyncIterable<string>,
  ): Promise<MessageRef> {
    const t = target as ReplyTarget;
    let firstRef: TelegramMessageRef | undefined;

    const stream = new ChunkedEditStream({
      postPlaceholder: async (text) => {
        // Wrap in the format fallback so a chunk that splits an HTML tag
        // degrades to plain text instead of failing the send.
        const sent = await withTelegramFormatFallback(
          (o) =>
            connector.sendMessage({
              chatId: t.chatId,
              text: o.text,
              parseMode: o.parseMode,
              messageThreadId: t.messageThreadId,
            }),
          text,
        );
        if (!firstRef) {
          firstRef = {
            id: `${sent.chatId}:${sent.messageId}`,
            chatId: sent.chatId,
            messageId: sent.messageId,
          };
        }
        return sent.messageId;
      },
      editAt: async (messageId, text) => {
        // Wrap in the format fallback so a chunk that splits an HTML tag
        // degrades to plain text instead of failing the edit.
        await withTelegramFormatFallback(
          (o) =>
            connector.editMessageText({
              chatId: t.chatId,
              messageId,
              text: o.text,
              parseMode: o.parseMode,
            }),
          text,
        );
      },
      transform: telegramHtml,
    });

    let acc = "";
    for await (const chunk of chunks) {
      acc += chunk;
      stream.append(acc);
    }
    // ChunkedEditStream.finish() rejects on a failed terminal edit. The
    // streamed content is best-effort, so log the failure rather than
    // swallowing it or letting it abort the response.
    try {
      await stream.finish();
    } catch (err) {
      console.error("[telegram] stream finish failed:", err);
    }

    return firstRef ?? { id: "", chatId: t.chatId, messageId: 0 };
  }

  async delete(ref: MessageRef): Promise<void> {
    return this.deleteVia(this.connector, ref);
  }

  /** `delete`'s connector-parameterized body (see {@link postVia}). */
  private async deleteVia(
    connector: TelegramConnector,
    ref: MessageRef,
  ): Promise<void> {
    const r = ref as TelegramMessageRef;
    // Guard against a bogus ref (e.g. the empty ref returned by stream() when
    // no chunk was posted): a message id of 0/undefined can never be deleted.
    if (!r || !r.messageId) return;
    await connector.deleteMessage({ chatId: r.chatId, messageId: r.messageId });
  }

  createRunRenderer(target: BotReplyTarget): RunRenderer {
    return this.createRunRendererVia(this.connector, target);
  }

  /** `createRunRenderer`'s connector-parameterized body (see {@link postVia}). */
  private createRunRendererVia(
    connector: TelegramConnector,
    target: BotReplyTarget,
  ): RunRenderer {
    const t = target as ReplyTarget;
    return createRunRenderer({
      postPlaceholder: async (text) => {
        // Wrap in the format fallback so a chunk that splits an HTML tag
        // degrades to plain text instead of failing the send (mirrors stream()).
        const sent = await withTelegramFormatFallback(
          (o) =>
            connector.sendMessage({
              chatId: t.chatId,
              text: o.text,
              parseMode: o.parseMode,
              messageThreadId: t.messageThreadId,
            }),
          text,
        );
        return sent.messageId;
      },
      editAt: async (messageId, text) => {
        // Wrap in the format fallback so a chunk that splits an HTML tag
        // degrades to plain text instead of failing the edit (mirrors stream()).
        await withTelegramFormatFallback(
          (o) =>
            connector.editMessageText({
              chatId: t.chatId,
              messageId,
              text: o.text,
              parseMode: o.parseMode,
            }),
          text,
        );
      },
      setTyping: async () => {
        await connector.sendChatAction({
          chatId: t.chatId,
          action: "typing",
          messageThreadId: t.messageThreadId,
        });
      },
      ...(this.opts.interruptEventNames
        ? { interruptEventNames: this.opts.interruptEventNames }
        : {}),
      ...(this.opts.showToolStatus !== undefined
        ? { showToolStatus: this.opts.showToolStatus }
        : {}),
    });
  }

  decodeInteraction(raw: unknown): InteractionEvent | undefined {
    return decodeInteraction(raw);
  }

  async lookupUser(q: UserQuery): Promise<PlatformUser | undefined> {
    return this.lookupUserVia(this.connector, q);
  }

  /** `lookupUser`'s connector-parameterized body (see {@link postVia}). */
  private async lookupUserVia(
    connector: TelegramConnector,
    q: UserQuery,
  ): Promise<PlatformUser | undefined> {
    const query = q.query.trim();
    if (!query.startsWith("@")) return undefined;
    const chat = await connector.getChat(query);
    if (!chat) return undefined;
    return {
      id: String(chat.id),
      name: chat.title ?? chat.first_name,
      handle: chat.username,
    };
  }

  get conversationStore(): ConversationStore {
    return this.store;
  }

  async getMessages(target: BotReplyTarget): Promise<ThreadMessage[]> {
    const t = target as ReplyTarget;
    return this.store.getMessages(this.conversationKeyForTarget(t));
  }

  async postFile(
    target: BotReplyTarget,
    file: {
      bytes: Uint8Array;
      filename: string;
      title?: string;
      altText?: string;
    },
  ): Promise<{ ok: boolean; fileId?: string; error?: string }> {
    return this.postFileVia(this.connector, target, file);
  }

  /** `postFile`'s connector-parameterized body (see {@link postVia}). */
  private async postFileVia(
    connector: TelegramConnector,
    target: BotReplyTarget,
    {
      bytes,
      filename,
    }: {
      bytes: Uint8Array;
      filename: string;
      title?: string;
      altText?: string;
    },
  ): Promise<{ ok: boolean; fileId?: string; error?: string }> {
    const t = target as ReplyTarget;
    try {
      const result = await connector.sendDocument({
        chatId: t.chatId,
        bytes: Buffer.from(bytes),
        filename,
        messageThreadId: t.messageThreadId,
      });
      return { ok: true, fileId: result.fileId };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  async registerCommands(specs: readonly CommandSpec[]): Promise<void> {
    return this.registerCommandsVia(this.connector, specs);
  }

  /** `registerCommands`'s connector-parameterized body (see {@link postVia}). */
  private async registerCommandsVia(
    connector: TelegramConnector,
    specs: readonly CommandSpec[],
  ): Promise<void> {
    // Telegram restricts command names to 1–32 chars of [a-z0-9_] (no hyphens,
    // unlike Slack/Discord) and rejects the WHOLE setMyCommands call with
    // 400 BOT_COMMAND_INVALID if any name violates that. Convert hyphens to
    // underscores so e.g. `/file-issue` registers here as `/file_issue`; engine
    // routing still matches because `normalizeCommandName` collapses "-"→"_",
    // so an incoming `/file_issue` reaches the `file-issue` handler. Names still
    // invalid after conversion (spaces, other punctuation, >32 chars) are
    // skipped with a warning rather than failing the whole call.
    const valid: { command: string; description: string }[] = [];
    for (const s of specs) {
      const tgName = s.name.toLowerCase().replace(/-/g, "_");
      if (!/^[a-z0-9_]{1,32}$/.test(tgName)) {
        console.warn(
          `[bot-telegram] skipping command "/${s.name}": cannot map to a Telegram-valid name (1–32 chars of [a-z0-9_])`,
        );
        continue;
      }
      valid.push({
        command: tgName,
        // Telegram allows 1–256 chars for the description; truncate defensively.
        description: (s.description ?? s.name).slice(0, 256),
      });
    }
    // An empty array would clear all commands — skip the call entirely instead.
    if (valid.length === 0) return;
    await connector.setMyCommands(valid);
  }

  async setThreadTitle(
    target: BotReplyTarget,
    title: string,
  ): Promise<{ ok: boolean; error?: string }> {
    return this.setThreadTitleVia(this.connector, target, title);
  }

  /** `setThreadTitle`'s connector-parameterized body (see {@link postVia}). */
  private async setThreadTitleVia(
    connector: TelegramConnector,
    target: BotReplyTarget,
    title: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const t = target as ReplyTarget;
    if (t.messageThreadId === undefined) {
      return { ok: false, error: "no forum topic" };
    }
    try {
      await connector.editForumTopic({
        chatId: t.chatId,
        messageThreadId: t.messageThreadId,
        name: title,
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  async addReaction(
    target: BotReplyTarget,
    messageRef: MessageRef,
    emoji: EmojiValue,
  ): Promise<{ ok: boolean; error?: string }> {
    return this.addReactionVia(this.connector, target, messageRef, emoji);
  }

  /** `addReaction`'s connector-parameterized body (see {@link postVia}). */
  private async addReactionVia(
    connector: TelegramConnector,
    target: BotReplyTarget,
    messageRef: MessageRef,
    emoji: EmojiValue,
  ): Promise<{ ok: boolean; error?: string }> {
    const r = messageRef as TelegramMessageRef;
    const chatId = r.chatId ?? (target as ReplyTarget).chatId;
    const messageId = Number(r.messageId ?? r.id);
    const token = toPlatformEmoji(emoji, "telegram") ?? emoji;
    try {
      await connector.setMessageReaction({
        chatId,
        messageId,
        reactions: [{ type: "emoji", emoji: token }],
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async removeReaction(
    target: BotReplyTarget,
    messageRef: MessageRef,
    emoji: EmojiValue,
  ): Promise<{ ok: boolean; error?: string }> {
    return this.removeReactionVia(this.connector, target, messageRef, emoji);
  }

  /** `removeReaction`'s connector-parameterized body (see {@link postVia}). */
  private async removeReactionVia(
    connector: TelegramConnector,
    target: BotReplyTarget,
    messageRef: MessageRef,
    _emoji: EmojiValue,
  ): Promise<{ ok: boolean; error?: string }> {
    const r = messageRef as TelegramMessageRef;
    const chatId = r.chatId ?? (target as ReplyTarget).chatId;
    const messageId = Number(r.messageId ?? r.id);
    try {
      // Telegram clears the bot's reactions by setting an empty list.
      await connector.setMessageReaction({ chatId, messageId, reactions: [] });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async postEphemeral(
    target: BotReplyTarget,
    user: PlatformUser | string,
    ir: ChannelNode[],
    opts: { fallbackToDM: boolean },
  ): Promise<EphemeralResult | null> {
    return this.postEphemeralVia(this.connector, target, user, ir, opts);
  }

  /** `postEphemeral`'s connector-parameterized body (see {@link postVia}). */
  private async postEphemeralVia(
    connector: TelegramConnector,
    _target: BotReplyTarget,
    user: PlatformUser | string,
    ir: ChannelNode[],
    opts: { fallbackToDM: boolean },
  ): Promise<EphemeralResult | null> {
    if (!opts.fallbackToDM) return null; // no native ephemeral on Telegram
    const userId = typeof user === "string" ? user : user.id;
    const payload = renderTelegram(ir);
    const replyMarkup = this.toReplyMarkup(payload.inlineKeyboard);
    try {
      const sent = await connector.sendMessage({
        chatId: String(userId),
        text: payload.text,
        parseMode: payload.parseMode,
        replyMarkup,
      });
      return {
        ok: true,
        usedFallback: true,
        ref: {
          id: `${sent.chatId}:${sent.messageId}`,
          chatId: sent.chatId,
          messageId: sent.messageId,
        },
      };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async setSuggestedPrompts(
    _target: BotReplyTarget,
    _prompts: ReadonlyArray<{ title: string; message: string }>,
    _opts?: { title?: string },
  ): Promise<{ ok: boolean; error?: string }> {
    // Telegram has no pinned-prompt pane analogous to Slack's assistant pane.
    return { ok: false, error: "unsupported" };
  }

  /**
   * Return the store's conversation key for a {@link ReplyTarget}.
   *
   * Prefers the `conversationKey` field stamped at ingress (by the listener or
   * `decodeInteraction`), which carries the exact key used for the live
   * conversation — including the `user:<id>` scope that non-forum group chats
   * require. Falls back to a best-effort derivation (covers DMs and forum
   * topics, but cannot reproduce `user:` for plain group chats).
   */
  private conversationKeyForTarget(t: ReplyTarget): string {
    if (t.conversationKey) return t.conversationKey;
    const key: ConversationKey = {
      chatId: String(t.chatId),
      scope:
        t.messageThreadId !== undefined
          ? `topic:${t.messageThreadId}`
          : DM_SCOPE,
    };
    return conversationKeyOf(key);
  }

  /** Map the renderer's inline keyboard to the connector's `reply_markup` shape. */
  private toReplyMarkup(
    keyboard: TelegramInlineButton[][] | undefined,
  ): TelegramReplyMarkup | undefined {
    if (!keyboard || keyboard.length === 0) return undefined;
    return {
      inline_keyboard: keyboard.map((row) =>
        row.map((b): InlineKeyboardButton => {
          // URL buttons take precedence; otherwise a callback button. The
          // renderer always supplies one or the other, but fall back to an
          // empty callback so the discriminated union is satisfied.
          if (b.url) return { text: b.text, url: b.url };
          return { text: b.text, callback_data: b.callbackData ?? "" };
        }),
      ),
    };
  }
}

/** Construct a Telegram `PlatformAdapter` — CREDENTIAL-FREE. Bind a `TelegramConnector` via `ɵbindConnector` before `start()`. */
export function telegram(opts: TelegramAdapterOptions = {}): TelegramAdapter {
  return new TelegramAdapter(opts);
}
