import { ChatContextProvider } from "./ChatContext";
import { Messages as DefaultMessages } from "./Messages";
import { Input as DefaultInput } from "./Input";
import { ResponseButton as DefaultResponseButton } from "./Response";
import { Suggestion, reloadSuggestions } from "./Suggestion";
import { CopilotChatProps } from "./Chat";
import { useCopilotChatLogic } from "../../hooks/use-copilot-chat-logic";

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
  const {
    visibleMessages,
    isLoading,
    currentSuggestions,
    sendMessage,
    addChatSuggestionConfiguration,
    removeChatSuggestion,
    stop,
    reload,
  } = useCopilotChatLogic(instructions, makeSystemMessage, onInProgress, onSubmitMessage);

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
