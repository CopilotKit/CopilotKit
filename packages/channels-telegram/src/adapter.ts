import { Bot, InputFile } from "grammy";
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
} from "@copilotkit/channels";
import type {
  ChannelNode,
  ThreadMessage,
  EmojiValue,
  EphemeralResult,
} from "@copilotkit/channels-ui";
import { toPlatformEmoji } from "@copilotkit/channels-ui";
import { TelegramConversationStore } from "./conversation-store.js";
import { attachTelegramListener } from "./listener.js";
import { createRunRenderer } from "./event-renderer.js";
import { decodeInteraction, conversationKeyOf } from "./interaction.js";
import { renderTelegram } from "./render/telegram.js";
import { ChunkedEditStream } from "./chunked-edit-stream.js";
import { telegramHtml } from "./telegram-html.js";
import { withTelegramFormatFallback, stripHtml } from "./format-fallback.js";
import { DM_SCOPE } from "./types.js";
import type {
  ConversationKey,
  ReplyTarget,
  TelegramAdapterOptions,
  TelegramInlineButton,
  TelegramMessageRef,
  TelegramPayload,
} from "./types.js";

/**
 * Update types that the Telegram adapter subscribes to. Includes
 * `message_reaction` so the bot receives emoji-reaction events.
 *
 * In **group** chats the bot must be an administrator to receive
 * `message_reaction` updates; private chats and channels work without
 * additional permissions.
 *
 * For **webhook** deployments pass this list to `setWebhook`:
 * ```ts
 * await bot.api.setWebhook(url, { allowed_updates: [...TELEGRAM_ALLOWED_UPDATES] });
 * ```
 * Long-polling (`start()`) passes it automatically.
 */
export const TELEGRAM_ALLOWED_UPDATES = [
  "message",
  "edited_message",
  "callback_query",
  "message_reaction",
] as const;

