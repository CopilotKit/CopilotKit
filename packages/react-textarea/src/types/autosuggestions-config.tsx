export interface AutosuggestionsConfig {
  autosuggestionFunction: AutosuggestionFunction;
  debounceTime: number;
  acceptAutosuggestionKey: string;
}

export type AutosuggestionFunction = (
  textBefore: string,
  textAfter: string,
  abortSignal: AbortSignal
) => Promise<string>;
