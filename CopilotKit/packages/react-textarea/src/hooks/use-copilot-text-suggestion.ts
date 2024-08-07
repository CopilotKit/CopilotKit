import { useState, useEffect, useCallback } from "react";
import { MakeSystemPrompt } from "../types";
import { Message } from "@copilotkit/runtime-client-gql";
import { useMakeStandardAutosuggestionFunction } from "./make-autosuggestions-function/use-make-standard-autosuggestions-function";
import { defaultCopilotContextCategories } from "@copilotkit/react-core";
import {
  defaultSuggestionsFewShotMessages,
  defaultSuggestionsMakeSystemPrompt,
} from "../types/autosuggestions-config/suggestions-api-config";

interface CopilotTextSuggestionParams {
  textBeforeCursor: string;
  textAfterCursor: string;
  instructions?: string;
  debounceTime?: number;
  disabled?: boolean;
  disableOnEmpty?: boolean;
  state?: any;
  onTextSuggestion?: (suggestion: string) => void;

  contextCategories?: string[];
  makeSystemPrompt?: MakeSystemPrompt;
  fewShotMessages?: Message[];
  maxTokens?: number;
  stop?: string[];
}

interface CopilotTextSuggestionResult {
  suggestion?: string;
  state?: any;
}

export function useCopilotTextSuggestion({
  textBeforeCursor,
  textAfterCursor,
  instructions = "Provide context or purpose of the textarea.",
  contextCategories = defaultCopilotContextCategories,
  makeSystemPrompt = defaultSuggestionsMakeSystemPrompt,
  fewShotMessages = defaultSuggestionsFewShotMessages,
  maxTokens,
  stop,
  debounceTime = 250,
  disabled = false,
  disableOnEmpty = true,
  onTextSuggestion,
  state,
}: CopilotTextSuggestionParams): CopilotTextSuggestionResult {
  const [suggestion, setSuggestion] = useState<string | undefined>(undefined);
  const [timeoutId, setTimeoutId] = useState<NodeJS.Timeout | null>(null);
  const [currentAbortController, setCurrentAbortController] = useState<AbortController | null>(
    null,
  );

  const autosuggestionsFunction = useMakeStandardAutosuggestionFunction(
    instructions,
    contextCategories,
    {
      makeSystemPrompt,
      fewShotMessages,
      maxTokens,
      stop,
    },
  );

  const cancelAutoCompletion = useCallback(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (currentAbortController) {
      currentAbortController.abort();
    }
    setSuggestion(undefined);
    setTimeoutId(null);
    setCurrentAbortController(null);
  }, [timeoutId, currentAbortController]);

  const debouncedAutoCompletion = useCallback(() => {
    cancelAutoCompletion();
    const abortController = new AbortController();

    const newTimeoutId = setTimeout(async () => {
      const completion = await autosuggestionsFunction(
        { textBeforeCursor, textAfterCursor },
        abortController.signal,
      );

      setSuggestion(completion);
      onTextSuggestion?.(completion);
    }, debounceTime);

    setCurrentAbortController(abortController);
    setTimeoutId(newTimeoutId);
  }, [
    cancelAutoCompletion,
    autosuggestionsFunction,
    debounceTime,
    textBeforeCursor,
    textAfterCursor,
  ]);

  useEffect(() => {
    if (
      disabled === true ||
      (disableOnEmpty === true &&
        textBeforeCursor.trim().length === 0 &&
        textAfterCursor.trim().length === 0)
    ) {
      cancelAutoCompletion();
      return;
    }

    debouncedAutoCompletion();
  }, [disabled, disableOnEmpty, textBeforeCursor, textAfterCursor, state]);

  return {
    suggestion,
    state,
  };
}
