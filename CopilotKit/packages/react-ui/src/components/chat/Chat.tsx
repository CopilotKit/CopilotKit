/**
 * An embeddable chat panel for CopilotKit.
 *
 * <img src="/images/CopilotChat/CopilotChat.gif" width="500" />
 *
 * A chatbot panel component for the CopilotKit framework. The component allows for a high degree
 * of customization through various props and custom CSS.
 *
 * <RequestExample>
 *   ```jsx CopilotChat Example
 *   import { CopilotChat } from "@copilotkit/react-ui";
 *
 *   <CopilotChat
 *     labels={{
 *       title: "Your Assistant",
 *       initial: "Hi! 👋 How can I assist you today?",
 *     }}
 *   />
 *   ```
 * </RequestExample>
 *
 * ## Custom CSS
 *
 * You can customize the colors of the panel by overriding the CSS variables
 * defined in the [default styles](https://github.com/CopilotKit/CopilotKit/blob/main/CopilotKit/packages/react-ui/src/css/colors.css).
 *
 * For example, to set the primary color to purple:
 *
 * ```jsx
 * <div style={{ "--copilot-kit-primary-color": "#7D5BA6" }}>
 *   <CopilotPopup />
 * </div>
 * ```
 *
 * To further customize the panel, you can override the CSS classes defined
 * [here](https://github.com/CopilotKit/CopilotKit/blob/main/CopilotKit/packages/react-ui/src/css/).
 *
 * For example:
 *
 * ```css
 * .copilotKitButton {
 *   border-radius: 0;
 * }
 * ```
 */

import {
  ChatContext,
  ChatContextProvider,
  CopilotChatIcons,
  CopilotChatLabels,
} from "./ChatContext";
import { Messages as DefaultMessages } from "./Messages";
import { Input as DefaultInput } from "./Input";
import { ResponseButton as DefaultResponseButton } from "./Response";
import { Suggestion } from "./Suggestion";
import React, { useEffect, useRef, useState } from "react";
import { SystemMessageFunction, useCopilotChat, useCopilotContext } from "@copilotkit/react-core";
import { reloadSuggestions } from "./Suggestion";
import { CopilotChatSuggestion } from "../../types/suggestions";
import { Message, Role, TextMessage, AgentMessage } from "@copilotkit/runtime-client-gql";
import { InputProps, MessagesProps, ResponseButtonProps } from "./props";
import { randomId } from "@copilotkit/shared";

import { CopilotDevConsole } from "../dev-console";

/**
 * Props for CopilotChat component.
 */
export interface CopilotChatProps {
  /**
   * Custom instructions to be added to the system message. Use this property to
   * provide additional context or guidance to the language model, influencing
   * its responses. These instructions can include specific directions,
   * preferences, or criteria that the model should consider when generating
   * its output, thereby tailoring the conversation more precisely to the
   * user's needs or the application's requirements.
   */
  instructions?: string;

  /**
   * A callback that gets called when the in progress state changes.
   */
  onInProgress?: (inProgress: boolean) => void;

  /**
   * A callback that gets called when a new message it submitted.
   */
  onSubmitMessage?: (message: string) => void | Promise<void>;

  /**
   * Icons can be used to set custom icons for the chat window.
   */
  icons?: CopilotChatIcons;

  /**
   * Labels can be used to set custom labels for the chat window.
   */
  labels?: CopilotChatLabels;

  /**
   * A function that takes in context string and instructions and returns
   * the system message to include in the chat request.
   * Use this to completely override the system message, when providing
   * instructions is not enough.
   */
  makeSystemMessage?: SystemMessageFunction;

  /**
   * Whether to show the response button.
   * @default true
   */
  showResponseButton?: boolean;

  /**
   * A custom Messages component to use instead of the default.
   */
  Messages?: React.ComponentType<MessagesProps>;

  /**
   * A custom Input component to use instead of the default.
   */
  Input?: React.ComponentType<InputProps>;

  /**
   * A custom ResponseButton component to use instead of the default.
   */
  ResponseButton?: React.ComponentType<ResponseButtonProps>;

  /**
   * A class name to apply to the root element.
   */
  className?: string;

  /**
   * Children to render.
   */
  children?: React.ReactNode;
}

export function CopilotChat({
  instructions,
  onSubmitMessage,
  makeSystemMessage,
  showResponseButton = true,
  onInProgress,
  Messages = DefaultMessages,
  Input = DefaultInput,
  ResponseButton = DefaultResponseButton,
  className,
  icons,
  labels,
}: CopilotChatProps) {
  const context = useCopilotContext();

  useEffect(() => {
    context.setChatInstructions(instructions || "");
  }, [instructions]);

  const {
    visibleMessages,
    isLoading,
    currentSuggestions,
    sendMessage,
    stopGeneration,
    reloadMessages,
  } = useCopilotChatLogic(makeSystemMessage, onInProgress, onSubmitMessage);

  const chatContext = React.useContext(ChatContext);
  const isVisible = chatContext ? chatContext.open : true;

  return (
    <WrappedCopilotChat icons={icons} labels={labels} className={className}>
      <CopilotDevConsole />
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
          <ResponseButton
            onClick={isLoading ? stopGeneration : reloadMessages}
            inProgress={isLoading}
          />
        )}
      </Messages>
      <Input inProgress={isLoading} onSend={sendMessage} isVisible={isVisible} />
    </WrappedCopilotChat>
  );
}

export function WrappedCopilotChat({
  children,
  icons,
  labels,
  className,
}: {
  children: React.ReactNode;
  icons?: CopilotChatIcons;
  labels?: CopilotChatLabels;
  className?: string;
}) {
  const chatContext = React.useContext(ChatContext);
  if (!chatContext) {
    return (
      <ChatContextProvider icons={icons} labels={labels} open={true} setOpen={() => {}}>
        <div className={`copilotKitChat ${className}`}>{children}</div>
      </ChatContextProvider>
    );
  }
  return <>{children}</>;
}

const SUGGESTIONS_DEBOUNCE_TIMEOUT = 1000;

export const useCopilotChatLogic = (
  makeSystemMessage?: SystemMessageFunction,
  onInProgress?: (isLoading: boolean) => void,
  onSubmitMessage?: (messageContent: string) => Promise<void> | void,
) => {
  const { visibleMessages, appendMessage, reloadMessages, stopGeneration, isLoading } =
    useCopilotChat({
      id: randomId(),
      makeSystemMessage,
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
    if (onSubmitMessage) {
      try {
        await onSubmitMessage(messageContent);
      } catch (error) {
        console.error("Error in onSubmitMessage:", error);
      }
    }

    const [lastMessage] = visibleMessages.slice(-1);

    if (lastMessage instanceof AgentMessage) {
      const newState = {
        ...lastMessage.state,
      };

      newState.copilot ||= {};
      newState.copilot.ask ||= {};
      newState.copilot.ask.answer = messageContent;

      const message = new AgentMessage({
        role: Role.User,
        agentName: lastMessage.agentName,
        state: newState,
        running: lastMessage.running,
        threadId: lastMessage.threadId,
      });
      appendMessage(message);
      return message;
    } else {
      const message: Message = new TextMessage({
        content: messageContent,
        role: Role.User,
      });
      appendMessage(message);
      return message;
    }
  };

  return {
    visibleMessages,
    isLoading,
    currentSuggestions,
    sendMessage,
    stopGeneration,
    reloadMessages,
  };
};
