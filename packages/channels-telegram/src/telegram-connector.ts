import { Bot, InputFile } from "grammy";
import type { InlineKeyboardButton } from "grammy/types";
import type { IngressSink } from "@copilotkit/channels-core";
import { attachTelegramListener } from "./listener.js";
import type { TelegramConversationStore } from "./conversation-store.js";

/** Update types that the Telegram adapter subscribes to. Includes
 * `message_reaction` so the bot receives emoji-reaction events.
 *
 * In **group** chats the bot must be an administrator to receive
 * `message_reaction` updates; private chats and channels work without
 * additional permissions.
 *
 * For **webhook** deployments pass this list to `setWebhook`:
 * ```ts
 * await connector.startIngress(...); // owns setWebhook internally
 * ```
 * Long-polling (`startIngress`) passes it automatically.
 */
export const TELEGRAM_ALLOWED_UPDATES = [
  "message",
  "edited_message",
  "callback_query",
  "message_reaction",
] as const;

/** A composite Telegram inline keyboard (rows of buttons), as sent to `reply_markup`. */
export type TelegramReplyMarkup = {
  inline_keyboard: InlineKeyboardButton[][];
};

/** The normalized result of `sendMessage`/`sendPhoto` — no raw grammY `Message` object crosses the port. */
export interface TelegramSentMessage {
  chatId: number | string;
  messageId: number;
}

/** A chat lookup result (backs `TelegramAdapter.lookupUser`). */
export interface TelegramConnectorChat {
  id: number | string;
  title?: string;
  first_name?: string;
  username?: string;
}

/** The result of a credentialed inbound-file download (backs `buildFileContentParts`). */
export interface TelegramDownloadResult {
  ok: boolean;
  /** HTTP status, set on both success and failure (when the request reached the server). */
  status?: number;
  /** The downloaded bytes; only set when `ok`. */
  bytes?: Buffer;
  /** Human-readable failure reason (token-redacted); set when not `ok` and no `status`. */
  error?: string;
}

/**
 * Everything the adapter hands the connector to start OWNING the live
 * Telegram connection (long-polling or webhook): the sink every normalized
 * turn/command/interaction/reaction lands on, plus the adapter's own
 * (credential-free) conversation store, whose `enqueueUserMessage`/
 * `recordMessage` the listener calls per turn. `downloadFile` is NOT part of
 * this config — it stays entirely connector-side (see {@link TelegramConnector.downloadFile}),
 * so no token ever reaches the listener or the conversation store.
 */
export interface TelegramIngressConfig {
  /** Where every normalized turn/command/interaction/reaction/thread-start lands. */
  sink: IngressSink;
  /** The adapter's conversation store (credential-free; enqueues/records turns). */
  store: TelegramConversationStore;
}

/**
 * Connection facts resolved once ingress starts (`getMe()`), handed back to
 * the adapter for its own bookkeeping (loop-guard / mention-stripping use
 * `botUserId`/`botUsername`).
 */
export interface TelegramIngressConnection {
  botUserId: number;
  botUsername: string;
}

/**
 * Every credentialed Telegram operation `TelegramAdapter` performs, behind a
 * port whose method signatures carry only serializable data (chat ids,
 * message ids, text, byte buffers) — never a grammY `Bot`/`Api` instance or a
 * bot token. The adapter holds NO credentials of its own — every method here
 * is reached only through a connector a runner INJECTS via
 * `TelegramAdapter.ɵbindConnector` (see adapter.ts); calling any adapter
 * egress method or `start()` before that throws.
 */
export interface TelegramConnector {
  /** `sendMessage` — post a text message. */
  sendMessage(args: {
    chatId: number | string;
    text: string;
    parseMode?: "HTML";
    messageThreadId?: number;
    replyMarkup?: TelegramReplyMarkup;
    replyToMessageId?: number;
  }): Promise<TelegramSentMessage>;

  /** `sendPhoto` — post a photo (optionally captioned). */
  sendPhoto(args: {
    chatId: number | string;
    url: string;
    caption?: string;
    messageThreadId?: number;
    replyMarkup?: TelegramReplyMarkup;
    replyToMessageId?: number;
  }): Promise<TelegramSentMessage>;

  /** `editMessageText` — edit an existing text message. */
  editMessageText(args: {
    chatId: number | string;
    messageId: number;
    text: string;
    parseMode?: "HTML";
    replyMarkup?: TelegramReplyMarkup;
  }): Promise<void>;

