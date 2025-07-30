import React, { useMemo, useCallback, useEffect, useRef } from "react";
import { ChatContextProvider, useChatContext } from "./ChatContext";
import { ButtonProps, HeaderProps, WindowProps, CopilotObservabilityHooks } from "./props";
import { Window as DefaultWindow } from "./Window";
import { Button as DefaultButton } from "./Button";
import { Header as DefaultHeader } from "./Header";
import { Messages as DefaultMessages } from "./Messages";
import { Input as DefaultInput } from "./Input";
import { CopilotChat, CopilotChatProps } from "./Chat";
import { AssistantMessage as DefaultAssistantMessage } from "./messages/AssistantMessage";
import { UserMessage as DefaultUserMessage } from "./messages/UserMessage";
import { useCopilotContext } from "@copilotkit/react-core";
import {
  CopilotKitError,
  CopilotKitErrorCode,
  Severity,
  ErrorVisibility,
  styledConsole,
} from "@copilotkit/shared";

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
   * @default '/'
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

// Inner component that has access to the Copilot context
const CopilotModalInner = ({
  observabilityHooks,
  onSetOpen,
  clickOutsideToClose,
  hitEscapeToClose,
  shortcut,
  className,
  children,
  Window,
  Button,
  Header,
  ...chatProps
}: Omit<CopilotModalProps, "icons" | "labels" | "defaultOpen"> & {
  Window: React.ComponentType<WindowProps>;
  Button: React.ComponentType<ButtonProps>;
  Header: React.ComponentType<HeaderProps>;
  clickOutsideToClose: boolean;
  hitEscapeToClose: boolean;
  shortcut: string;
}) => {
  const { copilotApiConfig, setBannerError } = useCopilotContext();

  // Destructure stable values to avoid object reference changes
  const { publicApiKey } = copilotApiConfig;

  // Helper function to trigger event hooks only if publicApiKey is provided
  const triggerObservabilityHook = useCallback(
    (hookName: keyof CopilotObservabilityHooks, ...args: any[]) => {
      if (publicApiKey && observabilityHooks?.[hookName]) {
        (observabilityHooks[hookName] as any)(...args);
      }
      if (observabilityHooks?.[hookName] && !publicApiKey) {
        setBannerError(
          new CopilotKitError({
            message: "observabilityHooks requires a publicApiKey to function.",
            code: CopilotKitErrorCode.MISSING_PUBLIC_API_KEY_ERROR,
            severity: Severity.CRITICAL,
            visibility: ErrorVisibility.BANNER,
          }),
        );
        styledConsole.publicApiKeyRequired("observabilityHooks");
      }
    },
    [publicApiKey, observabilityHooks, setBannerError],
  );

  const { open } = useChatContext();
  const prevOpen = useRef(open);

  // Monitor open state changes and trigger event hooks
  useEffect(() => {
    if (prevOpen.current !== open) {
      onSetOpen?.(open);

      // Trigger chat minimize/expand events
      if (open) {
        triggerObservabilityHook("onChatExpanded");
      } else {
        triggerObservabilityHook("onChatMinimized");
      }
      prevOpen.current = open;
    }
  }, [open, onSetOpen, triggerObservabilityHook]);

  const memoizedHeader = useMemo(() => <Header />, [Header]);
  const memoizedChildren = useMemo(() => children, [children]);

  return (
    <>
      {memoizedChildren}
      <div className={className}>
        <Button></Button>
        <Window
          clickOutsideToClose={clickOutsideToClose}
          shortcut={shortcut}
          hitEscapeToClose={hitEscapeToClose}
        >
          {memoizedHeader}
          <CopilotChat {...chatProps} observabilityHooks={observabilityHooks} />
        </Window>
      </div>
    </>
  );
};

export const CopilotModal = ({
  instructions,
  defaultOpen = false,
  clickOutsideToClose = true,
  hitEscapeToClose = true,
  onSetOpen,
  onSubmitMessage,
  onStopGeneration,
  onReloadMessages,
  shortcut = "/",
  icons,
  labels,
  makeSystemMessage,
  onInProgress,
  Window = DefaultWindow,
  Button = DefaultButton,
  Header = DefaultHeader,
  Messages = DefaultMessages,
  Input = DefaultInput,
  AssistantMessage = DefaultAssistantMessage,
  UserMessage = DefaultUserMessage,
  onThumbsUp,
  onThumbsDown,
  onCopy,
  onRegenerate,
  markdownTagRenderers,
  className,
  children,
  observabilityHooks,
  ...props
}: CopilotModalProps) => {
  const [openState, setOpenState] = React.useState(defaultOpen);

  return (
    <ChatContextProvider icons={icons} labels={labels} open={openState} setOpen={setOpenState}>
      <CopilotModalInner
        observabilityHooks={observabilityHooks}
        onSetOpen={onSetOpen}
        clickOutsideToClose={clickOutsideToClose ?? true}
        hitEscapeToClose={hitEscapeToClose ?? true}
        shortcut={shortcut ?? "/"}
        className={className}
        Window={Window}
        Button={Button}
        Header={Header}
        instructions={instructions}
        onSubmitMessage={onSubmitMessage}
        onStopGeneration={onStopGeneration}
        onReloadMessages={onReloadMessages}
        makeSystemMessage={makeSystemMessage}
        onInProgress={onInProgress}
        Messages={Messages}
        Input={Input}
        AssistantMessage={AssistantMessage}
        UserMessage={UserMessage}
        onThumbsUp={onThumbsUp}
        onThumbsDown={onThumbsDown}
        onCopy={onCopy}
        onRegenerate={onRegenerate}
        markdownTagRenderers={markdownTagRenderers}
        {...props}
      >
        {children}
      </CopilotModalInner>
    </ChatContextProvider>
  );
};
