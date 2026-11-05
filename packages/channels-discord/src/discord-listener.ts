import type { IncomingReaction } from "@copilotkit/channels-core";
import type { ProviderActor } from "@copilotkit/channels-ui";
import type {
  IncomingTurn,
  ReplyTarget,
  DiscordRespondToOptions,
  DiscordMentionReplyMode,
} from "./types.js";
import { resolveDiscordRespondToOptions } from "./types.js";
import { decodeReaction } from "./interaction.js";
import type { PendingInteractions } from "./pending-interactions.js";

interface MessageLike {
  id: string;
  author: {
    id: string;
    bot?: boolean;
    username?: string;
    globalName?: string | null;
  };
  content: string;
  channelId: string;
  guildId?: string | null;
  mentions: { has(id: string): boolean; users?: { has(id: string): boolean } };
  channel: { isDMBased(): boolean; isThread?(): boolean };
  /**
   * discord.js `Message#startThread`. Optional so existing fakes keep working;
   * when it is missing the mention simply replies in the channel.
   */
  startThread?(options: {
    name: string;
    autoArchiveDuration?: number;
  }): Promise<{ id: string }>;
}

interface ChatInputLike {
  isChatInputCommand(): boolean;
  /** Discord interaction id — used as the pending-interaction triggerId. */
  id: string;
  commandName: string;
  channelId: string;
  guildId?: string | null;
  user: { id: string; username?: string; globalName?: string | null };
  options: { data: ReadonlyArray<{ name: string; value: unknown }> };
  /** discord.js interaction state — set once the interaction has been deferred. */
  deferred?: boolean;
  /** discord.js interaction state — set once a reply has been sent. */
  replied?: boolean;
  /** Remove the (deferred) reply. Used to clear a dangling ephemeral ack. */
  deleteReply?: () => Promise<unknown>;
}

export interface ClientLike {
  on(event: "messageCreate", cb: (msg: MessageLike) => void): void;
  on(event: "interactionCreate", cb: (i: ChatInputLike) => void): void;
  on(
    event: "messageReactionAdd" | "messageReactionRemove",
    cb: (reaction: unknown, user: unknown) => void,
  ): void;
  on(event: string, cb: (arg: unknown) => void): void;
}

export interface IncomingCommandRaw {
  command: string;
  text: string;
  rawOptions: Record<string, unknown>;
  conversationKey: string;
  replyTarget: ReplyTarget;
  actor: ProviderActor;
  raw: unknown;
  /** Pending-interaction triggerId (the live interaction id) — backs `openModal`. */
  triggerId?: string;
}

export interface ListenerConfig {
  client: ClientLike;
  /**
   * The bot's own user id. May be a getter so the adapter can attach the
   * listener once at startup and supply the id lazily after the `ready`
   * event (when it first becomes known).
   */
  botUserId: string | (() => string);
  onTurn(turn: IncomingTurn): void | Promise<void>;
  onCommand(cmd: IncomingCommandRaw): void | Promise<void>;
  /** Optional: called when a user adds or removes a reaction. */
  onReaction?: (evt: IncomingReaction) => void | Promise<void>;
  /**
   * Pending-interaction registry for slash commands. The live command
   * interaction is registered (arming an auto-`deferReply`), dispatched with a
   * `triggerId` so a handler may `openModal` first, then settled. When absent,
   * the command path skips registration (no modal support / no ack).
   */
  commandPending?: PendingInteractions;
  /** Where an @mention replies. Defaults to a thread, matching Slack. */
  respondTo?: DiscordRespondToOptions;
}

