import { Message } from "@copilotkit/shared";
import { CopilotContext } from "@copilotkit/react-core";
import { useCallback, useContext } from "react";
import { AutosuggestionsBareFunction, MinimalChatGPTMessage } from "../../types";
import { retry } from "../../lib/retry";
import { InsertionEditorState } from "../../types/base/autosuggestions-bare-function";
import { SuggestionsApiConfig } from "../../types/autosuggestions-config/suggestions-api-config";
import { fetchAndDecodeChatCompletionAsText } from "@copilotkit/react-core";

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
export function useMakeStandardAutosuggestionFunction(
  textareaPurpose: string,
  contextCategories: string[],
  apiConfig: SuggestionsApiConfig,
): AutosuggestionsBareFunction {
  const { getContextString, copilotApiConfig } = useContext(CopilotContext);

  return useCallback(
    async (editorState: InsertionEditorState, abortSignal: AbortSignal) => {
      const res = await retry(async () => {
        const messages: MinimalChatGPTMessage[] = [
          {
            role: "system",
            content: apiConfig.makeSystemPrompt(
              textareaPurpose,
              getContextString([], contextCategories),
            ),
          },
          ...apiConfig.fewShotMessages,
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
        ];

        const response = await fetchAndDecodeChatCompletionAsText({
          messages: messages as Message[],
          ...apiConfig.forwardedParams,
          copilotConfig: copilotApiConfig,
          signal: abortSignal,
        });

        if (!response.events) {
          throw new Error("Failed to fetch chat completion");
        }

        const reader = response.events.getReader();

        let result = "";
        while (!abortSignal.aborted) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          result += value;
        }
        return result;
      });

      return res;
    },
    [apiConfig, getContextString, contextCategories, textareaPurpose],
  );
}
