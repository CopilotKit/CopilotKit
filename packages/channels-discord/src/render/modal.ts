import type { ChannelNode } from "@copilotkit/channels-ui";
import { ModalRenderError } from "@copilotkit/channels-ui";
import {
  ActionRowBuilder,
  LabelBuilder,
  ModalBuilder,
  RadioGroupBuilder,
  RadioGroupOptionBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import {
  containsDiscordNativeModal,
  renderDiscordNativeModalComponents,
} from "../native-codec.js";
import { encodePortableSingleValueField } from "../modal-field.js";

/**
 * Lower a modal IR tree to a discord.js {@link ModalBuilder}.
 *
 * Discord modals support up to five portable text, select, or radio fields.
 * Invalid elements throw a {@link ModalRenderError}, which `adapter.openModal`
 * translates to `{ ok: false, error }` at the boundary.
 */
export function renderDiscordModal(ir: ChannelNode[]): ModalBuilder {
  const root = ir.find((n) => n.type === "modal");
  if (!root)
    throw new ModalRenderError("renderDiscordModal: no <Modal> root in IR");
  const p = root.props as Record<string, unknown>;
  const kids = Array.isArray(p.children) ? (p.children as ChannelNode[]) : [];
  if (containsDiscordNativeModal(ir)) {
    return new ModalBuilder({
      custom_id: String(p.callbackId ?? ""),
      title: String(p.title ?? ""),
      components: renderDiscordNativeModalComponents(p.children),
    });
  }
  const supported = new Set([
    "modal_text_input",
    "modal_select",
    "modal_radio",
  ]);
  const unsupported = kids.find((kid) => !supported.has(String(kid.type)));
  if (unsupported) {
    throw new ModalRenderError(
      `renderDiscordModal: unsupported modal element "${String(unsupported.type)}"`,
    );
  }
  if (kids.length > 5) {
    throw new ModalRenderError("Discord modals allow at most 5 fields");
  }
  const modal = new ModalBuilder()
    .setCustomId(String(p.callbackId ?? ""))
    .setTitle(String(p.title ?? ""));
  for (const node of kids) {
    const fp = node.props as Record<string, unknown>;
    if (node.type === "modal_text_input") {
      const input = new TextInputBuilder()
        .setCustomId(String(fp.id ?? ""))
        .setLabel(String(fp.label ?? ""))
        .setStyle(
          fp.multiline ? TextInputStyle.Paragraph : TextInputStyle.Short,
        )
        .setRequired(fp.optional !== true);
      if (fp.placeholder) input.setPlaceholder(String(fp.placeholder));
      if (fp.initialValue) input.setValue(String(fp.initialValue));
      if (fp.maxLength) input.setMaxLength(Number(fp.maxLength));
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(input),
      );
      continue;
    }

    const options = childOptions(node);
    const label = new LabelBuilder().setLabel(String(fp.label ?? ""));
    if (node.type === "modal_select") {
      const select = new StringSelectMenuBuilder()
        .setCustomId(encodePortableSingleValueField(String(fp.id ?? "")))
        .setMinValues(fp.optional === true ? 0 : 1)
        .setMaxValues(1)
        .addOptions(
          options.map((option) => {
            const built = new StringSelectMenuOptionBuilder()
              .setLabel(String(option.props.label ?? ""))
              .setValue(String(option.props.value ?? ""));
            if (option.props.value === fp.initialOption) built.setDefault(true);
            return built;
          }),
        );
      if (fp.placeholder) select.setPlaceholder(String(fp.placeholder));
      modal.addLabelComponents(label.setStringSelectMenuComponent(select));
      continue;
    }

    const radio = new RadioGroupBuilder()
      .setCustomId(String(fp.id ?? ""))
      .setRequired(fp.optional !== true)
      .addOptions(
        options.map((option) => {
          const built = new RadioGroupOptionBuilder()
            .setLabel(String(option.props.label ?? ""))
            .setValue(String(option.props.value ?? ""));
          if (option.props.value === fp.initialOption) built.setDefault(true);
          return built;
        }),
      );
    modal.addLabelComponents(label.setRadioGroupComponent(radio));
  }
  return modal;
}

/** Read portable select/radio options from a modal field. */
function childOptions(node: ChannelNode): ChannelNode[] {
  const children = node.props.children;
  return Array.isArray(children)
    ? (children as ChannelNode[]).filter(
        (child) => child.type === "modal_select_option",
      )
    : [];
}