  /** `deleteMessage`. */
  deleteMessage(args: {
    chatId: number | string;
    messageId: number;
  }): Promise<void>;

  /** `sendChatAction` — native "typing…" indicator. */
  sendChatAction(args: {
    chatId: number | string;
    action: "typing";
    messageThreadId?: number;
  }): Promise<void>;

  /** `sendDocument` — backs `postFile`. */
  sendDocument(args: {
    chatId: number | string;
    bytes: Buffer;
    filename: string;
    messageThreadId?: number;
  }): Promise<{ fileId?: string }>;

  /** `getChat` — backs `lookupUser`. */
  getChat(query: string): Promise<TelegramConnectorChat | undefined>;

  /** `setMyCommands` — backs `registerCommands`. */
  setMyCommands(
    commands: { command: string; description: string }[],
  ): Promise<void>;

  /** `editForumTopic` — backs `setThreadTitle`. */
  editForumTopic(args: {
    chatId: number | string;
    messageThreadId: number;
    name: string;
  }): Promise<void>;

  /** `setMessageReaction` — backs `addReaction`/`removeReaction` (empty array clears). */
  setMessageReaction(args: {
    chatId: number | string;
    messageId: number;
    reactions: { type: "emoji"; emoji: string }[];
  }): Promise<void>;

  /**
   * Resolve `fileId` → its Telegram file path (`getFile`) and download the
   * bytes using the connector's own bot token. Never returns the token
   * itself; only bytes/status/a redacted error message cross the port.
   * `opts.maxBytesHint`, when set, lets the implementation abort via a
   * `Content-Length` pre-check before buffering an oversized response.
   */
  downloadFile(
    fileId: string,
    opts?: { maxBytesHint?: number },
  ): Promise<TelegramDownloadResult>;

  /**
   * Start OWNING the live Telegram connection: resolve our own identity via
   * `getMe()`, install the resilience boundary (`bot.catch`), attach the
   * (pure) normalization listener, and start long-polling or stand up the
   * webhook server per the connector's own configured mode. Resolves once
   * ingress is listening.
   */
  startIngress(
    config: TelegramIngressConfig,
  ): Promise<TelegramIngressConnection>;
  /** Stop the live connection started by {@link startIngress}. */
  stopIngress(): Promise<void>;
}

/** Constructor config for {@link GrammyTelegramConnector} — everything credential/transport-shaped now lives HERE, not on the adapter. */
export interface GrammyTelegramConnectorOptions {
  /** Bot token from @BotFather. */
  token: string;
  /** How to receive updates. Defaults to "polling" (long-polling); "webhook" and "auto" are opt-in. */
  mode?: "polling" | "webhook" | "auto";
  /** Webhook configuration (required when mode is "webhook", or "auto" resolves to webhook). */
  webhook?: {
    domain: string;
    path?: string;
    port?: number;
    secretToken?: string;
  };
}

