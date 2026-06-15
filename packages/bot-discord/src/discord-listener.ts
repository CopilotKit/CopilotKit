import type { IncomingTurn } from "./types.js";

interface MessageLike {
  author: { id: string; bot?: boolean; username?: string; globalName?: string | null };
  content: string;
  channelId: string;
  guildId?: string | null;
  mentions: { has(id: string): boolean };
  channel: { isDMBased(): boolean };
}

interface ChatInputLike {
  isChatInputCommand(): boolean;
  commandName: string;
  channelId: string;
  guildId?: string | null;
  user: { id: string; username?: string; globalName?: string | null };
  options: { data: ReadonlyArray<{ name: string; value: unknown }> };
}

export interface ClientLike {
  on(event: "messageCreate", cb: (msg: MessageLike) => void): void;
  on(event: "interactionCreate", cb: (i: ChatInputLike) => void): void;
  on(event: string, cb: (arg: any) => void): void;
}

export interface IncomingCommandRaw {
  command: string;
  text: string;
  rawOptions: Record<string, unknown>;
  conversationKey: string;
  replyTarget: { channelId: string; guildId?: string };
  senderUserId: string;
}

export interface ListenerConfig {
  client: ClientLike;
  botUserId: string;
  onTurn(turn: IncomingTurn): void | Promise<void>;
  onCommand(cmd: IncomingCommandRaw): void | Promise<void>;
}

/** Wire Gateway events to normalized turns/commands. Mirrors attachSlackListener. */
export function attachDiscordListener(cfg: ListenerConfig): void {
  const { client, botUserId, onTurn, onCommand } = cfg;

  client.on("messageCreate", (msg: MessageLike) => {
    if (!shouldAnswer(msg, botUserId)) return;
    const replyTarget = {
      channelId: msg.channelId,
      ...(msg.guildId ? { guildId: msg.guildId } : {}),
    };
    void onTurn({
      conversationKey: msg.channelId,
      replyTarget,
      userText: stripMention(msg.content, botUserId),
      senderUserId: msg.author.id,
    });
  });

  client.on("interactionCreate", (i: ChatInputLike) => {
    if (typeof i?.isChatInputCommand !== "function" || !i.isChatInputCommand()) return;
    const rawOptions: Record<string, unknown> = {};
    for (const opt of i.options?.data ?? []) rawOptions[opt.name] = opt.value;
    const replyTarget = {
      channelId: i.channelId,
      ...(i.guildId ? { guildId: i.guildId } : {}),
    };
    void onCommand({
      command: i.commandName,
      text: Object.values(rawOptions).map(String).join(" "),
      rawOptions,
      conversationKey: i.channelId,
      replyTarget,
      senderUserId: i.user.id,
    });
  });
}

/** Answer @-mentions and DMs; skip our own messages and other bots. */
function shouldAnswer(msg: MessageLike, botUserId: string): boolean {
  if (msg.author.id === botUserId) return false;
  if (msg.author.bot) return false;
  if (msg.channel.isDMBased()) return true;
  return msg.mentions.has(botUserId);
}

/** Drop a leading <@botId> / <@!botId> mention from the message text. */
function stripMention(content: string, botUserId: string): string {
  return content.replace(new RegExp(`<@!?${botUserId}>`, "g"), "").trim();
}
