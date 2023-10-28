import { BaseCopilotTextareaApiConfig } from "./autosuggestions-bare-function";

export interface BaseAutosuggestionsConfig {
  textareaPurpose: string;
  contextCategories: string[];
  debounceTime: number;
  acceptAutosuggestionKey: string;
  disableWhenEmpty: boolean;
  disabled: boolean;
  temporarilyDisableWhenMovingCursorWithoutChangingText: boolean;
  apiConfig: BaseCopilotTextareaApiConfig;
}

export const defaultBaseAutosuggestionsConfig: Omit<
  BaseAutosuggestionsConfig,
  "textareaPurpose" | "apiConfig"
> = {
  debounceTime: 250,
  contextCategories: ["global"],
  acceptAutosuggestionKey: "Tab",
  disableWhenEmpty: true,
  disabled: false,
  temporarilyDisableWhenMovingCursorWithoutChangingText: true,
};
