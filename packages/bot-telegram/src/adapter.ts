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
} from "@copilotkit/bot";
import type { BotNode, ThreadMessage } from "@copilotkit/bot-ui";
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
    supportsReactions: false,
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
        .start()
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

  render(ir: BotNode[]): TelegramPayload {
    return renderTelegram(ir);
  }

  async post(target: BotReplyTarget, ir: BotNode[]): Promise<MessageRef> {
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

  async update(ref: MessageRef, ir: BotNode[]): Promise<void> {
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
            this.bot.api.editMessageText(t.chatId, messageId, o.text, {
              ...(o.parseMode ? { parse_mode: o.parseMode } : {}),
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
            this.bot.api.editMessageText(t.chatId, messageId, o.text, {
              ...(o.parseMode ? { parse_mode: o.parseMode } : {}),
            }),
          text,
        );
      },
      setTyping: async () => {
        await this.bot.api.sendChatAction(t.chatId, "typing", {
          ...(t.messageThreadId !== undefined
            ? { message_thread_id: t.messageThreadId }
            : {}),
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
    await this.bot.api.setMyCommands(
      specs.map((s) => ({
        command: s.name,
        description: s.description ?? s.name,
      })),
    );
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
