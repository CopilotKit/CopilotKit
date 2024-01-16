import React, { useCallback, useEffect, useMemo } from "react";
import {
  CopilotKitColorScheme,
  CopilotKitIcons,
  TemporaryContext,
  useTemporaryContext,
} from "./TemporaryContext";
import { useCopilotChat } from "@copilotkit/react-core";
import { ButtonProps, HeaderProps, WindowProps, MessagesProps, InputProps } from "./props";
import { Window as DefaultWindow } from "./Window";
import { Button as DefaultButton } from "./Button";
import { Header as DefaultHeader } from "./Header";
import { Messages as DefaultMessages } from "./Messages";
import { Input as DefaultInput } from "./Input";
import { nanoid } from "nanoid";

interface CopilotKitPopupProps {
  defaultOpen?: boolean;
  clickOutsideToClose?: boolean;
  hitEscapeToClose?: boolean;
  hotkey?: string;
  icons?: CopilotKitIcons;
  colorScheme?: CopilotKitColorScheme;
  Window?: React.ComponentType<WindowProps>;
  Button?: React.ComponentType<ButtonProps>;
  Header?: React.ComponentType<HeaderProps>;
  Messages?: React.ComponentType<MessagesProps>;
  Input?: React.ComponentType<InputProps>;
}

export const CopilotKitPopup: React.FC<CopilotKitPopupProps> = ({
  defaultOpen = false,
  clickOutsideToClose = true,
  hitEscapeToClose = true,
  hotkey = "K",
  icons,
  colorScheme,
  Window = DefaultWindow,
  Button = DefaultButton,
  Header = DefaultHeader,
  Messages = DefaultMessages,
  Input = DefaultInput,
}) => {
  const { visibleMessages, append, reload, stop, isLoading, input, setInput } = useCopilotChat({
    id: nanoid(),
    initialMessages: [], // TODO merge instructions
    makeSystemMessage: undefined,
  });

  const context = useTemporaryContext();

  const [open, setOpen] = React.useState(defaultOpen);

  const sendMessage = async (message: string) => {
    append({
      id: nanoid(),
      content: message,
      role: "user",
    });
  };

  const ctx = useMemo(() => {
    return {
      ...context,
      icons: {
        ...context.icons,
        ...icons,
      },
      colorScheme: colorScheme || context.colorScheme,
    };
  }, [context, icons, colorScheme]);

  const colorSchemeClass =
    "copilotKitColorScheme" + ctx.colorScheme[0].toUpperCase() + ctx.colorScheme.slice(1);

  return (
    <TemporaryContext.Provider value={ctx}>
      <div className={`copilotKitAssistantWindow ${colorSchemeClass}`}>
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
    </TemporaryContext.Provider>
  );
};
