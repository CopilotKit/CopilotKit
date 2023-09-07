import { CopilotContext } from "@copilotkit/react-core";
import { useCallback, useContext } from "react";
import {
  AutosuggestionsBareFunction,
  MakeSystemPrompt,
  MinimalChatGPTMessage,
} from "../../types";
import { ChatlikeApiEndpoint } from "../../types/standard-autosuggestions/chatlike-api-endpoint";
import { retry } from "../../lib/retry";
import {
  Generator_InsertionSuggestion,
  InsertionEditorState,
} from "../../components/hovering-toolbar/text-insertion-prompt-box/hovering-insertion-prompt-box";
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
export function useMakeStandardInsertionFunction(
  textareaPurpose: string,
  apiEndpoint: ChatlikeApiEndpoint,
  makeSystemPrompt: MakeSystemPrompt,
  fewShotMessages: MinimalChatGPTMessage[],
  contextCategories: string[] | undefined,
  forwardedProps?: { [key: string]: any }
): Generator_InsertionSuggestion {
  const { getContextString } = useContext(CopilotContext);

  return useCallback(
    async (
      editorState: InsertionEditorState,
      insertionPrompt: string,
      abortSignal: AbortSignal
    ) => {
      const res = await retry(async () => {
        const messages: MinimalChatGPTMessage[] = [
          {
            role: "system",
            content: makeSystemPrompt(
              textareaPurpose,
              getContextString(contextCategories)
            ),
          },
          ...fewShotMessages,
          {
            role: "user",
            name: "TextAfterCursor",
            content: editorState.textAfterCursor,
          },
          {
            role: "user",
            name: "TextBeforeCursor",
            content: editorState.textBeforeCursor,
          },
          {
            role: "user",
            name: "InsertionPrompt",
            content: insertionPrompt,
          },
        ];

        return await apiEndpoint.run(abortSignal, messages, forwardedProps);
      });

      return res;
    },
    [
      apiEndpoint,
      makeSystemPrompt,
      fewShotMessages,
      getContextString,
      contextCategories,
      textareaPurpose,
    ]
  );
}
