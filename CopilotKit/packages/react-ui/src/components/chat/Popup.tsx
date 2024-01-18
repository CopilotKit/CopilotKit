import React, { useCallback, useEffect, useMemo } from "react";
import {
  CopilotKitChatColorScheme,
  CopilotKitChatIcons,
  ChatContextProvider,
  CopilotKitChatLabels,
} from "./ChatContext";
import { SystemMessageFunction, useCopilotChat } from "@copilotkit/react-core";
import { ButtonProps, HeaderProps, WindowProps, MessagesProps, InputProps } from "./props";
import { Window as DefaultWindow } from "./Window";
import { Button as DefaultButton } from "./Button";
import { Header as DefaultHeader } from "./Header";
import { Messages as DefaultMessages } from "./Messages";
import { Input as DefaultInput } from "./Input";
import { nanoid } from "nanoid";

interface CopilotKitPopupProps {
  instructions?: string;
  headers?: Record<string, string> | Headers;
  body?: object;
  defaultOpen?: boolean;
  clickOutsideToClose?: boolean;
  hitEscapeToClose?: boolean;
  hotkey?: string;
  icons?: CopilotKitChatIcons;
  labels?: CopilotKitChatLabels;
  colorScheme?: CopilotKitChatColorScheme;
  makeSystemMessage?: SystemMessageFunction;
  Window?: React.ComponentType<WindowProps>;
  Button?: React.ComponentType<ButtonProps>;
  Header?: React.ComponentType<HeaderProps>;
  Messages?: React.ComponentType<MessagesProps>;
  Input?: React.ComponentType<InputProps>;
}

export const CopilotKitPopup: React.FC<CopilotKitPopupProps> = ({
  instructions,
  headers,
  body,
  defaultOpen = false,
  clickOutsideToClose = true,
  hitEscapeToClose = true,
  hotkey = "k",
  icons,
  labels,
  colorScheme,
  makeSystemMessage,
  Window = DefaultWindow,
  Button = DefaultButton,
  Header = DefaultHeader,
  Messages = DefaultMessages,
  Input = DefaultInput,
}) => {
  const { visibleMessages, append, reload, stop, isLoading, input, setInput } = useCopilotChat({
    id: nanoid(),
    initialMessages: instructions
      ? [
          {
            id: nanoid(),
            content: instructions,
            role: "system",
          },
        ]
      : [],
    makeSystemMessage: makeSystemMessage,
    headers,
    body,
  });

  const [open, setOpen] = React.useState(defaultOpen);

  const sendMessage = async (message: string) => {
    append({
      id: nanoid(),
      content: message,
      role: "user",
    });
  };

  colorScheme = colorScheme || "auto";

  const colorSchemeClass =
    "copilotKitColorScheme" + colorScheme[0].toUpperCase() + colorScheme.slice(1);

  return (
    <ChatContextProvider icons={icons} labels={labels}>
      <div className={`copilotKitPopup ${colorSchemeClass}`}>
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
          <Input inProgress={isLoading} onSend={sendMessage} />
        </Window>
      </div>
    </ChatContextProvider>
  );
};
