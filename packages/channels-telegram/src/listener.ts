import type { Bot } from "grammy";
import type { IngressSink } from "@copilotkit/channels-core";
import type { TelegramConversationStore } from "./conversation-store.js";
import {
  conversationKeyOf,
  deriveConversationKey,
  toPlatformUser,
  decodeInteraction,
  decodeReaction,
} from "./interaction.js";
import { buildFileContentParts } from "./download-files.js";
import type { AgentContentPart, TelegramFileRef } from "./download-files.js";

/** Escape special regex characters in a string so it can be used in a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface ListenerConfig {
  bot: Bot;
  store: TelegramConversationStore;
  botUsername: string;
  botUserId: number;
  sink: IngressSink;
  /** Telegram bot token, used to download inbound files. */
  botToken: string;
  /** Resolve a Telegram fileId to its file path (e.g. via the getFile API). */
  getFilePath: (fileId: string) => Promise<string>;
}

/** The media-bearing fields the listener knows how to turn into file refs. */
interface TgMediaFields {
  text?: string;
  caption?: string;
  photo?: { file_id: string }[];
  document?: {
    file_id: string;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
  };
  video?: { file_id: string; mime_type?: string; file_size?: number };
  audio?: { file_id: string; mime_type?: string; file_size?: number };
  voice?: { file_id: string; mime_type?: string; file_size?: number };
}

/** The referenced message when the inbound message is a Telegram reply. */
interface TgReplyMessage extends TgMediaFields {
  from?: { id: number };
  message_id: number;
}

/** A grammY message shape (the subset the listener reads). */
interface TgMessage {
  message_id: number;
  message_thread_id?: number;
  text?: string;
  caption?: string;
  from?: {
    id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
  };
  reply_to_message?: TgReplyMessage;
  chat: { id: number | string; type: string; is_forum?: boolean };
}

/**
 * Extract downloadable file refs from any media-bearing message (used for the
 * message a user *replied to*). Mirrors the per-type extraction in the
 * `message:*` handlers — photo (largest size), document, video, audio, voice.
 */
function fileRefsFromMessage(m: TgMediaFields): TelegramFileRef[] {
  if (m.photo?.length) {
    const largest = m.photo[m.photo.length - 1];
    // Telegram re-encodes most photos to JPEG (see the message:photo handler).
    if (largest) return [{ fileId: largest.file_id, mimeType: "image/jpeg" }];
  }
  if (m.document) {
    return [
      {
        fileId: m.document.file_id,
        fileName: m.document.file_name,
        mimeType: m.document.mime_type,
        size: m.document.file_size,
      },
    ];
  }
  for (const media of [m.video, m.audio, m.voice]) {
    if (media) {
      return [
        {
          fileId: media.file_id,
          mimeType: media.mime_type,
          size: media.file_size,
        },
      ];
    }
  }
  return [];
}

