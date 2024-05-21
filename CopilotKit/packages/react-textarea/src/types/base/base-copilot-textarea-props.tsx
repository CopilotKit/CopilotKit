import { TextareaHTMLAttributes } from "react";
import { BaseAutosuggestionsConfig } from ".";
import { BaseCopilotTextareaApiConfig } from "./autosuggestions-bare-function";

/**
 * `BaseCopilotTextareaProps` defines the properties for the `BaseCopilotTextarea` component.
 */
export interface BaseCopilotTextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLDivElement>, "onChange"> {
  /**
   * Determines whether the CopilotKit branding should be disabled. Default is `false`.
   */
  disableBranding?: boolean;

  /**
   * Specifies the CSS styles to apply to the placeholder text.
   */
  placeholderStyle?: React.CSSProperties;

  /**
   * Specifies the CSS styles to apply to the suggestions list.
   */
  suggestionsStyle?: React.CSSProperties;

  /**
   * A class name to apply to the editor popover window.
   */
  hoverMenuClassname?: string;

  /**
   * The initial value of the textarea. Can be controlled via `onValueChange`.
   */
  value?: string;

  /**
   * Callback invoked when the value of the textarea changes.
   */
  onValueChange?: (value: string) => void;

  /**
   * Callback invoked when a `change` event is triggered on the textarea element.
   */
  onChange?: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;

  /**
   * The shortcut to use to open the editor popover window. Default is `"Cmd-k"`.
   */
  shortcut?: string;

  /**
   * Configuration settings for the autosuggestions feature.
   * Includes a mandatory `textareaPurpose` to guide the autosuggestions.
   */
  baseAutosuggestionsConfig: Partial<BaseAutosuggestionsConfig> & {
    textareaPurpose: string;
    apiConfig: BaseCopilotTextareaApiConfig;
  };
}
