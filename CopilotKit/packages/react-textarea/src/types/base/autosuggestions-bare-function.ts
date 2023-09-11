export interface InsertionEditorState {
  textBeforeCursor: string;
  textAfterCursor: string;
}

export type AutosuggestionsBareFunction = (
  editorState: InsertionEditorState,
  abortSignal: AbortSignal
) => Promise<string>;

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
