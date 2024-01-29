import { TextareaHTMLAttributes } from "react";
import { BaseAutosuggestionsConfig } from ".";
import { BaseCopilotTextareaApiConfig } from "./autosuggestions-bare-function";

/**
 * `BaseCopilotTextareaProps` defines the properties for the `BaseCopilotTextarea` component.
 *
 * @extends {Omit<TextareaHTMLAttributes<HTMLDivElement>, "onChange">}
 *
 * @property {boolean} [disableBranding=false] - Determines whether branding should be disabled. Default is `false`.
 *
 * @property {React.CSSProperties} [placeholderStyle] - Specifies the CSS styles to apply to the placeholder text.
 *
 * @property {React.CSSProperties} [suggestionsStyle] - Specifies the CSS styles to apply to the suggestions list.
 *
 * @property {string} [hoverMenuClassname] - a classname to applly to the editor popover window.
 *
 * @property {string} [value] - The initial value of the textarea. Can be controlled via `onValueChange`.
 *
 * @property {(value: string) => void} [onValueChange] - Callback invoked when the value of the textarea changes.
 *
 * @property {(event: React.ChangeEvent<HTMLTextAreaElement>) => void} [onChange] - Callback invoked when a `change` event is triggered on the textarea element. The event only actually includes the `event.target.value` and `event.currentTarget.value` properties (all that is required in 99% of cases).
 *
 * @property {Partial<BaseAutosuggestionsConfig> & {
 *   textareaPurpose: string;
 * }} autosuggestionsConfig - Configuration settings for the autosuggestions feature.
 * Includes a mandatory `textareaPurpose` to guide the autosuggestions.
 */
export interface BaseCopilotTextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLDivElement>, "onChange"> {
  disableBranding?: boolean;
  placeholderStyle?: React.CSSProperties;
  suggestionsStyle?: React.CSSProperties;
  hoverMenuClassname?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  onChange?: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  shortcut?: string;
  baseAutosuggestionsConfig: Partial<BaseAutosuggestionsConfig> & {
    textareaPurpose: string;
    apiConfig: BaseCopilotTextareaApiConfig;
  };
}