/** Read a human-readable message off any thrown value. */
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The default {@link TelegramConnector}: CREDENTIAL-OWNING — constructed with
 * a bot `token` (+ optional ingress-mode config) and building the grammY
 * {@link Bot} internally. Nothing token-shaped ever crosses back out to the
 * adapter. A runner (custom `ChannelRunner`, or the managed Connector
 * Outbox's own implementation of this interface) constructs one of these —
 * or an equivalent — and injects it via `TelegramAdapter.ɵbindConnector`.
 *
 * Construction is side-effect-free — the grammY `Bot` is created but no
 * network call is made until {@link startIngress} (which owns `getMe()` +
 * ingress) or a credentialed egress method is called.
 */
export class GrammyTelegramConnector implements TelegramConnector {
  private readonly bot: Bot;
  private readonly token: string;
  private readonly mode: "polling" | "webhook" | "auto";
  private readonly webhookOpts: GrammyTelegramConnectorOptions["webhook"];
  /** In webhook mode, the Node HTTP server standing up the webhook endpoint. */
  private webhookServer?: import("node:http").Server;

  constructor(opts: GrammyTelegramConnectorOptions) {
    this.token = opts.token;
    this.mode = opts.mode ?? "polling";
    this.webhookOpts = opts.webhook;
    // SIDE-EFFECT-FREE: the grammY Bot constructor performs no network I/O.
    this.bot = new Bot(this.token);
  }

  /** Redact this connector's own token from an error message before it ever leaves the connector. */
  private redact(msg: string): string {
    return this.token ? msg.split(this.token).join("<redacted>") : msg;
  }

  private toOther(args: {
    parseMode?: "HTML";
    messageThreadId?: number;
    replyMarkup?: TelegramReplyMarkup;
    replyToMessageId?: number;
  }): Record<string, unknown> {
    const other: Record<string, unknown> = {};
    if (args.parseMode) other.parse_mode = args.parseMode;
    if (args.messageThreadId !== undefined) {
      other.message_thread_id = args.messageThreadId;
    }
    if (args.replyMarkup) other.reply_markup = args.replyMarkup;
    if (args.replyToMessageId !== undefined) {
      other.reply_parameters = { message_id: args.replyToMessageId };
    }
    return other;
  }

  async sendMessage(args: {
    chatId: number | string;
    text: string;
    parseMode?: "HTML";
    messageThreadId?: number;
    replyMarkup?: TelegramReplyMarkup;
    replyToMessageId?: number;
  }): Promise<TelegramSentMessage> {
    const sent = await this.bot.api.sendMessage(
      args.chatId,
      args.text,
      this.toOther(args),
    );
    return { chatId: sent.chat.id, messageId: sent.message_id };
  }

  async sendPhoto(args: {
    chatId: number | string;
    url: string;
    caption?: string;
    messageThreadId?: number;
    replyMarkup?: TelegramReplyMarkup;
    replyToMessageId?: number;
  }): Promise<TelegramSentMessage> {
    const other: Record<string, unknown> = {};
    if (args.caption) other.caption = args.caption;
    if (args.messageThreadId !== undefined) {
      other.message_thread_id = args.messageThreadId;
    }
    if (args.replyMarkup) other.reply_markup = args.replyMarkup;
    if (args.replyToMessageId !== undefined) {
      other.reply_parameters = { message_id: args.replyToMessageId };
    }
    const sent = await this.bot.api.sendPhoto(args.chatId, args.url, other);
    return { chatId: sent.chat.id, messageId: sent.message_id };
  }

  async editMessageText(args: {
    chatId: number | string;
    messageId: number;
    text: string;
    parseMode?: "HTML";
    replyMarkup?: TelegramReplyMarkup;
  }): Promise<void> {
    const other: Record<string, unknown> = {};
    if (args.parseMode) other.parse_mode = args.parseMode;
    if (args.replyMarkup) other.reply_markup = args.replyMarkup;
    await this.bot.api.editMessageText(
      args.chatId,
      args.messageId,
      args.text,
      other,
    );
  }

  async deleteMessage(args: {
    chatId: number | string;
    messageId: number;
  }): Promise<void> {
    await this.bot.api.deleteMessage(args.chatId, args.messageId);
  }

  async sendChatAction(args: {
    chatId: number | string;
    action: "typing";
    messageThreadId?: number;
  }): Promise<void> {
    await this.bot.api.sendChatAction(
      args.chatId,
      args.action,
      args.messageThreadId !== undefined
        ? { message_thread_id: args.messageThreadId }
        : {},
    );
  }

  async sendDocument(args: {
    chatId: number | string;
    bytes: Buffer;
    filename: string;
    messageThreadId?: number;
  }): Promise<{ fileId?: string }> {
    const result = await this.bot.api.sendDocument(
      args.chatId,
      new InputFile(args.bytes, args.filename),
      args.messageThreadId !== undefined
        ? { message_thread_id: args.messageThreadId }
        : {},
    );
    return { fileId: result.document?.file_id };
  }

  async getChat(query: string): Promise<TelegramConnectorChat | undefined> {
    try {
      const chat = (await this.bot.api.getChat(query)) as {
        id: number | string;
        title?: string;
        first_name?: string;
        username?: string;
      };
      return chat;
    } catch {
      return undefined;
    }
  }

  async setMyCommands(
    commands: { command: string; description: string }[],
  ): Promise<void> {
    await this.bot.api.setMyCommands(commands);
  }

  async editForumTopic(args: {
    chatId: number | string;
    messageThreadId: number;
    name: string;
  }): Promise<void> {
    await this.bot.api.editForumTopic(args.chatId, args.messageThreadId, {
      name: args.name,
    });
  }

  async setMessageReaction(args: {
    chatId: number | string;
    messageId: number;
    reactions: { type: "emoji"; emoji: string }[];
  }): Promise<void> {
    await this.bot.api.setMessageReaction(
      args.chatId,
      args.messageId,
      // grammy types ReactionTypeEmoji.emoji as a strict union of allowed
      // emoji; cast via unknown since we accept any pre-validated token.
      args.reactions as unknown as import("grammy/types").ReactionType[],
    );
  }

  async downloadFile(
    fileId: string,
    opts?: { maxBytesHint?: number },
  ): Promise<TelegramDownloadResult> {
    let filePath: string | undefined;
    try {
      const f = await this.bot.api.getFile(fileId);
      filePath = f.file_path;
    } catch (err) {
      return { ok: false, error: this.redact(errMsg(err)) };
    }
    if (!filePath) {
      return { ok: false, error: "no file_path returned" };
    }

    const url = `https://api.telegram.org/file/bot${this.token}/${filePath}`;
    try {
      const res = await fetch(url);
      if (!res.ok) return { ok: false, status: res.status };

      // Pre-check Content-Length to avoid buffering an oversized response
      // entirely into memory (memory-DoS guard for cases where the caller's
      // own file-size metadata is absent, e.g. photos).
      if (opts?.maxBytesHint !== undefined) {
        const contentLength = res.headers.get("content-length");
        if (contentLength !== null) {
          const declared = parseInt(contentLength, 10);
          if (!isNaN(declared) && declared > opts.maxBytesHint) {
            return {
              ok: false,
              error: `content-length ${declared} bytes exceeds cap (${opts.maxBytesHint} bytes)`,
            };
          }
        }
      }

      return {
        ok: true,
        status: res.status,
        bytes: Buffer.from(await res.arrayBuffer()),
      };
    } catch (err) {
      return { ok: false, error: this.redact(errMsg(err)) };
    }
  }

  /** Resolve the effective ingress mode, expanding "auto" by environment. */
  private resolveMode(): "polling" | "webhook" {
    if (this.mode === "polling") return "polling";
    if (this.mode === "webhook") return "webhook";
    // "auto": prefer webhook in serverless environments, else long-poll. But
    // only choose webhook when a domain is actually configured — otherwise
    // startWebhook() would throw, contradicting "auto"'s documented fallback
    // to polling. (Explicit mode: "webhook" without a domain still throws,
    // since that is a real misconfiguration.)
    const serverless =
      process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.NETLIFY;
    return serverless && this.webhookOpts?.domain ? "webhook" : "polling";
  }

  /**
   * Register the webhook with Telegram and stand up a minimal Node HTTP
   * server that feeds updates to grammY via {@link webhookCallback}.
   * Requires `webhookOpts.domain`.
   */
  private async startWebhook(): Promise<void> {
    const webhook = this.webhookOpts;
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
    // listener the emitted error becomes an uncaught exception that crashes
    // the process with a cryptic stack. Reject the start promise on the
    // first listen error so callers can handle it.
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

  async startIngress(
    config: TelegramIngressConfig,
  ): Promise<TelegramIngressConnection> {
    const me = await this.bot.api.getMe();
    const botUsername = me.username;
    const botUserId = me.id;

    // Resilience boundary. Without a registered error handler, grammy
    // rethrows any uncaught error from update processing, which stops the
    // polling runner; because start() has already returned, the event loop
    // then drains and the process exits silently (code 0). Catching here
    // logs the error and KEEPS the bot polling, and lets grammy advance the
    // offset so a failing update is consumed rather than re-delivered
    // forever (the "poison pill" loop).
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
      store: config.store,
      botUsername,
      botUserId,
      sink: config.sink,
      downloadFile: (fileId, opts) => this.downloadFile(fileId, opts),
    });

    const mode = this.resolveMode();
    if (mode === "webhook") {
      await this.startWebhook();
    } else {
      // Long-polling: bot.start() resolves only when the bot is stopped, so
      // we fire it (don't await to completion) and let it run in the
      // background. Surface a startup rejection (e.g. 409 "terminated by
      // other getUpdates request" or a revoked token) instead of swallowing
      // it silently.
      this.bot
        .start({ allowed_updates: [...TELEGRAM_ALLOWED_UPDATES] })
        .catch((err) =>
          console.error("[telegram] long-polling failed to start:", err),
        );
    }

    return { botUserId, botUsername };
  }

  async stopIngress(): Promise<void> {
    // Tear down the webhook server + registration before stopping the bot,
    // so a stop/restart cleanly rebinds the socket instead of leaking it.
    // Order: deleteWebhook first (so Telegram stops sending), then close the
    // local HTTP server (no more refused-socket errors on in-flight POSTs),
    // then stop the bot. The old reverse order (close server →
    // deleteWebhook) left a window where Telegram kept POSTing to an
    // already-closed socket.
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
}
