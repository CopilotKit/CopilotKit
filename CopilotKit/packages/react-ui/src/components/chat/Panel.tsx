import React, { useEffect, useRef, useState } from "react";
import { ChatContextProvider } from "./ChatContext";
import { useCopilotChat, useCopilotContext } from "@copilotkit/react-core";

import { Messages as DefaultMessages } from "./Messages";
import { Input as DefaultInput } from "./Input";
import { nanoid } from "nanoid";
import { ResponseButton as DefaultResponseButton } from "./Response";
import { Suggestion, reloadSuggestions } from "./Suggestion";
import { CopilotChatSuggestion, CopilotChatSuggestionConfiguration } from "../../types/suggestions";
import { Message } from "@copilotkit/shared";
import { CopilotChatProps } from "./Chat";

const SUGGESTIONS_DEBOUNCE_TIMEOUT = 1000;

type CopilotPanelProps = Omit<
  CopilotChatProps,
  | "defaultOpen"
  | "clickOutsideToClose"
  | "hitEscapeToClose"
  | "shortcut"
  | "onSetOpen"
  | "Window"
  | "Button"
  | "Header"
>;

export const CopilotPanel = ({
  instructions,
  onSubmitMessage,
  icons,
  labels,
  makeSystemMessage,
  showResponseButton = true,
  onInProgress,
  Messages = DefaultMessages,
  Input = DefaultInput,
  ResponseButton = DefaultResponseButton,
  className,
  children,
}: CopilotPanelProps) => {
  const { visibleMessages, append, reload, stop, isLoading, input, setInput } = useCopilotChat({
    id: nanoid(),
    makeSystemMessage,
    additionalInstructions: instructions,
  });

  const [currentSuggestions, setCurrentSuggestions] = React.useState<CopilotChatSuggestion[]>([]);
  const suggestionsAbortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<any>();

  const abortSuggestions = () => {
    suggestionsAbortControllerRef.current?.abort();
    suggestionsAbortControllerRef.current = null;
  };

  const context = useCopilotContext();

  const [chatSuggestionConfiguration, setChatSuggestionConfiguration] = useState<{
    [key: string]: CopilotChatSuggestionConfiguration;
  }>({});

  const addChatSuggestionConfiguration = (
    id: string,
    suggestion: CopilotChatSuggestionConfiguration,
  ) => {
    setChatSuggestionConfiguration((prev) => ({ ...prev, [id]: suggestion }));
  };

  const removeChatSuggestion = (id: string) => {
    setChatSuggestionConfiguration((prev) => {
      const { [id]: _, ...rest } = prev;
      return rest;
    });
  };

  useEffect(() => {
    onInProgress?.(isLoading);

    abortSuggestions();

    debounceTimerRef.current = setTimeout(
      () => {
        if (!isLoading && Object.keys(chatSuggestionConfiguration).length !== 0) {
          suggestionsAbortControllerRef.current = new AbortController();
          reloadSuggestions(
            context,
            chatSuggestionConfiguration,
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
  }, [isLoading, chatSuggestionConfiguration]);

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

  return (
    <ChatContextProvider
      icons={icons}
      labels={labels}
      open={true}
      setOpen={() => {}}
      addChatSuggestionConfiguration={addChatSuggestionConfiguration}
      removeChatSuggestionConfiguration={removeChatSuggestion}
    >
      <div className={className}>
        <div className="copilotKitPanel open">
          {children}
          <Messages messages={visibleMessages} inProgress={isLoading}>
            {currentSuggestions.length > 0 && (
              <div>
                <h6>Suggested:</h6>
                <div className="suggestions">
                  {currentSuggestions.map((suggestion, index) => (
                    <Suggestion
                      key={index}
                      title={suggestion.title}
                      message={suggestion.message}
                      partial={suggestion.partial}
                      className={suggestion.className}
                      onClick={(message) => sendMessage(message)}
                    />
                  ))}
                </div>
              </div>
            )}
            {showResponseButton && visibleMessages.length > 0 && (
              <ResponseButton onClick={isLoading ? stop : reload} inProgress={isLoading} />
            )}
          </Messages>
          <Input inProgress={isLoading} onSend={sendMessage} isVisible={true} />
        </div>
      </div>
    </ChatContextProvider>
  );
};
