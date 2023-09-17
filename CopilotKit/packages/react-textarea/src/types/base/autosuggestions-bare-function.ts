export interface InsertionEditorState {
  textBeforeCursor: string;
  textAfterCursor: string;
}

export interface EditingEditorState extends InsertionEditorState {
  selectedText: string;
}

export type AutosuggestionsBareFunction = (
  editorState: InsertionEditorState,
  abortSignal: AbortSignal
) => Promise<string>;

export type Generator_InsertionSuggestion = (
  editorState: EditingEditorState,
  prompt: string,
  abortSignal: AbortSignal
) => Promise<ReadableStream<string>>;

export interface InsertionEditorApiConfig {
  insertionSuggestionFunction: Generator_InsertionSuggestion;
}

export interface BaseCopilotTextareaApiConfig {
  autosuggestionsFunction: AutosuggestionsBareFunction;
  insertionSuggestionFunction: Generator_InsertionSuggestion;
}
