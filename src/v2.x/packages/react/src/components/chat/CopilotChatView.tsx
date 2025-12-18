import React, { useRef, useState, useEffect } from "react";
import { WithSlots, SlotValue, renderSlot } from "@/lib/slots";
import CopilotChatMessageView from "./CopilotChatMessageView";
import CopilotChatInput, { CopilotChatInputProps } from "./CopilotChatInput";
import CopilotChatSuggestionView, { CopilotChatSuggestionViewProps } from "./CopilotChatSuggestionView";
import { Suggestion } from "@copilotkitnext/core";
import { Message } from "@ag-ui/core";
import { twMerge } from "tailwind-merge";
import { StickToBottom, useStickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCopilotChatConfiguration, CopilotChatDefaultLabels } from "@/providers/CopilotChatConfigurationProvider";
import { useKeyboardHeight } from "@/hooks/use-keyboard-height";

export type CopilotChatViewProps = WithSlots<
  {
    messageView: typeof CopilotChatMessageView;
    scrollView: React.FC<React.HTMLAttributes<HTMLDivElement>>;
    scrollToBottomButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>>;
    input: typeof CopilotChatInput;
    inputContainer: React.FC<React.HTMLAttributes<HTMLDivElement> & { children: React.ReactNode }>;
    feather: React.FC<React.HTMLAttributes<HTMLDivElement>>;
    disclaimer: React.FC<React.HTMLAttributes<HTMLDivElement>>;
    suggestionView: typeof CopilotChatSuggestionView;
  },
  {
    messages?: Message[];
    autoScroll?: boolean;
    inputProps?: Partial<Omit<CopilotChatInputProps, "children">>;
    isRunning?: boolean;
    suggestions?: Suggestion[];
    suggestionLoadingIndexes?: ReadonlyArray<number>;
    onSelectSuggestion?: (suggestion: Suggestion, index: number) => void;
  } & React.HTMLAttributes<HTMLDivElement>
>;

export function CopilotChatView({
  messageView,
  input,
  scrollView,
  scrollToBottomButton,
  feather,
  inputContainer,
  disclaimer,
  suggestionView,
  messages = [],
  autoScroll = true,
  inputProps,
  isRunning = false,
  suggestions,
  suggestionLoadingIndexes,
  onSelectSuggestion,
  children,
  className,
  ...props
}: CopilotChatViewProps) {
  const inputContainerRef = useRef<HTMLDivElement>(null);
  const [inputContainerHeight, setInputContainerHeight] = useState(0);
  const [isResizing, setIsResizing] = useState(false);
  const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Track keyboard state for mobile
  const { isKeyboardOpen, keyboardHeight, availableHeight } = useKeyboardHeight();

  // Track input container height changes
  useEffect(() => {
    const element = inputContainerRef.current;
    if (!element) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newHeight = entry.contentRect.height;

        // Update height and set resizing state
        setInputContainerHeight((prevHeight) => {
          if (newHeight !== prevHeight) {
            setIsResizing(true);

            // Clear existing timeout
            if (resizeTimeoutRef.current) {
              clearTimeout(resizeTimeoutRef.current);
            }

            // Set isResizing to false after a short delay
            resizeTimeoutRef.current = setTimeout(() => {
              setIsResizing(false);
            }, 250);

            return newHeight;
          }
          return prevHeight;
        });
      }
    });

    resizeObserver.observe(element);

    // Set initial height
    setInputContainerHeight(element.offsetHeight);

    return () => {
      resizeObserver.disconnect();
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
    };
  }, []);

  const BoundMessageView = renderSlot(messageView, CopilotChatMessageView, {
    messages,
    isRunning,
  });

  const BoundInput = renderSlot(input, CopilotChatInput, (inputProps ?? {}) as CopilotChatInputProps);

  const hasSuggestions = Array.isArray(suggestions) && suggestions.length > 0;
  const BoundSuggestionView = hasSuggestions
    ? renderSlot(suggestionView, CopilotChatSuggestionView, {
        suggestions,
        loadingIndexes: suggestionLoadingIndexes,
        onSelectSuggestion,
        className: "mb-3 lg:ml-4 lg:mr-4 ml-0 mr-0",
      })
    : null;

  const BoundFeather = renderSlot(feather, CopilotChatView.Feather, {});

  const BoundScrollView = renderSlot(scrollView, CopilotChatView.ScrollView, {
    autoScroll,
    scrollToBottomButton,
    inputContainerHeight,
    isResizing,
    children: (
      <div style={{ paddingBottom: `${inputContainerHeight + (hasSuggestions ? 4 : 32)}px` }}>
        <div className="max-w-3xl mx-auto">
          {BoundMessageView}
          {hasSuggestions ? <div className="pl-0 pr-4 sm:px-0 mt-4">{BoundSuggestionView}</div> : null}
        </div>
      </div>
    ),
  });

  const BoundScrollToBottomButton = renderSlot(scrollToBottomButton, CopilotChatView.ScrollToBottomButton, {});

  const BoundDisclaimer = renderSlot(disclaimer, CopilotChatView.Disclaimer, {});

  const BoundInputContainer = renderSlot(inputContainer, CopilotChatView.InputContainer, {
    ref: inputContainerRef,
    keyboardHeight: isKeyboardOpen ? keyboardHeight : 0,
    children: (
      <>
        <div className="max-w-3xl mx-auto py-0 px-4 sm:px-0 [div[data-sidebar-chat]_&]:px-8 [div[data-popup-chat]_&]:px-6 pointer-events-auto">
          {BoundInput}
        </div>
        {BoundDisclaimer}
      </>
    ),
  });

  if (children) {
    return children({
      messageView: BoundMessageView,
      input: BoundInput,
      scrollView: BoundScrollView,
      scrollToBottomButton: BoundScrollToBottomButton,
      feather: BoundFeather,
      inputContainer: BoundInputContainer,
      disclaimer: BoundDisclaimer,
      suggestionView: BoundSuggestionView ?? <></>,
    });
  }

  return (
    <div className={twMerge("relative h-full", className)} {...props}>
      {BoundScrollView}

      {BoundFeather}

      {BoundInputContainer}
    </div>
  );
}

