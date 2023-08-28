export interface BaseAutosuggestionsConfig {
  purposePrompt: string;
  debounceTime: number;
  acceptAutosuggestionKey: string;
  disableWhenEmpty: boolean;
  disabled: boolean;
}

export const defaultBaseAutosuggestionsConfig: Omit<
  BaseAutosuggestionsConfig,
  "purposePrompt"
> = {
  debounceTime: 500,
  acceptAutosuggestionKey: "Tab",
  disableWhenEmpty: true,
  disabled: false,
};
