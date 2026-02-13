import React, { useRef, useState, useEffect } from "react";
import { WithSlots, SlotValue, renderSlot } from "@/lib/slots";
import CopilotChatMessageView from "./CopilotChatMessageView";
import CopilotChatInput, {
  CopilotChatInputProps,
  CopilotChatInputMode,
} from "./CopilotChatInput";
import CopilotChatSuggestionView, {
  CopilotChatSuggestionViewProps,
} from "./CopilotChatSuggestionView";
import { Suggestion } from "@copilotkitnext/core";
import { Message } from "@ag-ui/core";
import { twMerge } from "tailwind-merge";
import {
  StickToBottom,
  useStickToBottom,
  useStickToBottomContext,
} from "use-stick-to-bottom";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  useCopilotChatConfiguration,
  CopilotChatDefaultLabels,
} from "@/providers/CopilotChatConfigurationProvider";
import { useKeyboardHeight } from "@/hooks/use-keyboard-height";

// Height of the feather gradient overlay (h-24 = 6rem = 96px)
const FEATHER_HEIGHT = 96;

// Forward declaration for WelcomeScreen component type
export type WelcomeScreenProps = WithSlots<
  {
    welcomeMessage: React.FC<React.HTMLAttributes<HTMLDivElement>>;
  },
  {
    input: React.ReactElement;
    suggestionView: React.ReactElement;
  } & React.HTMLAttributes<HTMLDivElement>
>;

export type CopilotChatViewProps = WithSlots<
  {
    messageView: typeof CopilotChatMessageView;
    scrollView: typeof CopilotChatView.ScrollView;
    input: typeof CopilotChatInput;
    suggestionView: typeof CopilotChatSuggestionView;
  },
  {
    messages?: Message[];
    autoScroll?: boolean;
    isRunning?: boolean;
    suggestions?: Suggestion[];
    suggestionLoadingIndexes?: ReadonlyArray<number>;
    onSelectSuggestion?: (suggestion: Suggestion, index: number) => void;
    welcomeScreen?: SlotValue<React.FC<WelcomeScreenProps>> | boolean;
    // Input behavior props
    onSubmitMessage?: (value: string) => void;
    onStop?: () => void;
    inputMode?: CopilotChatInputMode;
    inputValue?: string;
    onInputChange?: (value: string) => void;
    onStartTranscribe?: () => void;
    onCancelTranscribe?: () => void;
    onFinishTranscribe?: () => void;
    onFinishTranscribeWithAudio?: (audioBlob: Blob) => Promise<void>;
  } & React.HTMLAttributes<HTMLDivElement>
>;

