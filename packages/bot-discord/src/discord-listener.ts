import { MessageFlags } from "discord.js";
import type { IncomingTurn, ReplyTarget } from "./types.js";

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
  channel: { isDMBased(): boolean };
  /**
   * discord.js `Message.attachments` is a Collection; we only use `.values()`
   * to iterate the uploaded files. Optional so plain test fakes can omit it.
   */
  attachments?: {
    values(): IterableIterator<{
      url: string;
      name: string;
      contentType?: string | null;
      size: number;
    }>;
  };
}

interface ChatInputLike {
  isChatInputCommand(): boolean;
  commandName: string;
  channelId: string;
  guildId?: string | null;
  user: { id: string; username?: string; globalName?: string | null };
  options: { data: ReadonlyArray<{ name: string; value: unknown }> };
  reply(options: { content: string; flags?: number }): Promise<unknown>;
}

export interface ClientLike {
  on(event: "messageCreate", cb: (msg: MessageLike) => void): void;
  on(event: "interactionCreate", cb: (i: ChatInputLike) => void): void;
  on(event: string, cb: (arg: unknown) => void): void;
}

export interface IncomingCommandRaw {
  command: string;
  text: string;
  rawOptions: Record<string, unknown>;
  conversationKey: string;
  replyTarget: ReplyTarget;
  senderUserId: string;
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
}

/** Wire Gateway events to normalized turns/commands. Mirrors attachSlackListener. */
export function attachDiscordListener(cfg: ListenerConfig): void {
  const { client, botUserId, onTurn, onCommand } = cfg;

  client.on("messageCreate", (msg: MessageLike) => {
    const botId = typeof botUserId === "function" ? botUserId() : botUserId;
    if (!shouldAnswer(msg, botId)) return;
    const replyTarget = {
      channelId: msg.channelId,
      ...(msg.guildId ? { guildId: msg.guildId } : {}),
    };
    void Promise.resolve(
      onTurn({
        conversationKey: msg.channelId,
        replyTarget,
        userText: stripMention(msg.content, botId),
        senderUserId: msg.author.id,
        attachments: msg.attachments
          ? Array.from(msg.attachments.values()).map((a) => ({
              url: a.url,
              name: a.name,
              contentType: a.contentType,
              size: a.size,
            }))
          : undefined,
      }),
    ).catch((e) => console.error("[bot-discord] onTurn handler failed:", e));
  });

  client.on("interactionCreate", async (i: ChatInputLike) => {
    if (typeof i?.isChatInputCommand !== "function" || !i.isChatInputCommand())
      return;
    // Ack within Discord's 3s window. The real reply is delivered out-of-band as a
    // channel message, so ack with a minimal ephemeral note (visible only to the invoker).
    try {
      await i.reply({
        content: "On it — posting the response in this channel…",
        flags: MessageFlags.Ephemeral,
      });
    } catch (e) {
      console.error("[bot-discord] failed to ack command interaction:", e);
    }
    const rawOptions: Record<string, unknown> = {};
    for (const opt of i.options?.data ?? []) rawOptions[opt.name] = opt.value;
    const replyTarget = {
      channelId: i.channelId,
      ...(i.guildId ? { guildId: i.guildId } : {}),
    };
    void Promise.resolve(
      onCommand({
        command: i.commandName,
        text: Object.values(rawOptions).map(String).join(" "),
        rawOptions,
        conversationKey: i.channelId,
        replyTarget,
        senderUserId: i.user.id,
      }),
    ).catch((e) => console.error("[bot-discord] onCommand handler failed:", e));
  });
}

/** Answer @-mentions and DMs; skip our own messages and other bots. */
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
