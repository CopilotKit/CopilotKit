import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { truncateText } from "./render/budget.js";

export const DISCORD_INPUT_CONTROL_PREFIX = "ck-input:";
export const DISCORD_INPUT_MODAL_PREFIX = "ck-input-modal:";
export const DISCORD_INPUT_FIELD_ID = "value";

export interface DiscordPortableInputControl {
  readonly actionId: string;
  readonly multiline: boolean;
}

/** Encode a bound portable input as a reserved Discord button custom ID. */
export function encodePortableInputControl(
  actionId: string,
  multiline: boolean,
): string {
  return `${DISCORD_INPUT_CONTROL_PREFIX}${actionId}:${multiline ? "1" : "0"}`;
}

/** Decode a reserved portable input button custom ID. */
export function decodePortableInputControl(
  customId: string,
): DiscordPortableInputControl | undefined {
  if (!customId.startsWith(DISCORD_INPUT_CONTROL_PREFIX)) return undefined;
  const encoded = customId.slice(DISCORD_INPUT_CONTROL_PREFIX.length);
  const separator = encoded.lastIndexOf(":");
  if (separator < 1) return undefined;
  const actionId = encoded.slice(0, separator);
  const multiline = encoded.slice(separator + 1);
  if (multiline !== "0" && multiline !== "1") return undefined;
  return { actionId, multiline: multiline === "1" };
}

/** Decode the original action ID from a portable input modal submission. */
export function decodePortableInputModalAction(
  customId: string,
): string | undefined {
  if (!customId.startsWith(DISCORD_INPUT_MODAL_PREFIX)) return undefined;
  const actionId = customId.slice(DISCORD_INPUT_MODAL_PREFIX.length);
  return actionId || undefined;
}

/** Build the one-field modal shown when a portable Discord input is clicked. */
export function renderPortableInputModal(input: {
  readonly actionId: string;
  readonly label: string;
  readonly multiline: boolean;
}): ModalBuilder {
  const label = truncateText(input.label.trim() || "Enter response", 45);
  const textInput = new TextInputBuilder()
    .setCustomId(DISCORD_INPUT_FIELD_ID)
    .setLabel(label)
    .setStyle(input.multiline ? TextInputStyle.Paragraph : TextInputStyle.Short)
    .setRequired(true);
  return new ModalBuilder()
    .setCustomId(`${DISCORD_INPUT_MODAL_PREFIX}${input.actionId}`)
    .setTitle("Enter response")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(textInput),
    );
}
