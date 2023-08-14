export interface AutosuggestionsConfig {
  autocomplete: (
    textBefore: string,
    textAfter: string,
    abortSignal: AbortSignal
  ) => Promise<string>;
  debounceTime: number;
  acceptAutosuggestionKey: string;
}
