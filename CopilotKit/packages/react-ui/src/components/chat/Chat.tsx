import React, { useCallback, useEffect, useMemo } from "react";
import { CopilotKitChatIcons, ChatContextProvider, CopilotKitChatLabels } from "./ChatContext";
import { SystemMessageFunction, useCopilotChat } from "@copilotkit/react-core";
import { ButtonProps, HeaderProps, WindowProps, MessagesProps, InputProps } from "./props";
import { Window as DefaultWindow } from "./Window";
import { Button as DefaultButton } from "./Button";
import { Header as DefaultHeader } from "./Header";
import { Messages as DefaultMessages } from "./Messages";
import { Input as DefaultInput } from "./Input";
import { nanoid } from "nanoid";
import { ResponseButton } from "./Response";

export interface CopilotKitChatProps {
  instructions?: string;
  defaultOpen?: boolean;
  clickOutsideToClose?: boolean;
  hitEscapeToClose?: boolean;
  hotkey?: string;
  icons?: CopilotKitChatIcons;
  labels?: CopilotKitChatLabels;
  makeSystemMessage?: SystemMessageFunction;
  Window?: React.ComponentType<WindowProps>;
  Button?: React.ComponentType<ButtonProps>;
  Header?: React.ComponentType<HeaderProps>;
  Messages?: React.ComponentType<MessagesProps>;
  Input?: React.ComponentType<InputProps>;
  className?: string;
}

export const CopilotKitChat: React.FC<CopilotKitChatProps> = ({
  instructions,
  defaultOpen = false,
  clickOutsideToClose = true,
  hitEscapeToClose = true,
  hotkey = "e",
  icons,
  labels,
  makeSystemMessage,
  Window = DefaultWindow,
  Button = DefaultButton,
  Header = DefaultHeader,
  Messages = DefaultMessages,
  Input = DefaultInput,
  className,
}) => {
  const { visibleMessages, append, reload, stop, isLoading, input, setInput } = useCopilotChat({
    id: nanoid(),
    makeSystemMessage,
    additionalInstructions: instructions,
  });

  const [open, setOpen] = React.useState(defaultOpen);

  const sendMessage = async (message: string) => {
    append({
      id: nanoid(),
      content: message,
      role: "user",
    });
  };

  return (
    <ChatContextProvider icons={icons} labels={labels}>
      <div className={className}>
        <Button open={open} setOpen={setOpen}></Button>
        <Window
          open={open}
          setOpen={setOpen}
          clickOutsideToClose={clickOutsideToClose}
          hotkey={hotkey}
          hitEscapeToClose={hitEscapeToClose}
        >
          <Header open={open} setOpen={setOpen} />
          <Messages messages={visibleMessages} inProgress={isLoading} />
          <Input inProgress={isLoading} onSend={sendMessage}>
            {visibleMessages.length > 0 && (
              <ResponseButton onClick={isLoading ? stop : reload} inProgress={isLoading} />
            )}
          </Input>
        </Window>
      </div>
    </ChatContextProvider>
  );
};