export function CopilotChatView({
  messageView,
  input,
  scrollView,
  suggestionView,
  welcomeScreen,
  messages = [],
  autoScroll = true,
  isRunning = false,
  suggestions,
  suggestionLoadingIndexes,
  onSelectSuggestion,
  // Input behavior props
  onSubmitMessage,
  onStop,
  inputMode,
  inputValue,
  onInputChange,
  onStartTranscribe,
  onCancelTranscribe,
  onFinishTranscribe,
  onFinishTranscribeWithAudio,
  children,
  className,
  ...props
}: CopilotChatViewProps) {
  const inputContainerRef = useRef<HTMLDivElement>(null);
  const [inputContainerHeight, setInputContainerHeight] = useState(0);
  const [isResizing, setIsResizing] = useState(false);
  const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Track keyboard state for mobile
  const { isKeyboardOpen, keyboardHeight, availableHeight } =
    useKeyboardHeight();

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

  const BoundInput = renderSlot(input, CopilotChatInput, {
    onSubmitMessage,
    onStop,
    mode: inputMode,
    value: inputValue,
    onChange: onInputChange,
    isRunning,
    onStartTranscribe,
    onCancelTranscribe,
    onFinishTranscribe,
    onFinishTranscribeWithAudio,
    positioning: "absolute",
    keyboardHeight: isKeyboardOpen ? keyboardHeight : 0,
    containerRef: inputContainerRef,
    showDisclaimer: true,
  } as CopilotChatInputProps);

  const hasSuggestions = Array.isArray(suggestions) && suggestions.length > 0;
  const BoundSuggestionView = hasSuggestions
    ? renderSlot(suggestionView, CopilotChatSuggestionView, {
        suggestions,
        loadingIndexes: suggestionLoadingIndexes,
        onSelectSuggestion,
        className: "mb-3 lg:ml-4 lg:mr-4 ml-0 mr-0",
      })
    : null;

  const BoundScrollView = renderSlot(scrollView, CopilotChatView.ScrollView, {
    autoScroll,
    inputContainerHeight,
    isResizing,
    children: (
      <div
        style={{
          paddingBottom: `${inputContainerHeight + FEATHER_HEIGHT + (hasSuggestions ? 4 : 32)}px`,
        }}
      >
        <div className="max-w-3xl mx-auto">
          {BoundMessageView}
          {hasSuggestions ? (
            <div className="pl-0 pr-4 sm:px-0 mt-4">{BoundSuggestionView}</div>
          ) : null}
        </div>
      </div>
    ),
  });

  // Welcome screen logic
  const isEmpty = messages.length === 0;
  // Type assertion needed because TypeScript doesn't fully propagate `| boolean` through WithSlots
  const welcomeScreenDisabled = (welcomeScreen as unknown) === false;
  const shouldShowWelcomeScreen = isEmpty && !welcomeScreenDisabled;

  if (shouldShowWelcomeScreen) {
    // Create a separate input for welcome screen with static positioning and disclaimer visible
    const BoundInputForWelcome = renderSlot(input, CopilotChatInput, {
      onSubmitMessage,
      onStop,
      mode: inputMode,
      value: inputValue,
      onChange: onInputChange,
      isRunning,
      onStartTranscribe,
      onCancelTranscribe,
      onFinishTranscribe,
      onFinishTranscribeWithAudio,
      positioning: "static",
      showDisclaimer: true,
    } as CopilotChatInputProps);

    // Convert boolean `true` to undefined (use default), and exclude `false` since we've checked for it
    const welcomeScreenSlot = (
      welcomeScreen === true ? undefined : welcomeScreen
    ) as SlotValue<React.FC<WelcomeScreenProps>> | undefined;
    const BoundWelcomeScreen = renderSlot(
      welcomeScreenSlot,
      CopilotChatView.WelcomeScreen,
      {
        input: BoundInputForWelcome,
        suggestionView: BoundSuggestionView ?? <></>,
      },
    );

    return (
      <div
        className={twMerge("relative h-full flex flex-col", className)}
        {...props}
      >
        {BoundWelcomeScreen}
      </div>
    );
  }

  if (children) {
    return children({
      messageView: BoundMessageView,
      input: BoundInput,
      scrollView: BoundScrollView,
      suggestionView: BoundSuggestionView ?? <></>,
    });
  }

  return (
    <div className={twMerge("relative h-full", className)} {...props}>
      {BoundScrollView}

      {BoundInput}
    </div>
  );
}

export namespace CopilotChatView {
  // Inner component that has access to StickToBottom context
  const ScrollContent: React.FC<{
    children: React.ReactNode;
    scrollToBottomButton?: SlotValue<
      React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>>
    >;
    feather?: SlotValue<React.FC<React.HTMLAttributes<HTMLDivElement>>>;
    inputContainerHeight: number;
    isResizing: boolean;
  }> = ({
    children,
    scrollToBottomButton,
    feather,
    inputContainerHeight,
    isResizing,
  }) => {
    const { isAtBottom, scrollToBottom } = useStickToBottomContext();

    const BoundFeather = renderSlot(feather, CopilotChatView.Feather, {});

    return (
      <>
        <StickToBottom.Content
          className="overflow-y-scroll overflow-x-hidden"
          style={{ flex: "1 1 0%", minHeight: 0 }}
        >
          <div className="px-4 sm:px-0 [div[data-sidebar-chat]_&]:px-8 [div[data-popup-chat]_&]:px-6">
            {children}
          </div>
        </StickToBottom.Content>

        {/* Feather gradient overlay */}
        {BoundFeather}

        {/* Scroll to bottom button - hidden during resize */}
        {!isAtBottom && !isResizing && (
          <div
            className="absolute inset-x-0 flex justify-center z-30 pointer-events-none"
            style={{
              bottom: `${inputContainerHeight + FEATHER_HEIGHT + 16}px`,
            }}
          >
            {renderSlot(
              scrollToBottomButton,
              CopilotChatView.ScrollToBottomButton,
              {
                onClick: () => scrollToBottom(),
              },
            )}
          </div>
        )}
      </>
    );
  };

