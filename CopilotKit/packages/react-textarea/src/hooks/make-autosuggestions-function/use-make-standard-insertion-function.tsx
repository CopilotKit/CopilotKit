import { COPILOT_CLOUD_PUBLIC_API_KEY_HEADER } from "@copilotkit/shared";
import { useCopilotContext } from "@copilotkit/react-core";
import { useCallback } from "react";
import {
  CopilotRuntimeClient,
  Message,
  Role,
  TextMessage,
  convertGqlOutputToMessages,
  convertMessagesToGqlInput,
  filterAgentStateMessages,
  CopilotRequestType,
} from "@copilotkit/runtime-client-gql";
import { retry } from "../../lib/retry";
import {
  EditingEditorState,
  Generator_InsertionOrEditingSuggestion,
} from "../../types/base/autosuggestions-bare-function";
import { InsertionsApiConfig } from "../../types/autosuggestions-config/insertions-api-config";
import { EditingApiConfig } from "../../types/autosuggestions-config/editing-api-config";
import { DocumentPointer } from "@copilotkit/react-core";

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
  const { getContextString, copilotApiConfig, runtimeClient } = useCopilotContext();
  const headers = {
    ...(copilotApiConfig.publicApiKey
      ? { [COPILOT_CLOUD_PUBLIC_API_KEY_HEADER]: copilotApiConfig.publicApiKey }
      : {}),
  };

  async function runtimeClientResponseToStringStream(
    responsePromise: ReturnType<typeof runtimeClient.generateCopilotResponse>,
  ) {
    const messagesStream = runtimeClient.asStream(responsePromise);

    return new ReadableStream({
      async start(controller) {
        const reader = messagesStream.getReader();
        let sentContent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          const messages = convertGqlOutputToMessages(value.generateCopilotResponse.messages);

          let newContent = "";

          for (const message of messages) {
            if (message.isTextMessage()) {
              newContent += message.content;
            }
          }
          if (newContent) {
            const contentToSend = newContent.slice(sentContent.length);
            controller.enqueue(contentToSend);
            sentContent += contentToSend;
          }
        }
        controller.close();
      },
    });
  }

  const insertionFunction = useCallback(
    async (
      editorState: EditingEditorState,
      insertionPrompt: string,
      documents: DocumentPointer[],
      abortSignal: AbortSignal,
    ) => {
      const res = await retry(async () => {
        const messages: Message[] = [
          new TextMessage({
            role: Role.System,
            content: insertionApiConfig.makeSystemPrompt(
              textareaPurpose,
              getContextString(documents, contextCategories),
            ),
          }),
          ...insertionApiConfig.fewShotMessages,
          new TextMessage({
            role: Role.User,
            content: `<TextAfterCursor>${editorState.textAfterCursor}</TextAfterCursor>`,
          }),
          new TextMessage({
            role: Role.User,
            content: `<TextBeforeCursor>${editorState.textBeforeCursor}</TextBeforeCursor>`,
          }),
          new TextMessage({
            role: Role.User,
            content: `<InsertionPrompt>${insertionPrompt}</InsertionPrompt>`,
          }),
        ];

        return runtimeClientResponseToStringStream(
          runtimeClient.generateCopilotResponse({
            data: {
              frontend: {
                actions: [],
                url: window.location.href,
              },
              messages: convertMessagesToGqlInput(filterAgentStateMessages(messages)),
              metadata: {
                requestType: CopilotRequestType.TextareaCompletion,
              },
            },
            properties: copilotApiConfig.properties,
            signal: abortSignal,
          }),
        );
      });

      return res;
    },
    [insertionApiConfig, getContextString, contextCategories, textareaPurpose],
  );

  const editingFunction = useCallback(
    async (
      editorState: EditingEditorState,
      editingPrompt: string,
      documents: DocumentPointer[],
      abortSignal: AbortSignal,
    ) => {
      const res = await retry(async () => {
        const messages: Message[] = [
          new TextMessage({
            role: Role.System,
            content: editingApiConfig.makeSystemPrompt(
              textareaPurpose,
              getContextString(documents, contextCategories),
            ),
          }),
          ...editingApiConfig.fewShotMessages,
          new TextMessage({
            role: Role.User,
            content: `<TextBeforeCursor>${editorState.textBeforeCursor}</TextBeforeCursor>`,
          }),
          new TextMessage({
            role: Role.User,
            content: `<TextToEdit>${editorState.selectedText}</TextToEdit>`,
          }),
          new TextMessage({
            role: Role.User,
            content: `<TextAfterCursor>${editorState.textAfterCursor}</TextAfterCursor>`,
          }),
          new TextMessage({
            role: Role.User,
            content: `<EditingPrompt>${editingPrompt}</EditingPrompt>`,
          }),
        ];

        return runtimeClientResponseToStringStream(
          runtimeClient.generateCopilotResponse({
            data: {
              frontend: {
                actions: [],
                url: window.location.href,
              },
              messages: convertMessagesToGqlInput(filterAgentStateMessages(messages)),
              metadata: {
                requestType: CopilotRequestType.TextareaCompletion,
              },
            },
            properties: copilotApiConfig.properties,
            signal: abortSignal,
          }),
        );
      });

      return res;
    },
    [editingApiConfig, getContextString, contextCategories, textareaPurpose],
  );

  const insertionOrEditingFunction = useCallback(
    async (
      editorState: EditingEditorState,
      insertionPrompt: string,
      documents: DocumentPointer[],
      abortSignal: AbortSignal,
    ) => {
      if (editorState.selectedText === "") {
        return await insertionFunction(editorState, insertionPrompt, documents, abortSignal);
      } else {
        return await editingFunction(editorState, insertionPrompt, documents, abortSignal);
      }
    },
    [insertionFunction, editingFunction],
  );

  return insertionOrEditingFunction;
}
