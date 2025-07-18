import React, { useMemo, useCallback, useEffect, useRef } from "react";
import { ChatContextProvider, useChatContext } from "./ChatContext";
import {
  ButtonProps,
  HeaderProps,
  WindowProps,
  CopilotObservabilityHooks,
} from "./props";
import { Window as DefaultWindow } from "./Window";

// Inner component that has access to the Copilot context
const CopilotModalInner = ({
  observabilityHooks,
  onSetOpen,
  clickOutsideToClose,
  Window,
  Header,
  ...chatProps
}: Omit<CopilotModalProps, "icons" | "labels" | "defaultOpen"> & {
  Window: React.ComponentType<WindowProps>;
}) => {
  const { copilotApiConfig } = useCopilotContext();

  // Helper function to trigger event hooks only if publicApiKey is provided
  const triggerObservabilityHook = useCallback(
    (hookName: keyof CopilotObservabilityHooks, ...args: any[]) => {
      if (copilotApiConfig.publicApiKey && observabilityHooks?.[hookName]) {
        (observabilityHooks[hookName] as any)(...args);
      }
    },
    [copilotApiConfig.publicApiKey, observabilityHooks]
  );

  const { open } = useChatContext();
  const prevOpen = useRef(open);

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

  return (
    <div className="copilot-modal-container">
      <Window
        open={open}
        clickOutsideToClose={clickOutsideToClose}
        onClose={() => onSetOpen?.(false)}
        observabilityHooks={observabilityHooks}
      >
        {memoizedHeader}
        <CopilotChat {...chatProps} observabilityHooks={observabilityHooks} />
      </Window>
    </div>
  );
};

export const CopilotModal = ({
  icons,
  labels,
  defaultOpen,
  onSetOpen,
  clickOutsideToClose,
  Window,
  Header,
  markdownTagRenderers,
  className,
  children,
  observabilityHooks,
  ...props
}: CopilotModalProps) => {
  const [openState, setOpenState] = React.useState(defaultOpen);

  return (
    <ChatContextProvider
      icons={icons}
      labels={labels}
      open={openState}
      setOpen={setOpenState}
    >
      <CopilotModalInner
        observabilityHooks={observabilityHooks}
        onSetOpen={onSetOpen}
        clickOutsideToClose={clickOutsideToClose ?? true}
        Window={Window}
        Header={Header}
        markdownTagRenderers={markdownTagRenderers}
        className={className}
        children={children}
        {...props}
      />
    </ChatContextProvider>
  );
};
