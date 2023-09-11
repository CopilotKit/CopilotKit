export type AutosuggestionsBareFunction = (
  textBefore: string,
  textAfter: string,
  abortSignal: AbortSignal
) => Promise<string>;

export interface InsertionEditorState {
  textBeforeCursor: string;
  textAfterCursor: string;
}

export type Generator_InsertionSuggestion = (
  editorState: InsertionEditorState,
  prompt: string,
  abortSignal: AbortSignal
) => Promise<string>;

export interface InsertionEditorApiConfig {
  insertionSuggestionFunction: Generator_InsertionSuggestion;
}

export interface BaseCopilotTextareaApiConfig {
  autosuggestionsFunction: AutosuggestionsBareFunction;
  insertionSuggestionFunction: Generator_InsertionSuggestion;
}
