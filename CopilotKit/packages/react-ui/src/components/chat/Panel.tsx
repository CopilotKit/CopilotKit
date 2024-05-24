/**
 * An embeddable chat panel for CopilotKit.
 *
 * <img src="/images/CopilotPanel/CopilotPanel.gif" width="500" />
 *
 * A chatbot panel component for the CopilotKit framework. The component allows for a high degree
 * of customization through various props and custom CSS.
 *
 * <RequestExample>
 *   ```jsx CopilotPanel Example
 *   import { CopilotPanel } from "@copilotkit/react-ui";
 *
 *   <CopilotPanel
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

import { ChatContextProvider } from "./ChatContext";
import { Messages as DefaultMessages } from "./Messages";
import { Input as DefaultInput } from "./Input";
import { ResponseButton as DefaultResponseButton } from "./Response";
import { Suggestion } from "./Suggestion";
import { CopilotChatProps } from "./Chat";
import { useCopilotChatLogic } from "../../hooks/use-copilot-chat-logic";

export interface CopilotPanelProps
  extends Omit<
    CopilotChatProps,
    | "defaultOpen"
    | "clickOutsideToClose"
    | "hitEscapeToClose"
    | "shortcut"
    | "onSetOpen"
    | "Window"
    | "Button"
    | "Header"
  > {}

export function CopilotPanel({
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
}: CopilotPanelProps) {
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
}