export namespace CopilotChatView {
  // Inner component that has access to StickToBottom context
  const ScrollContent: React.FC<{
    children: React.ReactNode;
    scrollToBottomButton?: SlotValue<React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>>>;
    inputContainerHeight: number;
    isResizing: boolean;
  }> = ({ children, scrollToBottomButton, inputContainerHeight, isResizing }) => {
    const { isAtBottom, scrollToBottom } = useStickToBottomContext();

    return (
      <>
        <StickToBottom.Content className="overflow-y-scroll overflow-x-hidden">
        <div className="px-4 sm:px-0 [div[data-sidebar-chat]_&]:px-8 [div[data-popup-chat]_&]:px-6">{children}</div>
        </StickToBottom.Content>

        {/* Scroll to bottom button - hidden during resize */}
        {!isAtBottom && !isResizing && (
          <div
            className="absolute inset-x-0 flex justify-center z-10 pointer-events-none"
            style={{
              bottom: `${inputContainerHeight + 16}px`,
            }}
          >
            {renderSlot(scrollToBottomButton, CopilotChatView.ScrollToBottomButton, {
              onClick: () => scrollToBottom(),
            })}
          </div>
        )}
      </>
    );
  };

  export const ScrollView: React.FC<
    React.HTMLAttributes<HTMLDivElement> & {
      autoScroll?: boolean;
      scrollToBottomButton?: SlotValue<React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>>>;
      inputContainerHeight?: number;
      isResizing?: boolean;
    }
  > = ({
    children,
    autoScroll = true,
    scrollToBottomButton,
    inputContainerHeight = 0,
    isResizing = false,
    className,
    ...props
  }) => {
    const [hasMounted, setHasMounted] = useState(false);
    const { scrollRef, contentRef, scrollToBottom } = useStickToBottom();
    const [showScrollButton, setShowScrollButton] = useState(false);

    useEffect(() => {
      setHasMounted(true);
    }, []);

    // Monitor scroll position for non-autoscroll mode
    useEffect(() => {
      if (autoScroll) return; // Skip for autoscroll mode

      const scrollElement = scrollRef.current;
      if (!scrollElement) return;

      const checkScroll = () => {
        const atBottom = scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight < 10;
        setShowScrollButton(!atBottom);
      };

      checkScroll();
      scrollElement.addEventListener("scroll", checkScroll);

      // Also check on resize
      const resizeObserver = new ResizeObserver(checkScroll);
      resizeObserver.observe(scrollElement);

      return () => {
        scrollElement.removeEventListener("scroll", checkScroll);
        resizeObserver.disconnect();
      };
    }, [scrollRef, autoScroll]);

    if (!hasMounted) {
      return (
        <div className="h-full max-h-full flex flex-col min-h-0 overflow-y-scroll overflow-x-hidden">
          <div className="px-4 sm:px-0 [div[data-sidebar-chat]_&]:px-8 [div[data-popup-chat]_&]:px-6">{children}</div>
        </div>
      );
    }

    // When autoScroll is false, we don't use StickToBottom
    if (!autoScroll) {
      return (
        <div
          ref={scrollRef}
          className={cn(
            "h-full max-h-full flex flex-col min-h-0 overflow-y-scroll overflow-x-hidden relative",
            className,
          )}
          {...props}
        >
          <div ref={contentRef} className="px-4 sm:px-0 [div[data-sidebar-chat]_&]:px-8 [div[data-popup-chat]_&]:px-6">
            {children}
          </div>

          {/* Scroll to bottom button for manual mode */}
          {showScrollButton && !isResizing && (
            <div
              className="absolute inset-x-0 flex justify-center z-10 pointer-events-none"
              style={{
                bottom: `${inputContainerHeight + 16}px`,
              }}
            >
              {renderSlot(scrollToBottomButton, CopilotChatView.ScrollToBottomButton, {
                onClick: () => scrollToBottom(),
              })}
            </div>
          )}
        </div>
      );
    }

    return (
      <StickToBottom
        className={cn("h-full max-h-full flex flex-col min-h-0 relative", className)}
        resize="smooth"
        initial="smooth"
        {...props}
      >
        <ScrollContent
          scrollToBottomButton={scrollToBottomButton}
          inputContainerHeight={inputContainerHeight}
          isResizing={isResizing}
        >
          {children}
        </ScrollContent>
      </StickToBottom>
    );
  };

