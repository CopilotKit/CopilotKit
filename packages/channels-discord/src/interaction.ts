import type {
  InteractionEvent,
  IncomingReaction,
  IncomingModalSubmit,
} from "@copilotkit/channels-core";
import type { ProviderActor } from "@copilotkit/channels-ui";
import type { ChannelUploadedFile } from "@copilotkit/channels-ui";
import { ComponentType } from "discord.js";
import { buildFileContentParts } from "./download-files.js";
import type { FileDeliveryConfig } from "./download-files.js";
import { decodePortableSingleValueField } from "./modal-field.js";

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
  applicationId?: string;
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
  const actor = toUser(i.user);

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
    actor: actor ?? { id: "unknown", kind: "unknown" },
    identityContext: identityContext({
      guildId: i.guildId,
      applicationId: i.applicationId,
      channelId,
      trigger: "interaction",
      eventId: i.message?.id,
      raw,
    }),
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

function toUser(
  u: ComponentInteractionLike["user"],
): ProviderActor | undefined {
  if (!u?.id) return undefined;
  return {
    id: u.id,
    kind: "human",
    name: u.globalName ?? u.username,
    handle: u.username,
  };
}

function identityContext(input: {
  guildId?: string | null;
  applicationId?: string;
  channelId?: string;
  trigger: string;
  eventId?: string;
  raw: unknown;
}) {
  return {
    tenant: { id: input.guildId ?? "direct" },
    installation: { id: input.applicationId ?? "unknown" },
    conversation: {
      id: input.channelId ?? "unknown",
      kind: input.guildId ? "guild" : "direct",
    },
    trigger: input.trigger,
    event: { id: input.eventId },
    raw: input.raw,
  };
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
  applicationId?: string;
  id?: string;
  user?: { id?: string; username?: string; globalName?: string };
  fields?: {
    fields?: Map<
      string,
      {
        type?: ComponentType;
        customId?: string;
        value?: string | boolean | null;
        values?: string[];
        attachments?: Map<
          string,
          {
            name: string;
            contentType?: string | null;
            size: number;
            url: string;
          }
        >;
      }
    >;
  };
}

/** Decode a discord.js `ModalSubmitInteraction` into an `IncomingModalSubmit`. */
export async function decodeModalSubmit(
  interaction: unknown,
  filesConfig?: FileDeliveryConfig,
): Promise<IncomingModalSubmit> {
  const i = interaction as ModalSubmitLike;
  const values: Record<string, unknown> = {};
  for (const [key, comp] of i.fields?.fields ?? new Map()) {
    const providerFieldId = comp?.customId ?? key;
    const portableSingleId = decodePortableSingleValueField(providerFieldId);
    const fieldId = portableSingleId ?? providerFieldId;
    switch (comp?.type) {
      case ComponentType.StringSelect:
      case ComponentType.UserSelect:
      case ComponentType.RoleSelect:
      case ComponentType.MentionableSelect:
      case ComponentType.ChannelSelect:
      case ComponentType.CheckboxGroup:
        values[fieldId] = portableSingleId
          ? comp.values?.[0]
          : (comp.values ?? []);
        break;
      case ComponentType.FileUpload:
        values[fieldId] = await hydrateModalFiles(
          comp.attachments,
          filesConfig,
        );
        break;
      case ComponentType.Checkbox:
        values[fieldId] = comp.value === true;
        break;
      case ComponentType.RadioGroup:
      case ComponentType.TextInput:
      default:
        // The default keeps legacy discord.js text-input fixtures working: old
        // ActionRow fields did not include the component type in test doubles.
        values[fieldId] = comp?.value;
        break;
    }
  }
  return {
    callbackId: i.customId ?? "",
    values,
    actor: i.user?.id
      ? {
          id: i.user.id,
          kind: "human",
          name: i.user.globalName ?? i.user.username,
        }
      : { id: "unknown", kind: "unknown" },
    identityContext: identityContext({
      guildId: i.guildId,
      applicationId: i.applicationId,
      channelId: i.channelId,
      trigger: "modal_submit",
      eventId: i.id,
      raw: interaction,
    }),
    conversationKey: i.channelId,
    replyTarget: i.channelId
      ? { channelId: i.channelId, ...(i.guildId ? { guildId: i.guildId } : {}) }
      : undefined,
    platform: "discord",
    raw: interaction,
  };
}

/** Hydrate modal attachment metadata without exposing Discord CDN URLs. */
async function hydrateModalFiles(
  attachments:
    | Map<
        string,
        {
          name: string;
          contentType?: string | null;
          size: number;
          url: string;
        }
      >
    | undefined,
  filesConfig?: FileDeliveryConfig,
): Promise<ChannelUploadedFile[]> {
  const files: ChannelUploadedFile[] = [];
  for (const attachment of attachments?.values() ?? []) {
    const mimeType = attachment.contentType ?? "application/octet-stream";
    const contentParts = await buildFileContentParts(
      [
        {
          url: attachment.url,
          name: attachment.name,
          contentType: mimeType,
          size: attachment.size,
        },
      ],
      filesConfig,
    );
    files.push({
      name: attachment.name,
      mimeType,
      size: attachment.size,
      contentParts,
    });
  }
  return files;
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
    actor: u.id
      ? {
          id: u.id,
          kind: u.bot ? "bot" : "human",
          name: u.globalName ?? u.username,
        }
      : { id: "unknown", kind: "unknown" },
    identityContext: identityContext({
      guildId: r.message?.guildId,
      channelId,
      trigger: "reaction",
      eventId: messageId,
      raw: reaction,
    }),
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
