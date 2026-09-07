import { useCallback } from "react";
import type {
  EditingEditorState,
  Generator_InsertionOrEditingSuggestion,
} from "../../types/base/autosuggestions-bare-function";
import type { InsertionsApiConfig } from "../../types/autosuggestions-config/insertions-api-config";
import type { EditingApiConfig } from "../../types/autosuggestions-config/editing-api-config";
import type { DocumentPointer } from "@copilotkit/react-core";

let warnedDeprecated = false;

function warnDeprecatedOnce() {
  if (warnedDeprecated) return;
  warnedDeprecated = true;
  console.warn(
    "[CopilotKit] CopilotTextarea insertion and editing are no longer functional. " +
      "@copilotkit/react-textarea is a deprecated v1 package and the backend it called was " +
      "removed in v1.50.0. There is no 1:1 v2 replacement; start from @copilotkit/react-core/v2.",
  );
}

/**
 * Returns a memoized function that sends a request to the specified API endpoint to get an autosuggestion for the user's input.
 * The function takes in the text before and after the cursor, and an abort signal.
 * It sends a POST request to the API endpoint with the messages array containing the system message, few shot messages, and user messages.
 * The function returns the suggestion from the API response.
 *
 * @param textareaPurpose - The purpose of the textarea. This is included in the system message.
 * @param apiEndpoint - The API endpoint to send the autosuggestion request to.
 * @param makeSystemMessage - A function that takes in a context string and returns a system message to include in the autosuggestion request.
 * @param fewShotMessages - An array of few shot messages to include in the autosuggestion request.
 * @param contextCategories - The categories of context strings we want to include. By default, we include the (default) "global" context category.
 * @returns A memoized function that sends a request to the specified API endpoint to get an autosuggestion for the user's input.
 */
export function useMakeStandardInsertionOrEditingFunction(
  textareaPurpose: string,
  contextCategories: string[],
  insertionApiConfig: InsertionsApiConfig,
  editingApiConfig: EditingApiConfig,
): Generator_InsertionOrEditingSuggestion {
  // The GraphQL transport this hook used to call was removed in v1.50.0, and
  // the request was stubbed out at the same time. The stub left behind had no
  // `asStream`, so reaching this path raised
  // `TypeError: runtimeClient.asStream is not a function` the first time a user
  // triggered an insertion or an edit. Return an empty stream instead, matching
  // the sibling autosuggestions hook, and say once why nothing happened.
  const emptySuggestionStream = () => {
    warnDeprecatedOnce();
    return new ReadableStream<string>({
      start(controller) {
        controller.close();
      },
    });
  };

  const insertionFunction = useCallback(
    async (
      editorState: EditingEditorState,
      insertionPrompt: string,
      documents: DocumentPointer[],
      abortSignal: AbortSignal,
    ) => {
      return emptySuggestionStream();
    },
    [insertionApiConfig, contextCategories, textareaPurpose],
  );

  const editingFunction = useCallback(
    async (
      editorState: EditingEditorState,
      editingPrompt: string,
      documents: DocumentPointer[],
      abortSignal: AbortSignal,
    ) => {
      return emptySuggestionStream();
    },
    [editingApiConfig, contextCategories, textareaPurpose],
  );

  const insertionOrEditingFunction = useCallback(
    async (
      editorState: EditingEditorState,
      insertionPrompt: string,
      documents: DocumentPointer[],
      abortSignal: AbortSignal,
    ) => {
      if (editorState.selectedText === "") {
        return await insertionFunction(
          editorState,
          insertionPrompt,
          documents,
          abortSignal,
        );
      } else {
        return await editingFunction(
          editorState,
          insertionPrompt,
          documents,
          abortSignal,
        );
      }
    },
    [insertionFunction, editingFunction],
  );

  return insertionOrEditingFunction;
}