/**
 * Telegram `PlatformAdapter`: ingress via grammY (long-polling or webhook),
 * egress via the package's HTML renderer + chunked-edit streaming.
 *
 * Construction is side-effect-free — the grammY {@link Bot} is created but no
 * network call is made until {@link start} (which owns `getMe` + ingress).
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

  /** Public/assignable so tests can inject a fake (`adapter.bot = fake`). */
  bot: Bot;
  botUsername = "";
  botUserId = 0;
  private readonly store = new TelegramConversationStore();
  /** In webhook mode, the Node HTTP server standing up the webhook endpoint. */
  private webhookServer?: import("node:http").Server;

  constructor(private readonly opts: TelegramAdapterOptions) {
    // SIDE-EFFECT-FREE: the grammY Bot constructor performs no network I/O.
    // start() owns getMe() + ingress.
    this.bot = new Bot(opts.token);
  }

  /** Greeting text to post on conversation start (wired by the example's onThreadStarted). */
  get greeting(): string | undefined {
    return this.opts.greeting;
  }

  /** Suggested prompt chips to surface on conversation start. */
  get suggestedPrompts(): { title: string; message: string }[] | undefined {
    return this.opts.suggestedPrompts;
  }

  async start(sink: IngressSink): Promise<void> {
    const me = await this.bot.api.getMe();
    this.botUsername = me.username;
    this.botUserId = me.id;

    // Resilience boundary. Without a registered error handler, grammy rethrows
    // any uncaught error from update processing, which stops the polling runner;
    // because start() has already returned, the event loop then drains and the
    // process exits silently (code 0). Catching here logs the error and KEEPS
    // the bot polling, and lets grammy advance the offset so a failing update is
    // consumed rather than re-delivered forever (the "poison pill" loop).
    this.bot.catch((err) => {
      const updateId = err.ctx?.update?.update_id;
      console.error(
        `[bot-telegram] error handling update${
          updateId !== undefined ? ` ${updateId}` : ""
        }:`,
        err.error,
      );
    });

    attachTelegramListener({
      bot: this.bot,
      store: this.store,
      botUsername: this.botUsername,
      botUserId: this.botUserId,
      sink,
      botToken: this.opts.token,
      getFilePath: async (fileId) =>
        (await this.bot.api.getFile(fileId)).file_path ?? "",
    });

    const mode = this.resolveMode();
    if (mode === "webhook") {
      await this.startWebhook();
    } else {
      // Long-polling: bot.start() resolves only when the bot is stopped, so we
      // fire it (don't await to completion) and let it run in the background.
      // Surface a startup rejection (e.g. 409 "terminated by other getUpdates
      // request" or a revoked token) instead of swallowing it silently.
      this.bot
        .start({ allowed_updates: [...TELEGRAM_ALLOWED_UPDATES] })
        .catch((err) =>
          console.error("[telegram] long-polling failed to start:", err),
        );
    }
  }

  /** Resolve the effective ingress mode, expanding "auto" by environment. */
  private resolveMode(): "polling" | "webhook" {
    const mode = this.opts.mode ?? "polling";
    if (mode === "polling") return "polling";
    if (mode === "webhook") return "webhook";
    // "auto": prefer webhook in serverless environments, else long-poll. But
    // only choose webhook when a domain is actually configured — otherwise
    // startWebhook() would throw, contradicting "auto"'s documented fallback to
    // polling. (Explicit mode: "webhook" without a domain still throws, since
    // that is a real misconfiguration.)
    const serverless =
      process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.NETLIFY;
    return serverless && this.opts.webhook?.domain ? "webhook" : "polling";
  }

  /**
   * Register the webhook with Telegram and stand up a minimal Node HTTP server
   * that feeds updates to grammY via {@link webhookCallback}. Requires
   * `opts.webhook.domain`.
   */
  private async startWebhook(): Promise<void> {
    const webhook = this.opts.webhook;
    if (!webhook?.domain) {
      throw new Error("Telegram webhook mode requires opts.webhook.domain");
    }
    const normalizedPath = webhook.path
      ? webhook.path.startsWith("/")
        ? webhook.path
        : `/${webhook.path}`
      : "/telegram";
    const url = `${webhook.domain.replace(/\/$/, "")}${normalizedPath}`;
    await this.bot.api.setWebhook(
      url,
      webhook.secretToken ? { secret_token: webhook.secretToken } : undefined,
    );
    const { webhookCallback } = await import("grammy");
    const { createServer } = await import("node:http");
    const handler = webhookCallback(
      this.bot,
      "http",
      webhook.secretToken ? { secretToken: webhook.secretToken } : undefined,
    );
    const server = createServer((req, res) => {
      if (req.url && req.url.split("?")[0] === normalizedPath) {
        void (handler as (req: unknown, res: unknown) => Promise<void>)(
          req,
          res,
        );
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    this.webhookServer = server;
    // Telegram only delivers webhook updates to ports 443/80/88/8443, so an
    // ephemeral port (0) would be unreachable. Default to 8443.
    const port = webhook.port ?? 8443;
    // Surface bind failures (EADDRINUSE/EACCES) clearly: without an "error"
    // listener the emitted error becomes an uncaught exception that crashes the
    // process with a cryptic stack. Reject the start promise on the first
    // listen error so callers can handle it.
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      server.on("error", (err) => {
        console.error(`[telegram] webhook server error (port ${port}):`, err);
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
      server.listen(port, () => {
        console.log(`[telegram] webhook server listening on port ${port}`);
        if (!settled) {
          settled = true;
          resolve();
        }
      });
    });
  }

  async stop(): Promise<void> {
    // Tear down the webhook server + registration before stopping the bot, so a
    // stop/restart cleanly rebinds the socket instead of leaking it.
    // Order: deleteWebhook first (so Telegram stops sending), then close the
    // local HTTP server (no more refused-socket errors on in-flight POSTs), then
    // stop the bot. The old reverse order (close server → deleteWebhook) left a
    // window where Telegram kept POSTing to an already-closed socket.
    if (this.webhookServer) {
      const server = this.webhookServer;
      this.webhookServer = undefined;
      await this.bot.api
        .deleteWebhook()
        .catch((e) => console.error("[telegram] deleteWebhook failed:", e));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await this.bot.stop();
  }

  render(ir: ChannelNode[]): TelegramPayload {
    return renderTelegram(ir);
  }

  async post(target: BotReplyTarget, ir: ChannelNode[]): Promise<MessageRef> {
    const t = target as ReplyTarget;
    const p = renderTelegram(ir);
    const replyMarkup = this.toReplyMarkup(p.inlineKeyboard);
    const photos = p.photos ?? [];
    const hasText = p.text.trim().length > 0;

    let chatId: number | string;
    let messageId: number;

    if (hasText) {
      // Text (with optional photos riding along as separate messages). The
      // returned ref references the text message.
      const sent = await withTelegramFormatFallback(
        (o) =>
          this.bot.api.sendMessage(t.chatId, o.text, {
            ...(o.parseMode ? { parse_mode: o.parseMode } : {}),
            ...(t.messageThreadId !== undefined
              ? { message_thread_id: t.messageThreadId }
              : {}),
            ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
            ...(t.replyToMessageId !== undefined
              ? {
                  reply_parameters: { message_id: t.replyToMessageId },
                }
              : {}),
          }),
        p.text,
      );
      // Photos ride along as separate messages.
      for (const photo of photos) {
        await this.bot.api.sendPhoto(t.chatId, photo.url, {
          ...(photo.caption ? { caption: photo.caption } : {}),
          ...(t.messageThreadId !== undefined
            ? { message_thread_id: t.messageThreadId }
            : {}),
        });
      }
      chatId = sent.chat.id;
      messageId = sent.message_id;
    } else if (photos.length > 0) {
      // Image-only render: skip the empty sendMessage (Telegram rejects an
      // empty text body with a "message text is empty" error that the format
      // fallback does NOT catch) and post the photo(s) instead. The first
      // photo carries the inline keyboard and reply-to; the ref references it.
      const [first, ...rest] = photos;
      const sent = await this.bot.api.sendPhoto(t.chatId, first!.url, {
        ...(first!.caption ? { caption: first!.caption } : {}),
        ...(t.messageThreadId !== undefined
          ? { message_thread_id: t.messageThreadId }
          : {}),
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        ...(t.replyToMessageId !== undefined
          ? { reply_parameters: { message_id: t.replyToMessageId } }
          : {}),
      });
      for (const photo of rest) {
        await this.bot.api.sendPhoto(t.chatId, photo.url, {
          ...(photo.caption ? { caption: photo.caption } : {}),
          ...(t.messageThreadId !== undefined
            ? { message_thread_id: t.messageThreadId }
            : {}),
        });
      }
      chatId = sent.chat.id;
      messageId = sent.message_id;
    } else {
      // Nothing to post (no text, no photos). Return a harmless empty ref —
      // update()/delete() guard against a 0 messageId, so nothing is edited.
      return { id: "", chatId: t.chatId, messageId: 0 } as TelegramMessageRef;
    }

    const ref: TelegramMessageRef = {
      id: `${chatId}:${messageId}`,
      chatId,
      messageId,
    };

    // Record the outbound message for lightweight within-session context.
    // Store the plain-text form (not raw HTML) since getMessages feeds this
    // back to the agent as context. Skip when the stripped text is empty
    // (image-only post) to avoid recording a blank bot turn into history.
    const plainText = stripHtml(p.text);
    if (plainText.trim()) {
      this.store.recordMessage(this.conversationKeyForTarget(t), {
        text: plainText,
        ts: String(messageId),
        isBot: true,
      });
    }

    return ref;
  }

  async update(ref: MessageRef, ir: ChannelNode[]): Promise<void> {
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
          this.bot.api.editMessageText(r.chatId, r.messageId, o.text, {
            ...(o.parseMode ? { parse_mode: o.parseMode } : {}),
            ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
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
    const t = target as ReplyTarget;
    let firstRef: TelegramMessageRef | undefined;

    const stream = new ChunkedEditStream({
      postPlaceholder: async (text) => {
        // Wrap in the format fallback so a chunk that splits an HTML tag
        // degrades to plain text instead of failing the send.
        const sent = await withTelegramFormatFallback(
          (o) =>
            this.bot.api.sendMessage(t.chatId, o.text, {
              ...(o.parseMode ? { parse_mode: o.parseMode } : {}),
              ...(t.messageThreadId !== undefined
                ? { message_thread_id: t.messageThreadId }
                : {}),
            }),
          text,
        );
        if (!firstRef) {
          firstRef = {
            id: `${sent.chat.id}:${sent.message_id}`,
            chatId: sent.chat.id,
            messageId: sent.message_id,
          };
        }
        return sent.message_id;
      },
      editAt: async (messageId, text) => {
        // Wrap in the format fallback so a chunk that splits an HTML tag
        // degrades to plain text instead of failing the edit.
        await withTelegramFormatFallback(
          (o) =>
            this.bot.api.editMessageText(
              t.chatId,
              messageId,
              o.text,
              o.parseMode ? { parse_mode: o.parseMode } : {},
            ),
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
    const r = ref as TelegramMessageRef;
    // Guard against a bogus ref (e.g. the empty ref returned by stream() when
    // no chunk was posted): a message id of 0/undefined can never be deleted.
    if (!r || !r.messageId) return;
    await this.bot.api.deleteMessage(r.chatId, r.messageId);
  }

  createRunRenderer(target: BotReplyTarget): RunRenderer {
    const t = target as ReplyTarget;
    return createRunRenderer({
      postPlaceholder: async (text) => {
        // Wrap in the format fallback so a chunk that splits an HTML tag
        // degrades to plain text instead of failing the send (mirrors stream()).
        const sent = await withTelegramFormatFallback(
          (o) =>
            this.bot.api.sendMessage(t.chatId, o.text, {
              ...(o.parseMode ? { parse_mode: o.parseMode } : {}),
              ...(t.messageThreadId !== undefined
                ? { message_thread_id: t.messageThreadId }
                : {}),
            }),
          text,
        );
        return sent.message_id;
      },
      editAt: async (messageId, text) => {
        // Wrap in the format fallback so a chunk that splits an HTML tag
        // degrades to plain text instead of failing the edit (mirrors stream()).
        await withTelegramFormatFallback(
          (o) =>
            this.bot.api.editMessageText(
              t.chatId,
              messageId,
              o.text,
              o.parseMode ? { parse_mode: o.parseMode } : {},
            ),
          text,
        );
      },
      setTyping: async () => {
        await this.bot.api.sendChatAction(
          t.chatId,
          "typing",
          t.messageThreadId !== undefined
            ? { message_thread_id: t.messageThreadId }
            : {},
        );
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
    const query = q.query.trim();
    if (!query.startsWith("@")) return undefined;
    try {
      const chat = (await this.bot.api.getChat(query)) as {
        id: number | string;
        title?: string;
        first_name?: string;
        username?: string;
      };
      return {
        id: String(chat.id),
        name: chat.title ?? chat.first_name,
        handle: chat.username,
      };
    } catch {
      return undefined;
    }
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
      const result = await this.bot.api.sendDocument(
        t.chatId,
        new InputFile(Buffer.from(bytes), filename),
        t.messageThreadId !== undefined
          ? { message_thread_id: t.messageThreadId }
          : {},
      );
      return { ok: true, fileId: result.document?.file_id };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  async registerCommands(specs: readonly CommandSpec[]): Promise<void> {
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
    await this.bot.api.setMyCommands(valid);
  }

  async setThreadTitle(
    target: BotReplyTarget,
    title: string,
  ): Promise<{ ok: boolean; error?: string }> {
    const t = target as ReplyTarget;
    if (t.messageThreadId === undefined) {
      return { ok: false, error: "no forum topic" };
    }
    try {
      await this.bot.api.editForumTopic(t.chatId, t.messageThreadId, {
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
    const r = messageRef as TelegramMessageRef;
    const chatId = r.chatId ?? (target as ReplyTarget).chatId;
    const messageId = Number(r.messageId ?? r.id);
    const token = toPlatformEmoji(emoji, "telegram") ?? emoji;
    try {
      // grammy types ReactionTypeEmoji.emoji as a strict union of allowed emoji;
      // cast via unknown since we accept any EmojiValue passthrough.
      await this.bot.api.setMessageReaction(chatId, messageId, [
        {
          type: "emoji",
          emoji: token,
        } as unknown as import("grammy/types").ReactionType,
      ]);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async removeReaction(
    target: BotReplyTarget,
    messageRef: MessageRef,
    _emoji: EmojiValue,
  ): Promise<{ ok: boolean; error?: string }> {
    const r = messageRef as TelegramMessageRef;
    const chatId = r.chatId ?? (target as ReplyTarget).chatId;
    const messageId = Number(r.messageId ?? r.id);
    try {
      // Telegram clears the bot's reactions by setting an empty list.
      await this.bot.api.setMessageReaction(chatId, messageId, []);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  async postEphemeral(
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
      const sent = await this.bot.api.sendMessage(
        String(userId),
        payload.text,
        {
          ...(payload.parseMode ? { parse_mode: payload.parseMode } : {}),
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        },
      );
      return {
        ok: true,
        usedFallback: true,
        ref: {
          id: `${sent.chat.id}:${sent.message_id}`,
          chatId: sent.chat.id,
          messageId: sent.message_id,
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

  /** Map the renderer's inline keyboard to grammY's `reply_markup` shape. */
  private toReplyMarkup(
    keyboard: TelegramInlineButton[][] | undefined,
  ): { inline_keyboard: InlineKeyboardButton[][] } | undefined {
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

/** Construct a Telegram `PlatformAdapter`. */
export function telegram(opts: TelegramAdapterOptions): TelegramAdapter {
  return new TelegramAdapter(opts);
}
