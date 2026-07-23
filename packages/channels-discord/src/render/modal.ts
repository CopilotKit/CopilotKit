import type { ChannelNode } from "@copilotkit/channels-ui";
import { ModalRenderError } from "@copilotkit/channels-ui";
import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

/**
 * Lower a modal IR tree to a discord.js {@link ModalBuilder}.
 *
 * Discord modals support **text inputs only** (up to 5). Any other modal
 * element (`modal_select`, `modal_radio`) or more than five text inputs throws
 * a {@link ModalRenderError}, which `adapter.openModal` translates to
 * `{ ok: false, error }` (degrade-never-throw at the boundary).
 */
export function renderDiscordModal(ir: ChannelNode[]): ModalBuilder {
  const root = ir.find((n) => n.type === "modal");
  if (!root)
    throw new ModalRenderError("renderDiscordModal: no <Modal> root in IR");
  const p = root.props as Record<string, unknown>;
  const kids = Array.isArray(p.children) ? (p.children as ChannelNode[]) : [];
  const inputs = kids.filter((k) => k.type === "modal_text_input");
  const unsupported = kids.find((k) => k.type !== "modal_text_input");
  if (unsupported) {
    throw new ModalRenderError(
      `Discord modals support text inputs only; got "${String(unsupported.type)}"`,
    );
  }
  if (inputs.length > 5) {
    throw new ModalRenderError("Discord modals allow at most 5 text inputs");
  }
  const modal = new ModalBuilder()
    .setCustomId(String(p.callbackId ?? ""))
    .setTitle(String(p.title ?? ""));
  for (const node of inputs) {
    const fp = node.props as Record<string, unknown>;
    const input = new TextInputBuilder()
      .setCustomId(String(fp.id ?? ""))
      .setLabel(String(fp.label ?? ""))
      .setStyle(fp.multiline ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(fp.optional !== true);
    if (fp.placeholder) input.setPlaceholder(String(fp.placeholder));
    if (fp.initialValue) input.setValue(String(fp.initialValue));
    if (fp.maxLength) input.setMaxLength(Number(fp.maxLength));
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(input),
    );
  }
  return modal;
}