  export const ScrollView: React.FC<
    React.HTMLAttributes<HTMLDivElement> & {
      autoScroll?: boolean;
      scrollToBottomButton?: SlotValue<
        React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>>
      >;
      feather?: SlotValue<React.FC<React.HTMLAttributes<HTMLDivElement>>>;
      inputContainerHeight?: number;
      isResizing?: boolean;
    }
  > = ({
    children,
    autoScroll = true,
    scrollToBottomButton,
    feather,
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
        const atBottom =
          scrollElement.scrollHeight -
            scrollElement.scrollTop -
            scrollElement.clientHeight <
          10;
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
          <div className="px-4 sm:px-0 [div[data-sidebar-chat]_&]:px-8 [div[data-popup-chat]_&]:px-6">
            {children}
          </div>
        </div>
      );
    }

    // When autoScroll is false, we don't use StickToBottom
    if (!autoScroll) {
      const BoundFeather = renderSlot(feather, CopilotChatView.Feather, {});

      return (
        <div
          ref={scrollRef}
          className={cn(
            "h-full max-h-full flex flex-col min-h-0 overflow-y-scroll overflow-x-hidden relative",
            className,
          )}
          {...props}
        >
          <div
            ref={contentRef}
            className="px-4 sm:px-0 [div[data-sidebar-chat]_&]:px-8 [div[data-popup-chat]_&]:px-6"
          >
            {children}
          </div>

          {/* Feather gradient overlay */}
          {BoundFeather}

          {/* Scroll to bottom button for manual mode */}
          {showScrollButton && !isResizing && (
            <div
              className="absolute inset-x-0 flex justify-center z-30 pointer-events-none"
              style={{
                bottom: `${inputContainerHeight + FEATHER_HEIGHT + 16}px`,
              }}
            >
              {renderSlot(
                scrollToBottomButton,
                CopilotChatView.ScrollToBottomButton,
                {
                  onClick: () => scrollToBottom(),
                },
              )}
            </div>
          )}
        </div>
      );
    }

    return (
      <StickToBottom
        className={cn(
          "h-full max-h-full flex flex-col min-h-0 relative",
          className,
        )}
        resize="smooth"
        initial="smooth"
        {...props}
      >
        <ScrollContent
          scrollToBottomButton={scrollToBottomButton}
          feather={feather}
          inputContainerHeight={inputContainerHeight}
          isResizing={isResizing}
        >
          {children}
        </ScrollContent>
      </StickToBottom>
    );
  };

  export const ScrollToBottomButton: React.FC<
    React.ButtonHTMLAttributes<HTMLButtonElement>
  > = ({ className, ...props }) => (
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

  export const Feather: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
    className,
    style,
    ...props
  }) => (
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

  export const WelcomeMessage: React.FC<
    React.HTMLAttributes<HTMLDivElement>
  > = ({ className, ...props }) => {
    const config = useCopilotChatConfiguration();
    const labels = config?.labels ?? CopilotChatDefaultLabels;

    return (
      <h1
        className={cn(
          "text-xl sm:text-2xl font-medium text-foreground text-center",
          className,
        )}
        {...props}
      >
        {labels.welcomeMessageText}
      </h1>
    );
  };

  export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
    welcomeMessage,
    input,
    suggestionView,
    className,
    children,
    ...props
  }) => {
    // Render the welcomeMessage slot internally
    const BoundWelcomeMessage = renderSlot(
      welcomeMessage,
      CopilotChatView.WelcomeMessage,
      {},
    );

    if (children) {
      return (
        <>
          {children({
            welcomeMessage: BoundWelcomeMessage,
            input,
            suggestionView,
            className,
            ...props,
          })}
        </>
      );
    }

    return (
      <div
        className={cn(
          "flex-1 flex flex-col items-center justify-center px-4",
          className,
        )}
        {...props}
      >
        <div className="w-full max-w-3xl flex flex-col items-center">
          {/* Welcome message */}
          <div className="mb-6">{BoundWelcomeMessage}</div>

          {/* Input */}
          <div className="w-full">{input}</div>

          {/* Suggestions */}
          <div className="mt-4 flex justify-center">{suggestionView}</div>
        </div>
      </div>
    );
  };
}

export default CopilotChatView;
