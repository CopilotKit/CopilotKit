import { DocumentPointer } from "@copilotkit/react-core";

export interface InsertionEditorState {
  textBeforeCursor: string;
  textAfterCursor: string;
}

export interface EditingEditorState extends InsertionEditorState {
  selectedText: string;
}

export type AutosuggestionsBareFunction = (
  editorState: InsertionEditorState,
  abortSignal: AbortSignal,
) => Promise<string>;

export type Generator_InsertionOrEditingSuggestion = (
  editorState: EditingEditorState,
  prompt: string,
  documents: DocumentPointer[],
  abortSignal: AbortSignal,
) => Promise<ReadableStream<string>>;

export interface InsertionEditorApiConfig {
  insertionOrEditingFunction: Generator_InsertionOrEditingSuggestion;
}

export interface BaseCopilotTextareaApiConfig extends InsertionEditorApiConfig {
  autosuggestionsFunction: AutosuggestionsBareFunction;
}
