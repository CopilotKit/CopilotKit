import { useEffect, useRef, useState } from "react";
import { SystemMessageFunction, useCopilotChat, useCopilotContext } from "@copilotkit/react-core";
import { nanoid } from "nanoid";
import { reloadSuggestions } from "../components/chat/Suggestion";
import { CopilotChatSuggestion } from "../types/suggestions";
import { Message } from "@copilotkit/shared";

const SUGGESTIONS_DEBOUNCE_TIMEOUT = 1000;

export const useCopilotChatLogic = (
  instructions?: string,
  makeSystemMessage?: SystemMessageFunction,
  onInProgress?: (isLoading: boolean) => void,
  onSubmitMessage?: (messageContent: string) => void,
) => {
  const { visibleMessages, append, reload, stop, isLoading, input, setInput } = useCopilotChat({
    id: nanoid(),
    makeSystemMessage,
    additionalInstructions: instructions,
  });

  const [currentSuggestions, setCurrentSuggestions] = useState<CopilotChatSuggestion[]>([]);
  const suggestionsAbortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<any>();

  const abortSuggestions = () => {
    suggestionsAbortControllerRef.current?.abort();
    suggestionsAbortControllerRef.current = null;
  };

  const context = useCopilotContext();

  useEffect(() => {
    onInProgress?.(isLoading);

    abortSuggestions();

    debounceTimerRef.current = setTimeout(
      () => {
        if (!isLoading && Object.keys(context.chatSuggestionConfiguration).length !== 0) {
          suggestionsAbortControllerRef.current = new AbortController();
          reloadSuggestions(
            context,
            context.chatSuggestionConfiguration,
            setCurrentSuggestions,
            suggestionsAbortControllerRef,
          );
        }
      },
      currentSuggestions.length == 0 ? 0 : SUGGESTIONS_DEBOUNCE_TIMEOUT,
    );

    return () => {
      clearTimeout(debounceTimerRef.current);
    };
  }, [isLoading, context.chatSuggestionConfiguration]);

  const sendMessage = async (messageContent: string) => {
    abortSuggestions();
    setCurrentSuggestions([]);
    onSubmitMessage?.(messageContent);
    const message: Message = {
      id: nanoid(),
      content: messageContent,
      role: "user",
    };
    append(message);
    return message;
  };

  return {
    visibleMessages,
    isLoading,
    currentSuggestions,
    sendMessage,
    stop,
    reload,
    input,
    setInput,
  };
};
