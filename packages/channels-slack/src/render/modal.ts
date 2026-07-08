import type { BotNode } from "@copilotkit/channels-ui";
import { ModalRenderError } from "@copilotkit/channels-ui";
import type { View } from "@slack/web-api";

const plain = (text: string) => ({ type: "plain_text" as const, text });

function optionFrom(node: BotNode) {
  return {
    text: plain(String(node.props.label ?? "")),
    value: String(node.props.value ?? ""),
  };
}

function childOptions(node: BotNode): BotNode[] {
  const kids = node.props.children;
  return Array.isArray(kids)
    ? (kids as BotNode[]).filter((k) => k.type === "modal_select_option")
    : [];
}

/**
 * Render a modal IR tree (a `<Modal>` root with `modal_text_input` /
 * `modal_select` / `modal_radio` children) into a Slack `views.open` `View`.
 *
 * Each field's `id` becomes both the block `block_id` and the element
 * `action_id`, so a `view_submission`'s `state.values[id][id]` maps straight
 * back to the field. Throws {@link ModalRenderError} when there is no modal
 * root or a child uses an unsupported element type.
 */
export function renderSlackModal(ir: BotNode[]): View {
  const root = ir.find((n) => n.type === "modal");
  if (!root)
    throw new ModalRenderError("renderSlackModal: no <Modal> root in IR");
  const p = root.props as Record<string, unknown>;
  const kids = Array.isArray(p.children) ? (p.children as BotNode[]) : [];
  const blocks = kids.map((node): unknown => {
    const fp = node.props as Record<string, unknown>;
    const id = String(fp.id ?? "");
    const label = plain(String(fp.label ?? ""));
    const optional = fp.optional === true;
    switch (node.type) {
      case "modal_text_input":
        return {
          type: "input",
          block_id: id,
          label,
          optional,
          element: {
            type: "plain_text_input",
            action_id: id,
            ...(fp.multiline ? { multiline: true } : {}),
            ...(fp.placeholder
              ? { placeholder: plain(String(fp.placeholder)) }
              : {}),
            ...(fp.initialValue
              ? { initial_value: String(fp.initialValue) }
              : {}),
            ...(fp.maxLength ? { max_length: Number(fp.maxLength) } : {}),
          },
        };
      case "modal_select": {
        const options = childOptions(node).map(optionFrom);
        const init = options.find(
          (o) => o.value === String(fp.initialOption ?? ""),
        );
        return {
          type: "input",
          block_id: id,
          label,
          optional,
          element: {
            type: "static_select",
            action_id: id,
            options,
            ...(fp.placeholder
              ? { placeholder: plain(String(fp.placeholder)) }
              : {}),
            ...(init ? { initial_option: init } : {}),
          },
        };
      }
      case "modal_radio": {
        const options = childOptions(node).map(optionFrom);
        const init = options.find(
          (o) => o.value === String(fp.initialOption ?? ""),
        );
        return {
          type: "input",
          block_id: id,
          label,
          optional,
          element: {
            type: "radio_buttons",
            action_id: id,
            options,
            ...(init ? { initial_option: init } : {}),
          },
        };
      }
      default:
        throw new ModalRenderError(
          `renderSlackModal: unsupported modal element "${String(node.type)}"`,
        );
    }
  });
  return {
    type: "modal",
    callback_id: String(p.callbackId ?? ""),
    title: plain(String(p.title ?? "")),
    ...(p.submitLabel
      ? { submit: plain(String(p.submitLabel)) }
      : { submit: plain("Submit") }),
    ...(p.closeLabel ? { close: plain(String(p.closeLabel)) } : {}),
    ...(p.notifyOnClose ? { notify_on_close: true } : {}),
    ...(p.privateMetadata
      ? { private_metadata: String(p.privateMetadata) }
      : {}),
    blocks: blocks as View["blocks"],
  } as View;
}