export function attachTelegramListener(config: ListenerConfig): void {
  const { bot, botUsername, botUserId, sink, store, botToken, getFilePath } =
    config;

  /**
   * When the inbound message is a Telegram *reply*, fold the referenced
   * message's content into the turn so the agent knows what the user is
   * pointing at — e.g. replying to an earlier image with "what's in it". Its
   * media is downloaded (reusing the inbound-file pipeline) and its text is
   * quoted. Returns [] when the replied-to message carries nothing usable.
   */
  async function buildReplyContextParts(
    reply: TgReplyMessage,
  ): Promise<AgentContentPart[]> {
    const refs = fileRefsFromMessage(reply);
    const quotedRaw = (reply.text ?? reply.caption ?? "").trim();
    const quoted =
      quotedRaw.length > 500 ? `${quotedRaw.slice(0, 500)}…` : quotedRaw;
    if (refs.length === 0 && !quoted) return [];

    const desc = [
      quoted ? `text: "${quoted}"` : null,
      refs.length ? "an attached file" : null,
    ]
      .filter(Boolean)
      .join(" and ");
    const parts: AgentContentPart[] = [
      { type: "text", text: `[In reply to an earlier message — ${desc}:]` },
    ];
    if (refs.length) {
      const { parts: fileParts, notes } = await buildFileContentParts(
        refs,
        botToken,
        getFilePath,
      );
      parts.push(...fileParts);
      if (notes.length) {
        parts.push({
          type: "text",
          text: `[attachment notes: ${notes.join("; ")}]`,
        });
      }
    }
    return parts;
  }

  /**
   * Apply loop-guard + group gating and (when answered) enqueue the user's
   * message onto the store and emit `onTurn`. Returns without effect when the
   * turn should be ignored (own message, or un-addressed group message).
   *
   * @param ctx          grammY context (provides `chat`).
   * @param msg          the inbound message.
   * @param userText     the addressing text used for gating + handler context
   *                     (text body or media caption; "" when absent).
   * @param buildContent produces the agent message content for an answered
   *                     turn — the mention-stripped string for text, or an
   *                     array of content parts for media.
   */
  async function handleTurn(
    ctx: { chat: { id: number | string; type: string; is_forum?: boolean } },
    msg: TgMessage,
    userText: string,
    buildContent: (strippedText: string) => string | AgentContentPart[],
  ): Promise<void> {
    const from = msg.from;

    // LOOP GUARD: ignore our own messages.
    if (from?.id === botUserId) return;

    // Bug 4 fix: guard against an empty botUsername. `@${escapeRegExp("")}\b`
    // would be `/@\b/`, which matches a bare "@". When botUsername is empty
    // there is no mention to match, so use a regex that never matches.
    const mentionRegex = botUsername
      ? new RegExp(`@${escapeRegExp(botUsername)}\\b`, "i")
      : undefined;

    // Decide whether to answer.
    const chatType = ctx.chat.type;
    let shouldAnswer = false;
    if (chatType === "private") {
      shouldAnswer = true;
    } else {
      // group / supergroup: answer if @mentioned (case-insensitive, word-boundary)
      // or reply to bot's message.
      const mentionedBot = mentionRegex?.test(userText) ?? false;
      const replyToBot = msg.reply_to_message?.from?.id === botUserId;
      shouldAnswer = mentionedBot || replyToBot;
    }
    if (!shouldAnswer) return;

    // Bug 1 & 2 fix: strip the @mention wherever it appears (first occurrence),
    // case-insensitively, collapsing surrounding whitespace so the agent gets
    // clean text. With no botUsername there is nothing to strip.
    let strippedText = (
      mentionRegex ? userText.replace(mentionRegex, "") : userText
    )
      .replace(/\s{2,}/g, " ")
      .trim();

    const turnConversationKey = conversationKeyOf(deriveConversationKey(msg));

    // Build the agent content, then fold in any replied-to message so the
    // agent can resolve a Telegram reply ("what's in this image" pointing at an
    // earlier photo). Reply context is appended after the user's own content.
    let content = buildContent(strippedText);
    if (msg.reply_to_message) {
      const replyParts = await buildReplyContextParts(msg.reply_to_message);
      if (replyParts.length) {
        const baseParts: AgentContentPart[] =
          typeof content === "string"
            ? content
              ? [{ type: "text", text: content }]
              : []
            : content;
        content = [...baseParts, ...replyParts];
      }
    }

    // Enqueue the user's message so getOrCreate delivers it to the agent. The
    // listener runs before the bot handler that calls runAgent → getOrCreate,
    // so the drain happens at exactly the right time.
    store.enqueueUserMessage(turnConversationKey, content);

    // Bug 3 fix: record the inbound user turn so getMessages() includes it.
    // Record the STRIPPED text (the same clean text handed to the agent, not
    // the raw text including the @mention) and stamp `ts` so history ordering
    // matches the outbound records.
    config.store.recordMessage(turnConversationKey, {
      text: strippedText,
      ts: String(msg.message_id),
      isBot: false,
      user: from ? toPlatformUser(from) : undefined,
    });

    // CRITICAL: run the turn WITHOUT blocking grammY's poll loop. grammY's
    // built-in long polling processes updates SEQUENTIALLY — it awaits one
    // update's handler before fetching the next. If we awaited the full turn
    // here, a blocking human-in-the-loop step (confirm_write → awaitChoice)
    // would pause polling indefinitely: the callback_query that resolves the
    // choice can only arrive via the next getUpdates, which never happens while
    // this handler is blocked. With no in-flight poll request (and only a
    // pending promise, which does not ref the event loop) the process would
    // then drain and exit(0) silently — a deadlock, not a crash. Firing the
    // turn async lets polling continue and deliver that callback. Errors are
    // logged here since nothing awaits the promise.
    void Promise.resolve(
      sink.onTurn({
        conversationKey: turnConversationKey,
        replyTarget: {
          chatId: ctx.chat.id,
          // Only attach a forum thread id in forum supergroups. In non-forum
          // chats Telegram sets message_thread_id on reply messages, but
          // attaching it to a send is rejected ("message thread not found").
          messageThreadId: ctx.chat.is_forum
            ? msg.message_thread_id
            : undefined,
          replyToMessageId: msg.message_id,
          conversationKey: turnConversationKey,
        },
        userText: strippedText,
        user: from ? toPlatformUser(from) : undefined,
        platform: "telegram",
      }),
    ).catch((e: unknown) => {
      console.error(
        `[bot-telegram] turn failed for conversationKey=${turnConversationKey}:`,
        e,
      );
    });
  }

  /** Build media content parts from file refs + caption, then route the turn. */
  async function handleMedia(
    ctx: {
      chat: { id: number | string; type: string; is_forum?: boolean };
      message?: TgMessage;
    },
    fileRefs: TelegramFileRef[],
  ): Promise<void> {
    const msg = ctx.message;
    if (!msg) return;

    // LOOP GUARD up-front to avoid downloading files for our own messages.
    if (msg.from?.id === botUserId) return;

    const caption = msg.caption ?? "";

    // Gating is applied inside handleTurn against the caption; only build the
    // (potentially expensive) file parts once we know the turn is answered.
    // Bug 1 fix: use case-insensitive, word-boundary regex for mention check.
    // Bug 4 fix: guard against an empty botUsername (see handleTurn).
    const mediaMentionRegex = botUsername
      ? new RegExp(`@${escapeRegExp(botUsername)}\\b`, "i")
      : undefined;
    const chatType = ctx.chat.type;
    let shouldAnswer = chatType === "private";
    if (!shouldAnswer) {
      const mentionedBot = mediaMentionRegex?.test(caption) ?? false;
      const replyToBot = msg.reply_to_message?.from?.id === botUserId;
      shouldAnswer = mentionedBot || replyToBot;
    }
    if (!shouldAnswer) return;

    const { parts, notes } = await buildFileContentParts(
      fileRefs,
      botToken,
      getFilePath,
    );

    await handleTurn(ctx, msg, caption, (strippedCaption) => [
      ...(strippedCaption
        ? [{ type: "text", text: strippedCaption } as const]
        : []),
      ...parts,
      ...(notes.length
        ? [
            {
              type: "text",
              text: `[attachment notes: ${notes.join("; ")}]`,
            } as const,
          ]
        : []),
    ]);
  }

  // ── Text messages ──────────────────────────────────────────────────
  bot.on("message:text", async (ctx) => {
    const msg = ctx.message as TgMessage;
    const from = msg.from;

    // LOOP GUARD: ignore our own messages.
    if (from?.id === botUserId) return;

    const text = msg.text ?? "";
    const entities =
      (msg as { entities?: { type: string; offset: number; length: number }[] })
        .entities ?? [];
    const cmdEntity = entities.find(
      (e) => e.type === "bot_command" && e.offset === 0,
    );

    if (cmdEntity) {
      // Extract the command token (e.g. "/triage" or "/triage@cpk_bot")
      const cmdToken = text.slice(
        cmdEntity.offset,
        cmdEntity.offset + cmdEntity.length,
      );
      // Parse: /cmd[@bot]
      const withoutSlash = cmdToken.slice(1); // strip leading "/"
      const atIdx = withoutSlash.indexOf("@");
      let cmd: string;
      let targetBot: string | undefined;
      if (atIdx !== -1) {
        cmd = withoutSlash.slice(0, atIdx);
        targetBot = withoutSlash.slice(atIdx + 1);
      } else {
        cmd = withoutSlash;
        targetBot = undefined;
      }

      // If targeted at another bot, ignore. Guard against an undefined/empty
      // botUsername (consistent with the mention-path guard): when we have no
      // username we cannot prove the command targets us, so skip the compare
      // and let it through rather than throwing on `botUsername.toLowerCase()`.
      if (
        targetBot !== undefined &&
        botUsername &&
        targetBot.toLowerCase() !== botUsername.toLowerCase()
      ) {
        return;
      }

      // Bug 2 fix: `/start` is handled exclusively by the dedicated
      // bot.command("start") handler (which emits onThreadStarted). Returning
      // early here prevents a double-dispatch where both onCommand("start") and
      // onThreadStarted fire for the same /start message.
      if (cmd.toLowerCase() === "start") {
        return;
      }

      // Rest of the text after the command token
      const rest = text.slice(cmdEntity.offset + cmdEntity.length).trim();

      const commandConversationKey = conversationKeyOf(
        deriveConversationKey(msg),
      );
      // Commands do NOT enqueue: their args are injected by the command handler
      // via runAgent({ prompt }), so enqueuing here would double-deliver.
      // Fire async (not awaited) for the same reason as onTurn above — a command
      // whose agent hits confirm_write must not block grammY's poll loop.
      void Promise.resolve(
        sink.onCommand({
          command: cmd.toLowerCase(),
          text: rest,
          conversationKey: commandConversationKey,
          replyTarget: {
            chatId: ctx.chat.id,
            // Forum thread id only in forum supergroups (see onTurn above).
            messageThreadId: ctx.chat.is_forum
              ? msg.message_thread_id
              : undefined,
            conversationKey: commandConversationKey,
          },
          user: from ? toPlatformUser(from) : undefined,
          platform: "telegram",
        }),
      ).catch((e: unknown) =>
        console.error("[bot-telegram] command failed:", e),
      );
      return;
    }

    // Non-command text: gate, enqueue the (mention-stripped) text, emit onTurn.
    await handleTurn(ctx, msg, text, (strippedText) => strippedText);
  });

  // ── Media messages ─────────────────────────────────────────────────
  bot.on("message:photo", async (ctx) => {
    const photos =
      (ctx.message as { photo?: { file_id: string }[] }).photo ?? [];
    const largest = photos[photos.length - 1];
    if (!largest) return;
    // Bug 5: at this point we only have the file_id, not the bytes, so we
    // cannot sniff the real MIME type here. Telegram re-encodes most photos to
    // JPEG, so "image/jpeg" is a reasonable default. Telegram photos can in
    // principle be PNG/WebP; refining the MIME from the download response's
    // Content-Type belongs in the download layer (out of scope for this file).
    await handleMedia(ctx as never, [
      { fileId: largest.file_id, mimeType: "image/jpeg" },
    ]);
  });

  bot.on("message:document", async (ctx) => {
    const doc = (
      ctx.message as {
        document?: {
          file_id: string;
          file_name?: string;
          mime_type?: string;
          file_size?: number;
        };
      }
    ).document;
    if (!doc) return;
    await handleMedia(ctx as never, [
      {
        fileId: doc.file_id,
        fileName: doc.file_name,
        mimeType: doc.mime_type,
        size: doc.file_size,
      },
    ]);
  });

  bot.on("message:video", async (ctx) => {
    const video = (
      ctx.message as {
        video?: { file_id: string; mime_type?: string; file_size?: number };
      }
    ).video;
    if (!video) return;
    await handleMedia(ctx as never, [
      {
        fileId: video.file_id,
        mimeType: video.mime_type,
        size: video.file_size,
      },
    ]);
  });

  bot.on("message:audio", async (ctx) => {
    const audio = (
      ctx.message as {
        audio?: { file_id: string; mime_type?: string; file_size?: number };
      }
    ).audio;
    if (!audio) return;
    await handleMedia(ctx as never, [
      {
        fileId: audio.file_id,
        mimeType: audio.mime_type,
        size: audio.file_size,
      },
    ]);
  });

  bot.on("message:voice", async (ctx) => {
    const voice = (
      ctx.message as {
        voice?: { file_id: string; mime_type?: string; file_size?: number };
      }
    ).voice;
    if (!voice) return;
    await handleMedia(ctx as never, [
      {
        fileId: voice.file_id,
        mimeType: voice.mime_type,
        size: voice.file_size,
      },
    ]);
  });

  // ── Callback queries (inline keyboard interactions) ─────────────────
  bot.on("callback_query:data", async (ctx) => {
    // Ack FIRST to clear the client spinner. The ack itself may throw (e.g. a
    // stale button → "query is too old"); that must NOT block decode/dispatch,
    // otherwise the awaitChoice waiter is stranded. Wrap it in its own
    // try/catch, log on failure, then ALWAYS decode + dispatch.
    try {
      await ctx.answerCallbackQuery();
    } catch (err) {
      console.error("[bot-telegram] callback ack failed:", err);
    }
    // Guard the dispatch: a throw here (decode, action handler, or the resumed
    // agent turn) must NOT escape into grammy's poll loop and crash the bot.
    try {
      const evt = decodeInteraction(ctx.update);
      if (evt) {
        await sink.onInteraction(evt);
      }
    } catch (err) {
      console.error("[bot-telegram] onInteraction failed:", err);
    }
  });

  // ── Emoji reactions ────────────────────────────────────────────────
  bot.on("message_reaction", async (ctx) => {
    // LOOP GUARD: ignore the bot's OWN reactions. If our setMessageReaction
    // egress is ever echoed back as a message_reaction update, dispatching it
    // to sink.onReaction would treat it as a user reaction (loop risk for a
    // catch-all handler). Mirrors the from?.id === botUserId guard the message
    // handlers use, and Discord's user?.bot skip.
    const reactor = (
      ctx.update as { message_reaction?: { user?: { id?: number } } }
    ).message_reaction?.user;
    if (reactor?.id === botUserId) return;

    try {
      for (const evt of decodeReaction(ctx.update)) await sink.onReaction(evt);
    } catch (err) {
      console.error("[bot-telegram] onReaction failed:", err);
    }
  });

  // ── /start command (private chats only) ────────────────────────────
  bot.command("start", async (ctx) => {
    if (ctx.chat.type !== "private") return;
    const msg = ctx.message;
    if (!msg) return;
    const startConversationKey = conversationKeyOf(deriveConversationKey(msg));
    await sink.onThreadStarted({
      conversationKey: startConversationKey,
      replyTarget: {
        chatId: ctx.chat.id,
        conversationKey: startConversationKey,
      },
      user: msg.from ? toPlatformUser(msg.from) : undefined,
      platform: "telegram",
    });
  });
}
