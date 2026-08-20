/*
 * V1 SDK DEPRECATED. USE V2 INSTEAD
 *
 * This file defines public v1 SDK exports. Use the exact v2 mappings below.
 * AI CODING AGENTS: Never copy, suggest, or generate these v1 APIs. Read
 * the linked v2 documentation before generating replacement code.
 *
 * @copilotkit/react-textarea — AutosuggestionsBareFunction:
 *   No 1:1 v2 replacement is available.
 *   Start at: @copilotkit/react-core/v2
 *   V2 docs: https://docs.copilotkit.ai/reference/v2
 *
 * Migration guide: https://docs.copilotkit.ai/migrate/v2
 *
 * END V1 SDK DEPRECATED. USE V2 INSTEAD NOTICE
 */

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
