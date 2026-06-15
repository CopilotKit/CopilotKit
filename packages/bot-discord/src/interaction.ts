import type { InteractionEvent } from "@copilotkit/bot";
import type { PlatformUser } from "@copilotkit/bot-ui";

/** The structural subset of a discord.js component interaction we read. */
interface ComponentInteractionLike {
  isButton(): boolean;
  isStringSelectMenu(): boolean;
  customId?: string;
  values?: string[];
  message?: { id: string };
  channelId?: string;
  guildId?: string | null;
  user?: { id: string; username?: string; globalName?: string | null };
}

/** Decode a discord.js component interaction into the engine's opaque InteractionEvent. */
export function decodeInteraction(raw: unknown): InteractionEvent | undefined {
  const i = raw as ComponentInteractionLike;
  if (typeof i?.isButton !== "function") return undefined;
  const isButton = i.isButton();
  const isSelect = i.isStringSelectMenu();
  if (!isButton && !isSelect) return undefined;

  const customId = i.customId ?? "";
  const channelId = i.channelId ?? "";
  const user = toUser(i.user);

  const value = isSelect ? i.values?.[0] : unpackValue(customId);

  return {
    id: customId,
    conversationKey: channelId,
    replyTarget: { channelId, ...(i.guildId ? { guildId: i.guildId } : {}) },
    value,
    user,
    messageRef: i.message ? { id: i.message.id, channelId } : undefined,
  };
}

/** A `v:<json>` custom_id carries a small bound value; anything else has none. */
function unpackValue(customId: string): unknown {
  if (!customId.startsWith("v:")) return undefined;
  try {
    return JSON.parse(customId.slice(2));
  } catch {
    return undefined;
  }
}

function toUser(u: ComponentInteractionLike["user"]): PlatformUser | undefined {
  if (!u?.id) return undefined;
  return { id: u.id, name: u.globalName ?? u.username, handle: u.username };
}
