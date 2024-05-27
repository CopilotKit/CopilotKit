import React from "react";
import { ChatContextProvider } from "./ChatContext";
import { ButtonProps, HeaderProps, WindowProps } from "./props";
import { Window as DefaultWindow } from "./Window";
import { Button as DefaultButton } from "./Button";
import { Header as DefaultHeader } from "./Header";
import { Messages as DefaultMessages } from "./Messages";
import { Input as DefaultInput } from "./Input";
import { ResponseButton as DefaultResponseButton } from "./Response";
import { CopilotChat, CopilotChatProps } from "./Chat";

export interface CopilotModalProps extends CopilotChatProps {
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
   * The shortcut key to open the chat window.
   * Uses Command-[shortcut] on a Mac and Ctrl-[shortcut] on Windows.
   * @default "/"
   */
  shortcut?: string;

  /**
   * A callback that gets called when the chat window opens or closes.
   */
  onSetOpen?: (open: boolean) => void;

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
}

export const CopilotModal = ({
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
}: CopilotModalProps) => {
  const [openState, setOpenState] = React.useState(defaultOpen);

  const setOpen = (open: boolean) => {
    onSetOpen?.(open);
    setOpenState(open);
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
          <CopilotChat
            instructions={instructions}
            makeSystemMessage={makeSystemMessage}
            onInProgress={onInProgress}
            onSubmitMessage={onSubmitMessage}
            showResponseButton={showResponseButton}
            Messages={Messages}
            Input={Input}
            ResponseButton={ResponseButton}
          />
        </Window>
      </div>
    </ChatContextProvider>
  );
};
