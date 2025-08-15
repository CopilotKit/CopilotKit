/**
 * Suggestions utility functions for CopilotKit
 *
 * This module handles the generation of chat suggestions with optimized error handling
 * and streaming validation to prevent infinite retry loops and console spam.
 */

import { extract } from "./extract";
import { actionParametersToJsonSchema } from "@copilotkit/shared";
import { CopilotRequestType } from "@copilotkit/runtime-client-gql";
import { CopilotContextParams, CopilotMessagesContextParams } from "../context";
import { CopilotChatSuggestionConfiguration } from "../types";

export interface SuggestionItem {
  title: string;
  message: string;
  partial?: boolean;
  className?: string;
}

export const reloadSuggestions = async (
  context: CopilotContextParams & CopilotMessagesContextParams,
  chatSuggestionConfiguration: { [key: string]: CopilotChatSuggestionConfiguration },
  setCurrentSuggestions: (suggestions: SuggestionItem[]) => void,
  abortControllerRef: React.MutableRefObject<AbortController | null>,
): Promise<void> => {
  const abortController = abortControllerRef.current;

  // Early abort check
  if (abortController?.signal.aborted) {
    return;
  }

  // Abort-aware suggestion setter with safety checks to prevent race conditions
  const setSuggestionsIfNotAborted = (suggestions: SuggestionItem[]) => {
    if (!abortController?.signal.aborted && abortControllerRef.current === abortController) {
      setCurrentSuggestions(suggestions);
    }
  };

  try {
    const tools = JSON.stringify(
      Object.values(context.actions).map((action) => ({
        name: action.name,
        description: action.description,
        jsonSchema: JSON.stringify(actionParametersToJsonSchema(action.parameters)),
      })),
    );

    const allSuggestions: SuggestionItem[] = [];
    let hasSuccessfulSuggestions = false;
    let hasErrors = false; // Track if any errors occurred
    let lastError: Error | null = null; // Track the last error for better error reporting

    // Get enabled configurations
    const enabledConfigs = Object.values(chatSuggestionConfiguration).filter(
      (config) => config.instructions && config.instructions.trim().length > 0,
    );

    if (enabledConfigs.length === 0) {
      return;
    }

    // Clear existing suggestions
    setSuggestionsIfNotAborted([]);

    // Generate suggestions for each configuration
    for (const config of enabledConfigs) {
      // Check if aborted before each configuration
      if (abortController?.signal.aborted) {
        setSuggestionsIfNotAborted([]);
        return;
      }

      try {
        const result = await extract({
          context,
          instructions:
            "Suggest what the user could say next. Provide clear, highly relevant suggestions. Do not literally suggest function calls. ",
          data: `${config.instructions}\n\nAvailable tools: ${tools}\n\n`,
          requestType: CopilotRequestType.Task,
          parameters: [
            {
              name: "suggestions",
              type: "object[]",
              attributes: [
                {
                  name: "title",
                  description:
                    "The title of the suggestion. This is shown as a button and should be short.",
                  type: "string",
                },
                {
                  name: "message",
                  description:
                    "The message to send when the suggestion is clicked. This should be a clear, complete sentence and will be sent as an instruction to the AI.",
                  type: "string",
                },
              ],
            },
          ],
          include: {
            messages: true,
            readable: true,
          },
          abortSignal: abortController?.signal,
          stream: ({ status, args }: { status: string; args: any }) => {
            // Check abort status in stream callback
            if (abortController?.signal.aborted) {
              return;
            }

            const suggestions = args.suggestions || [];
            const newSuggestions: SuggestionItem[] = [];

            for (let i = 0; i < suggestions.length; i++) {
              // Respect max suggestions limit
              if (config.maxSuggestions !== undefined && i >= config.maxSuggestions) {
                break;
              }

              const suggestion = suggestions[i];

              // Skip completely empty or invalid objects during streaming
              if (!suggestion || typeof suggestion !== "object") {
                continue;
              }

              const { title, message } = suggestion;

              // During streaming, be permissive but require at least a meaningful title
              const hasValidTitle = title && typeof title === "string" && title.trim().length > 0;
              const hasValidMessage =
                message && typeof message === "string" && message.trim().length > 0;

              // During streaming, we need at least a title to show something useful
              if (!hasValidTitle) {
                continue;
              }

              // Mark as partial if this is the last suggestion and streaming isn't complete
              const partial = i === suggestions.length - 1 && status !== "complete";

              newSuggestions.push({
                title: title.trim(),
                message: hasValidMessage ? message.trim() : "", // Use title as fallback
                partial,
                className: config.className,
              });
            }

            // Update suggestions with current batch
            setSuggestionsIfNotAborted([...allSuggestions, ...newSuggestions]);
          },
        });

        // Process final results with strict validation
        if (result?.suggestions && Array.isArray(result.suggestions)) {
          const validSuggestions = result.suggestions
            .filter(
              (suggestion: any) =>
                suggestion &&
                typeof suggestion.title === "string" &&
                suggestion.title.trim().length > 0,
            )
            .map((suggestion: any) => ({
              title: suggestion.title.trim(),
              message:
                suggestion.message &&
                typeof suggestion.message === "string" &&
                suggestion.message.trim()
                  ? suggestion.message.trim()
                  : suggestion.title.trim(),
            }));

          if (validSuggestions.length > 0) {
            allSuggestions.push(...validSuggestions);
            hasSuccessfulSuggestions = true;
          }
        }
      } catch (error) {
        // Simple error handling - just continue with next config, don't log here
        hasErrors = true;
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    // Display any successful suggestions we got
    if (hasSuccessfulSuggestions && allSuggestions.length > 0) {
      // Remove duplicates based on message content
      const uniqueSuggestions = allSuggestions.filter(
        (suggestion, index, self) =>
          index === self.findIndex((s) => s.message === suggestion.message),
      );

      setSuggestionsIfNotAborted(uniqueSuggestions);
    } else if (hasErrors) {
      // If we had errors but no successful suggestions, throw an error with details
      const errorMessage = lastError
        ? lastError.message
        : "Failed to generate suggestions due to API errors";
      throw new Error(errorMessage);
    }
  } catch (error) {
    // Top-level error handler - re-throw to allow caller to handle
    throw error;
  }
};