/** Wire Gateway events to normalized turns/commands. Mirrors attachSlackListener. */
export function attachDiscordListener(cfg: ListenerConfig): void {
  const { client, botUserId, onTurn, onCommand, onReaction, commandPending } =
    cfg;
  const respondTo = resolveDiscordRespondToOptions(cfg.respondTo);

  client.on("messageCreate", (msg: MessageLike) => {
    const botId = typeof botUserId === "function" ? botUserId() : botUserId;
    if (!shouldAnswer(msg, botId)) return;
    // Opening a thread is an API call, so the reply target is resolved
    // asynchronously before the turn is dispatched. The conversation key
    // follows the target: a threaded answer is its own conversation, keyed on
    // the thread's channel id.
    void (async () => {
      const replyTarget = await mentionReplyTarget(
        msg,
        botId,
        respondTo.appMentions.reply,
      );
      await onTurn({
        conversationKey: replyTarget.channelId,
        messageId: msg.id,
        mentioned: msg.mentions.has(botId),
        replyTarget,
        userText: stripMention(msg.content, botId),
        actor: {
          id: msg.author.id,
          kind: msg.author.bot ? "bot" : "human",
          name: msg.author.globalName ?? msg.author.username,
          handle: msg.author.username,
        },
        raw: msg,
      });
    })().catch((e) => console.error("[bot-discord] onTurn handler failed:", e));
  });

  client.on("interactionCreate", async (i: ChatInputLike) => {
    if (typeof i?.isChatInputCommand !== "function" || !i.isChatInputCommand())
      return;
    // Register the live interaction with the timer-race registry, arming an
    // auto-`deferReply` ~500ms before Discord's 3s window. This replaces the
    // old eager `i.reply(...)` so a handler can `openModal` first; if it
    // doesn't, `settle` acks (deferReply) and the real reply is delivered
    // out-of-band as a channel message.
    const triggerId = commandPending?.register(i as never);
    const rawOptions: Record<string, unknown> = {};
    for (const opt of i.options?.data ?? []) rawOptions[opt.name] = opt.value;
    const replyTarget = {
      channelId: i.channelId,
      ...(i.guildId ? { guildId: i.guildId } : {}),
    };
    try {
      await onCommand({
        command: i.commandName,
        text: Object.values(rawOptions).map(String).join(" "),
        rawOptions,
        conversationKey: i.channelId,
        replyTarget,
        actor: {
          id: i.user.id,
          kind: "human",
          name: i.user.globalName ?? i.user.username,
          handle: i.user.username,
        },
        raw: i,
        triggerId,
      });
    } catch (e) {
      console.error("[bot-discord] onCommand handler failed:", e);
    } finally {
      if (triggerId !== undefined) await commandPending?.settle(triggerId);
      // The deferReply(ephemeral) auto-ack only satisfies Discord's 3s window;
      // the real response is delivered out-of-band as channel messages, so
      // remove the dangling ephemeral "thinking…" once dispatch completes. A
      // modal (showModal) does not defer, so `i.deferred` is false there and
      // this is skipped; likewise if the handler itself already replied.
      try {
        if (i.deferred && !i.replied) await i.deleteReply?.();
      } catch {
        /* interaction already gone / cleared */
      }
    }
  });

  if (onReaction) {
    const handleReaction =
      (added: boolean) => async (reaction: unknown, user: unknown) => {
        const botId = typeof botUserId === "function" ? botUserId() : botUserId;
        const u = user as { bot?: boolean; id?: string };
        // Skip the bot's own reaction. `u.bot` is `undefined` on a PARTIAL user
        // (the uncached path these handlers support via Partials), so also guard
        // by id — matching the other platforms' bot-id guard.
        if (u?.bot || u?.id === botId) return;
        try {
          const r = reaction as {
            partial?: boolean;
            fetch?(): Promise<unknown>;
            message?: { partial?: boolean; fetch?(): Promise<unknown> };
          };
          if (r.partial) await r.fetch?.();
          if (r.message?.partial) await r.message.fetch?.();
        } catch {
          return;
        }
        // Keep the sink dispatch inside a try/catch so a throwing/rejecting
        // user handler degrades-never-throws instead of escaping as an
        // unhandled rejection — mirroring the onTurn/onCommand paths above.
        try {
          const evt = decodeReaction(reaction, user, added);
          if (evt) await onReaction(evt);
        } catch (e) {
          console.error("[bot-discord] onReaction handler failed:", e);
        }
      };

    client.on("messageReactionAdd", handleReaction(true));
    client.on("messageReactionRemove", handleReaction(false));
  }
}

/** Answer @-mentions and DMs; skip our own messages and other bots. */
/** 24 hours. The one auto-archive value every guild can use. */
const THREAD_AUTO_ARCHIVE_MINUTES = 1440;
/** Discord's hard limit on a thread name. */
const THREAD_NAME_MAX = 100;

/**
 * Resolve where an @mention is answered.
 *
 * Slack expresses this as a pure branch, because posting with `thread_ts` is
 * the whole operation. Discord has to create the thread first, so this can
 * fail — and a failure must never cost the user their turn. Every path that
 * cannot open a thread falls back to replying in the channel.
 */
async function mentionReplyTarget(
  msg: MessageLike,
  botUserId: string,
  mode: DiscordMentionReplyMode,
): Promise<ReplyTarget> {
  const base: ReplyTarget = {
    channelId: msg.channelId,
    ...(msg.guildId ? { guildId: msg.guildId } : {}),
  };
  if (mode !== "thread") return base;
  // A DM cannot hold a thread. A message already inside one is answered there,
  // mirroring Slack, where `thread_ts` falls back to the message's own `ts`.
  if (msg.channel.isDMBased()) return base;
  if (msg.channel.isThread?.()) return base;
  // Threading is for mentions only, like Slack's `appMentions`. A DM reaching
  // this point is already excluded above.
  if (!(msg.mentions.users?.has?.(botUserId) ?? false)) return base;
  if (typeof msg.startThread !== "function") return base;

  try {
    const thread = await msg.startThread({
      name: threadName(stripMention(msg.content, botUserId)),
      autoArchiveDuration: THREAD_AUTO_ARCHIVE_MINUTES,
    });
    return { ...base, channelId: thread.id };
  } catch (e) {
    // Usually a missing CREATE_PUBLIC_THREADS permission. Replying in the
    // channel is not what was configured, but it is far better than silence.
    console.error(
      "[bot-discord] could not open a thread; replying in the channel instead:",
      e,
    );
    return base;
  }
}

/** A thread needs a name; Discord rejects an empty one and caps it at 100. */
function threadName(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) return "New conversation";
  return trimmed.length > THREAD_NAME_MAX
    ? `${trimmed.slice(0, THREAD_NAME_MAX - 1)}…`
    : trimmed;
}

function shouldAnswer(msg: MessageLike, botUserId: string): boolean {
  if (msg.author.id === botUserId) return false;
  if (msg.author.bot) return false;
  if (msg.channel.isDMBased()) return true;
  // Only answer a DIRECT user mention. discord.js `mentions.has()` also returns
  // true for role mentions and @everyone/@here that happen to include the bot,
  // so narrow to the explicit user-mention set.
  return msg.mentions.users?.has?.(botUserId) ?? false;
}

/** Drop a leading <@botId> / <@!botId> mention from the message text. */
function stripMention(content: string, botUserId: string): string {
  return content.replace(new RegExp(`<@!?${botUserId}>`, "g"), "").trim();
}
