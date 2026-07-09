import type { BotNode } from "./ir.js";
import type { BotChildren } from "./components.js";
import { intrinsic } from "./components.js";

interface WithModalChildren {
  children?: BotChildren;
}

export interface ModalProps extends WithModalChildren {
  /** Stable id routed to `bot.onModalSubmit` / `bot.onModalClose`. */
  callbackId: string;
  title: string;
  submitLabel?: string;
  closeLabel?: string;
  /** Slack: emit a `view_closed` event when the user dismisses the modal. */
  notifyOnClose?: boolean;
  /** Opaque string echoed back to the submit/close handler. */
  privateMetadata?: string;
}
export interface TextInputProps {
  id: string;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  optional?: boolean;
  maxLength?: number;
  initialValue?: string;
  children?: never;
}
export interface ModalSelectProps extends WithModalChildren {
  id: string;
  label: string;
  placeholder?: string;
  optional?: boolean;
  /** `value` of the option selected by default. */
  initialOption?: string;
}
export interface ModalSelectOptionProps {
  label: string;
  value: string;
  children?: never;
}
export interface RadioButtonsProps extends WithModalChildren {
  id: string;
  label: string;
  optional?: boolean;
  initialOption?: string;
}

/** A modal view IR root. Distinct from message IR; rendered via `renderModal`. */
export type ModalView = BotNode & { type: "modal" };

/** Thrown by an adapter's `renderModal` when a view uses an unsupported element. */
export class ModalRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModalRenderError";
  }
}

export const Modal = intrinsic<ModalProps>("modal") as (
  props: ModalProps,
) => ModalView;
export const TextInput = intrinsic<TextInputProps>("modal_text_input");
export const ModalSelect = intrinsic<ModalSelectProps>("modal_select");
export const ModalSelectOption = intrinsic<ModalSelectOptionProps>(
  "modal_select_option",
);
export const RadioButtons = intrinsic<RadioButtonsProps>("modal_radio");
