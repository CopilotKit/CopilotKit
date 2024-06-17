import { COPILOT_CLOUD_PUBLIC_API_KEY_HEADER } from "@copilotkit/shared";
import { CopilotContext } from "@copilotkit/react-core";
import { useCallback, useContext } from "react";
import { AutosuggestionsBareFunction } from "../../types";
import { retry } from "../../lib/retry";
import { InsertionEditorState } from "../../types/base/autosuggestions-bare-function";
import { SuggestionsApiConfig } from "../../types/autosuggestions-config/suggestions-api-config";
import {
  CopilotRuntimeClient,
  Message,
  TextMessage,
  convertGqlOutputToMessages,
  convertMessagesToGqlInput,
} from "@copilotkit/runtime-client-gql";
import { plainToInstance } from "class-transformer";
import { nanoid } from "nanoid";

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
  const publicApiKey = copilotApiConfig.publicApiKey;
  const headers = {
    ...(publicApiKey ? { [COPILOT_CLOUD_PUBLIC_API_KEY_HEADER]: publicApiKey } : {}),
  };

  return useCallback(
    async (editorState: InsertionEditorState, abortSignal: AbortSignal) => {
      const res = await retry(async () => {
        const messages: Message[] = [
          plainToInstance(TextMessage, {
            id: nanoid(),
            role: "system",
            content: apiConfig.makeSystemPrompt(
              textareaPurpose,
              getContextString([], contextCategories),
            ),
            createdAt: new Date(),
          }),
          ...apiConfig.fewShotMessages,
          plainToInstance(TextMessage, {
            id: nanoid(),
            role: "user",
            content: editorState.textAfterCursor,
            createdAt: new Date(),
          }),
          plainToInstance(TextMessage, {
            id: nanoid(),
            role: "user",
            content: `<TextAfterCursor>${editorState.textAfterCursor}</TextAfterCursor>`,
            createdAt: new Date(),
          }),
          plainToInstance(TextMessage, {
            id: nanoid(),
            role: "user",
            content: `<TextBeforeCursor>${editorState.textBeforeCursor}</TextBeforeCursor>`,
            createdAt: new Date(),
          }),
        ];

        const runtimeClient = new CopilotRuntimeClient({
          url: copilotApiConfig.chatApiEndpoint,
        });

        const response = await runtimeClient
          .createChatCompletion({
            frontend: {
              actions: [],
            },
            messages: convertMessagesToGqlInput(messages),
          })
          .toPromise();

        let result = "";
        for (const message of convertGqlOutputToMessages(
          response.data?.createChatCompletion?.messages ?? [],
        )) {
          if (abortSignal.aborted) {
            break;
          }
          if (message instanceof TextMessage) {
            result += message.content;
            console.log(message.content);
          }
        }

        return result;
      });

      return res;
    },
    [apiConfig, getContextString, contextCategories, textareaPurpose],
  );
}
