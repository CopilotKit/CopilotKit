import { COPILOT_CLOUD_PUBLIC_API_KEY_HEADER } from "@copilotkit/shared";
import { useCopilotContext } from "@copilotkit/react-core";
import { useCallback } from "react";
import { AutosuggestionsBareFunction } from "../../types";
import { retry } from "../../lib/retry";
import { InsertionEditorState } from "../../types/base/autosuggestions-bare-function";
import { SuggestionsApiConfig } from "../../types/autosuggestions-config/suggestions-api-config";
import {
  Message,
  Role,
  TextMessage,
  convertGqlOutputToMessages,
  convertMessagesToGqlInput,
  filterAgentStateMessages,
  CopilotRequestType,
} from "@copilotkit/runtime-client-gql";

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
  const { getContextString, copilotApiConfig, runtimeClient } = useCopilotContext();
  const { chatApiEndpoint: url, publicApiKey, credentials, properties } = copilotApiConfig;
  const headers = {
    ...copilotApiConfig.headers,
    ...(publicApiKey ? { [COPILOT_CLOUD_PUBLIC_API_KEY_HEADER]: publicApiKey } : {}),
  };
  const { maxTokens, stop, temperature = 0 } = apiConfig;

  return useCallback(
    async (editorState: InsertionEditorState, abortSignal: AbortSignal) => {
      const res = await retry(async () => {
        // @ts-expect-error -- Passing null is forbidden, but we're filtering it later
        const messages: Message[] = [
          new TextMessage({
            role: Role.System,
            content: apiConfig.makeSystemPrompt(
              textareaPurpose,
              getContextString([], contextCategories),
            ),
          }),
          ...apiConfig.fewShotMessages,
          editorState.textAfterCursor != ""
            ? new TextMessage({
                role: Role.User,
                content: editorState.textAfterCursor,
              })
            : null,
          new TextMessage({
            role: Role.User,
            content: `<TextAfterCursor>${editorState.textAfterCursor}</TextAfterCursor>`,
          }),
          new TextMessage({
            role: Role.User,
            content: `<TextBeforeCursor>${editorState.textBeforeCursor}</TextBeforeCursor>`,
          }),
        ].filter(Boolean);

        const response = await runtimeClient
          .generateCopilotResponse({
            data: {
              frontend: {
                actions: [],
                url: window.location.href,
              },
              messages: convertMessagesToGqlInput(filterAgentStateMessages(messages)),
              metadata: {
                requestType: CopilotRequestType.TextareaCompletion,
              },
              forwardedParameters: {
                maxTokens,
                stop,
                temperature,
              },
            },
            properties,
            signal: abortSignal,
          })
          .toPromise();

        let result = "";
        for (const message of convertGqlOutputToMessages(
          response.data?.generateCopilotResponse?.messages ?? [],
        )) {
          if (abortSignal.aborted) {
            break;
          }
          if (message.isTextMessage()) {
            result += message.content;
          }
        }

        return result;
      });

      return res;
    },
    [apiConfig, getContextString, contextCategories, textareaPurpose],
  );
}
