import React, { useEffect, useRef } from "react";
import { CopilotChatIcons, ChatContextProvider, CopilotChatLabels } from "./ChatContext";
import {
  SystemMessageFunction,
  extract,
  useCopilotChat,
  useCopilotContext,
} from "@copilotkit/react-core";
import {
  ButtonProps,
  HeaderProps,
  WindowProps,
  MessagesProps,
  InputProps,
  ResponseButtonProps,
  SuggestionsProps,
} from "./props";
import { Window as DefaultWindow } from "./Window";
import { Button as DefaultButton } from "./Button";
import { Header as DefaultHeader } from "./Header";
import { Messages as DefaultMessages } from "./Messages";
import { Input as DefaultInput } from "./Input";
import { nanoid } from "nanoid";
import { ResponseButton as DefaultResponseButton } from "./Response";
import { Suggestion, reloadSuggestions } from "./Suggestion";

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
   * Whether the chat window should be open by default.
   * @default false
   */
  defaultOpen?: boolean;

  /**
   * If the chat window should close when the user clicks outside of it.
   * @default true
   */
  clickOutsideToClose?: boolean;

  /**
   * If the chat window should close when the user hits the Escape key.
   * @default true
   */
  hitEscapeToClose?: boolean;

  /**
   * A callback that gets called when the chat window opens or closes.
   */
  onSetOpen?: (open: boolean) => void;

  /**
   * A callback that gets called when the in progress state changes.
   */
  onInProgress?: (inProgress: boolean) => void;

  /**
   * A callback that gets called when a new message it submitted.
   */
  onSubmitMessage?: (message: string) => void;

  /**
   * The shortcut key to open the chat window.
   * Uses Command-<shortcut> on a Mac and Ctrl-<shortcut> on Windows.
   * @default "e"
   */
  shortcut?: string;

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
   * The initial suggestions to show in the chat window.
   */
  initialSuggestions?: { title: string; message: string }[];

  /**
   * Whether to auto suggest messages based on the user's input.
   * @default true
   */
  autoSuggest?: boolean;

  /**
   * Whether to show the response button.
   * @default true
   */
  showResponseButton?: boolean;

  /**
   * A custom Window component to use instead of the default.
   */
  Window?: React.ComponentType<WindowProps>;

  /**
   * A custom Button component to use instead of the default.
   */
  Button?: React.ComponentType<ButtonProps>;

  /**
   * A custom Header component to use instead of the default.
   */
  Header?: React.ComponentType<HeaderProps>;

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

export const CopilotChat = ({
  instructions,
  defaultOpen = false,
  clickOutsideToClose = true,
  hitEscapeToClose = true,
  onSetOpen,
  onSubmitMessage,
  shortcut = "/",
  icons,
  labels,
  makeSystemMessage,
  initialSuggestions,
  autoSuggest,
  showResponseButton = true,
  onInProgress,
  Window = DefaultWindow,
  Button = DefaultButton,
  Header = DefaultHeader,
  Messages = DefaultMessages,
  Input = DefaultInput,
  ResponseButton = DefaultResponseButton,
  className,
  children,
}: CopilotChatProps) => {
  const { visibleMessages, append, reload, stop, isLoading, input, setInput } = useCopilotChat({
    id: nanoid(),
    makeSystemMessage,
    additionalInstructions: instructions,
  });

  const [currentSuggestions, setCurrentSuggestions] = React.useState<
    {
      title: string;
      message: string;
      partial?: boolean;
    }[]
  >(initialSuggestions || []);
  const suggestionsAbortControllerRef = useRef<AbortController>(new AbortController());

  const abortSuggestions = () => {
    suggestionsAbortControllerRef.current?.abort();
    suggestionsAbortControllerRef.current = new AbortController();
  };

  const context = useCopilotContext();

  useEffect(() => {
    onInProgress?.(isLoading);
    if (!isLoading && autoSuggest && currentSuggestions.length === 0) {
      reloadSuggestions(
        context,
        setCurrentSuggestions,
        suggestionsAbortControllerRef.current.signal,
      );
    }
  }, [isLoading, autoSuggest]);

  const [openState, setOpenState] = React.useState(defaultOpen);

  const setOpen = (open: boolean) => {
    onSetOpen?.(open);
    setOpenState(open);
  };

  const sendMessage = async (message: string) => {
    abortSuggestions();
    setCurrentSuggestions([]);
    onSubmitMessage?.(message);
    append({
      id: nanoid(),
      content: message,
      role: "user",
    });
  };

  return (
    <ChatContextProvider icons={icons} labels={labels} open={openState} setOpen={setOpenState}>
      {children}
      <div className={className}>
        <Button open={openState} setOpen={setOpen}></Button>
        <Window
          open={openState}
          setOpen={setOpen}
          clickOutsideToClose={clickOutsideToClose}
          shortcut={shortcut}
          hitEscapeToClose={hitEscapeToClose}
        >
          <Header open={openState} setOpen={setOpen} />
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
          <Input inProgress={isLoading} onSend={sendMessage} isVisible={openState} />
        </Window>
      </div>
    </ChatContextProvider>
  );
};
