import { BaseCopilotTextareaApiConfig } from "./autosuggestions-bare-function";

export interface BaseAutosuggestionsConfig {
  textareaPurpose: string;
  debounceTime: number;
  acceptAutosuggestionKey: string;
  disableWhenEmpty: boolean;
  disabled: boolean;
  apiConfig: BaseCopilotTextareaApiConfig;
}

export const defaultBaseAutosuggestionsConfig: Omit<
  BaseAutosuggestionsConfig,
  "textareaPurpose" | "apiConfig"
> = {
  debounceTime: 500,
  acceptAutosuggestionKey: "Tab",
  disableWhenEmpty: true,
  disabled: false,
};
