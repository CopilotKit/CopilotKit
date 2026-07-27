import type {
  InteractionEvent,
  IncomingReaction,
  IncomingModalSubmit,
} from "@copilotkit/channels-core";
import type { PlatformUser } from "@copilotkit/channels-ui";

/** The structural subset of a discord.js component interaction we read. */
interface ComponentInteractionLike {
  isButton(): boolean;
  isStringSelectMenu(): boolean;
  customId?: string;
  values?: string[];
  /**
   * The resolved select component. A multi-select is marked by `maxValues > 1`
   * OR `minValues === 0` (the renderer sets `minValues(0)` on every multi, which
   * also catches a one-option multi-select whose `maxValues` is 1).
   */
  component?: { maxValues?: number; minValues?: number };
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
    // Discord sends `values: string[]` for both single and multi selects; the
    // unambiguous signal is the component's value bounds (the renderer sets
    // maxValues > 1 and minValues 0 for multi). Multi → a string[] of all chosen
    // values; single → the one value (mirrors bot-slack).
    const c = i.component;
    const multi = (c?.maxValues ?? 1) > 1 || c?.minValues === 0;
    value = multi
      ? (i.values ?? []).map(parseSelectValue)
      : parseSelectValue(i.values?.[0]);
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
    // Filled by the adapter from the pending-interaction registry; the bare
    // decode has no live trigger to attach.
    triggerId: undefined,
  };
}

/** JSON-parse a chosen select value so non-string option values round-trip; else keep the raw string. */
function parseSelectValue(raw: string | undefined): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
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

// ---------------------------------------------------------------------------
// Reaction decode
// ---------------------------------------------------------------------------

interface ReactionLike {
  emoji?: { name?: string | null; id?: string | null };
  message?: { id?: string; channelId?: string; guildId?: string | null };
}
interface ReactUserLike {
  id?: string;
  username?: string;
  globalName?: string;
  bot?: boolean;
}

/** custom emoji → "name:id"; unicode → the char. */
function emojiToken(e: ReactionLike["emoji"]): string | undefined {
  if (!e?.name) return undefined;
  return e.id ? `${e.name}:${e.id}` : e.name;
}

// ---------------------------------------------------------------------------
// Modal submit decode
// ---------------------------------------------------------------------------

interface ModalSubmitLike {
  customId?: string;
  channelId?: string;
  guildId?: string | null;
  user?: { id?: string; username?: string; globalName?: string };
  fields?: { fields?: Map<string, { customId?: string; value?: string }> };
}

/** Decode a discord.js `ModalSubmitInteraction` into an `IncomingModalSubmit`. */
export function decodeModalSubmit(interaction: unknown): IncomingModalSubmit {
  const i = interaction as ModalSubmitLike;
  const values: Record<string, unknown> = {};
  for (const [key, comp] of i.fields?.fields ?? new Map()) {
    values[comp?.customId ?? key] = comp?.value;
  }
  return {
    callbackId: i.customId ?? "",
    values,
    user: i.user?.id
      ? { id: i.user.id, name: i.user.globalName ?? i.user.username }
      : undefined,
    conversationKey: i.channelId,
    replyTarget: i.channelId
      ? { channelId: i.channelId, ...(i.guildId ? { guildId: i.guildId } : {}) }
      : undefined,
    platform: "discord",
    raw: interaction,
  };
}

// ---------------------------------------------------------------------------
// Reaction decode
// ---------------------------------------------------------------------------

/**
 * Decode a discord.js `MessageReaction` + `User` pair into an `IncomingReaction`.
 * Returns `undefined` when required fields (emoji token, channelId, messageId) are missing.
 */
export function decodeReaction(
  reaction: unknown,
  user: unknown,
  added: boolean,
): IncomingReaction | undefined {
  const r = reaction as ReactionLike;
  const u = user as ReactUserLike;
  const token = emojiToken(r.emoji);
  const channelId = r.message?.channelId;
  const messageId = r.message?.id;
  if (!token || !channelId || !messageId) return undefined;
  return {
    rawEmoji: token,
    added,
    user: u.id ? { id: u.id, name: u.globalName ?? u.username } : undefined,
    conversationKey: channelId,
    replyTarget: {
      channelId,
      ...(r.message?.guildId ? { guildId: r.message.guildId } : {}),
    },
    messageId,
    // Update-capable ref (channelId + message id) so an onReaction handler can
    // edit the reacted message in place via thread.update.
    messageRef: { id: messageId, channelId },
    raw: reaction,
  };
}
