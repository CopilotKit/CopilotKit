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
  const isSelect = i.isStringSelectMenu?.() ?? false;
  if (!isButton && !isSelect) return undefined;

  const customId = i.customId ?? "";
  const channelId = i.channelId ?? "";
  const user = toUser(i.user);

  // A button custom_id may be a handler id ("ck:…"), a packed value
  // ("v:<json>"), or BOTH ("ck:…;v:<json>") when a button carries an onClick AND
  // a value (e.g. the HITL confirm gate). Split the combined form so the onClick
  // still dispatches by the bare id AND awaitChoice receives the bound value.
  // For a select, JSON-parse the chosen value so a non-string option value
  // (number/boolean/object) round-trips to its original type — mirroring bot-slack.
  let id = customId;
  let value: unknown;
  if (isSelect) {
    value = i.values?.[0];
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch {
        // Not JSON — keep the raw string.
      }
    }
  } else {
    const sep = customId.startsWith("ck:") ? customId.indexOf(";v:") : -1;
    if (sep !== -1) {
      id = customId.slice(0, sep);
      value = unpackValue(customId.slice(sep + 1));
    } else {
      value = unpackValue(customId);
    }
  }

  return {
    id,
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