  export const ScrollToBottomButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({
    className,
    ...props
  }) => (
    <Button
      variant="outline"
      size="sm"
      className={twMerge(
        "rounded-full w-10 h-10 p-0 pointer-events-auto",
        "bg-white dark:bg-gray-900",
        "shadow-lg border border-gray-200 dark:border-gray-700",
        "hover:bg-gray-50 dark:hover:bg-gray-800",
        "flex items-center justify-center cursor-pointer",
        className,
      )}
      {...props}
    >
      <ChevronDown className="w-4 h-4 text-gray-600 dark:text-white" />
    </Button>
  );

  export const Feather: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, style, ...props }) => (
    <div
      className={cn(
        "absolute bottom-0 left-0 right-4 h-24 pointer-events-none z-10 bg-gradient-to-t",
        "from-white via-white to-transparent",
        "dark:from-[rgb(33,33,33)] dark:via-[rgb(33,33,33)]",
        className,
      )}
      style={style}
      {...props}
    />
  );

  export const InputContainer = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement> & { children: React.ReactNode; keyboardHeight?: number }
  >(({ children, className, keyboardHeight = 0, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("absolute bottom-0 left-0 right-0 z-20 pointer-events-none", className)}
      style={{
        // Adjust position when keyboard is open to keep input visible
        transform: keyboardHeight > 0 ? `translateY(-${keyboardHeight}px)` : undefined,
        transition: "transform 0.2s ease-out",
      }}
      {...props}
    >
      {children}
    </div>
  ));

  InputContainer.displayName = "CopilotChatView.InputContainer";

  export const Disclaimer: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => {
    const config = useCopilotChatConfiguration();
    const labels = config?.labels ?? CopilotChatDefaultLabels;

    return (
      <div
        className={cn("text-center text-xs text-muted-foreground py-3 px-4 max-w-3xl mx-auto", className)}
        {...props}
      >
        {labels.chatDisclaimerText}
      </div>
    );
  };
}

export default CopilotChatView;
