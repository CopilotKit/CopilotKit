import { CopilotContext } from "@copilotkit/react-core";
import { useCallback, useContext } from "react";
import {
  AutosuggestionsBareFunction,
  MakeSystemPrompt,
  MinimalChatGPTMessage,
} from "../../types";
import { ChatlikeApiEndpoint } from "../../types/standard-autosuggestions/chatlike-api-endpoint";
/**
 * Returns a memoized function that sends a request to the specified API endpoint to get an autosuggestion for the user's input.
 * The function takes in the text before and after the cursor, and an abort signal.
 * It sends a POST request to the API endpoint with the messages array containing the system message, few shot messages, and user messages.
 * The function returns the suggestion from the API response.
 *
 * @param purposePrompt - The purpose of the textarea. This is included in the system message.
 * @param apiEndpoint - The API endpoint to send the autosuggestion request to.
 * @param makeSystemMessage - A function that takes in a context string and returns a system message to include in the autosuggestion request.
 * @param fewShotMessages - An array of few shot messages to include in the autosuggestion request.
 * @param contextCategories - The categories of context strings we want to include. By default, we include the (default) "global" context category.
 * @returns A memoized function that sends a request to the specified API endpoint to get an autosuggestion for the user's input.
 */
export function useMakeStandardAutosuggestionFunction(
  purposePrompt: string,
  apiEndpoint: ChatlikeApiEndpoint,
  makeSystemPrompt: MakeSystemPrompt,
  fewShotMessages: MinimalChatGPTMessage[],
  contextCategories: string[] | undefined,
  forwardedProps?: { [key: string]: any }
): AutosuggestionsBareFunction {
  const { getContextString } = useContext(CopilotContext);

  return useCallback(
    async (beforeText: string, afterText: string, abortSignal: AbortSignal) => {
      const res = await retry(async () => {
        const messages: MinimalChatGPTMessage[] = [
          {
            role: "system",
            content: makeSystemPrompt(
              purposePrompt,
              getContextString(contextCategories)
            ),
          },
          ...fewShotMessages,
          {
            role: "user",
            name: "TextAfterCursor",
            content: afterText,
          },
          {
            role: "user",
            name: "TextBeforeCursor",
            content: beforeText,
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
      purposePrompt,
    ]
  );
}

function retry<T>(
  fn: () => Promise<T>,
  retriesLeft: number = 2,
  interval: number = 200,
  backoff: number = 1.5
): Promise<T> {
  return new Promise((resolve, reject) => {
    fn()
      .then(resolve)
      .catch((error) => {
        if (retriesLeft === 1) {
          reject(error);
          return;
        }

        setTimeout(() => {
          retry(fn, retriesLeft - 1, interval * backoff, backoff)
            .then(resolve)
            .catch(reject);
        }, interval);
      });
  });
}
