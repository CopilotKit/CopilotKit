import type { IncomingReaction } from "@copilotkit/channels-core";
import type { IncomingTurn, ReplyTarget } from "./types.js";
import { decodeReaction } from "./interaction.js";
import type { PendingInteractions } from "./pending-interactions.js";

interface MessageLike {
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
  senderUserId: string;
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
}

/**
 * Wire Gateway events to normalized turns/commands. Mirrors attachSlackListener.
 * Every emitted turn carries a normalized `conversationKind` + `mentioned`
 * (plan §2), so the engine's product-driven response policy
 * (`decideChannelResponse`, channels-core) decides ignore / run-handler /
 * auto-run.
 *
 * Triggers (every real user message becomes a turn — the engine decides what
 * happens next):
 *   1. DM to the bot                 → `conversationKind: "direct_message"`.
 *   2. @-mention in a channel/thread  → `mentioned: true`.
 *   3. Plain guild channel/thread chatter (not a mention) → `conversationKind:
 *      "channel"`/`"thread"`, `mentioned: false`. §2 (ratified): forward it and
 *      let the engine's response policy decide, rather than dropping it here.
 *
 * Filters out only: the bot's own messages and other bots' messages (loop guard).
 */
export function attachDiscordListener(cfg: ListenerConfig): void {
  const { client, botUserId, onTurn, onCommand, onReaction, commandPending } =
    cfg;

  client.on("messageCreate", (msg: MessageLike) => {
    const botId = typeof botUserId === "function" ? botUserId() : botUserId;
    if (!isRealUserMessage(msg, botId)) return;
    const replyTarget = {
      channelId: msg.channelId,
      ...(msg.guildId ? { guildId: msg.guildId } : {}),
    };
    const isDM = msg.channel.isDMBased();
    // Only a DIRECT user mention counts (mirrors the pre-gut gate): `mentions.has()`
    // also returns true for role mentions and @everyone/@here that happen to
    // include the bot, so narrow to the explicit user-mention set.
    const mentioned = !isDM && (msg.mentions.users?.has?.(botId) ?? false);
    const conversationKind: IncomingTurn["conversationKind"] = isDM
      ? "direct_message"
      : msg.channel.isThread?.()
        ? "thread"
        : "channel";
    void Promise.resolve(
      onTurn({
        conversationKey: msg.channelId,
        replyTarget,
        userText: stripMention(msg.content, botId),
        senderUserId: msg.author.id,
        conversationKind,
        mentioned,
      }),
    ).catch((e) => console.error("[bot-discord] onTurn handler failed:", e));
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
        senderUserId: i.user.id,
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

/** Loop guard: skip our own messages and other bots' messages. Every other real user message is forwarded (§2). */
function isRealUserMessage(msg: MessageLike, botUserId: string): boolean {
  if (msg.author.id === botUserId) return false;
  if (msg.author.bot) return false;
  return true;
}

/** Drop a leading <@botId> / <@!botId> mention from the message text. */
function stripMention(content: string, botUserId: string): string {
  return content.replace(new RegExp(`<@!?${botUserId}>`, "g"), "").trim();
}
