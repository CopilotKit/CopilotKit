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
        className: "cpk:mb-3 cpk:lg:ml-4 cpk:lg:mr-4 cpk:ml-0 cpk:mr-0",
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
        <div className="cpk:max-w-3xl cpk:mx-auto">
          {BoundMessageView}
          {hasSuggestions ? (
            <div className="cpk:pl-0 cpk:pr-4 cpk:sm:px-0 cpk:mt-4">
              {BoundSuggestionView}
            </div>
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
        data-copilotkit
        data-testid="copilot-chat"
        data-copilot-running={isRunning ? "true" : "false"}
        className={twMerge(
          "cpk:relative cpk:h-full cpk:flex cpk:flex-col",
          className,
        )}
        {...props}
      >
        {BoundWelcomeScreen}
      </div>
    );
  }

  if (children) {
    return (
      <div data-copilotkit style={{ display: "contents" }}>
        {children({
          messageView: BoundMessageView,
          input: BoundInput,
          scrollView: BoundScrollView,
          suggestionView: BoundSuggestionView ?? <></>,
        })}
      </div>
    );
  }

  return (
    <div
      data-copilotkit
      data-testid="copilot-chat"
      data-copilot-running={isRunning ? "true" : "false"}
      className={twMerge("cpk:relative cpk:h-full", className)}
      {...props}
    >
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
          className="cpk:overflow-y-scroll cpk:overflow-x-hidden"
          style={{ flex: "1 1 0%", minHeight: 0 }}
        >
          <div className="cpk:px-4 cpk:sm:px-0 cpk:[div[data-sidebar-chat]_&]:px-8 cpk:[div[data-popup-chat]_&]:px-6">
            {children}
          </div>
        </StickToBottom.Content>

        {/* Feather gradient overlay */}
        {BoundFeather}

        {/* Scroll to bottom button - hidden during resize */}
        {!isAtBottom && !isResizing && (
          <div
            className="cpk:absolute cpk:inset-x-0 cpk:flex cpk:justify-center cpk:z-30 cpk:pointer-events-none"
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
        <div className="cpk:h-full cpk:max-h-full cpk:flex cpk:flex-col cpk:min-h-0 cpk:overflow-y-scroll cpk:overflow-x-hidden">
          <div className="cpk:px-4 cpk:sm:px-0 cpk:[div[data-sidebar-chat]_&]:px-8 cpk:[div[data-popup-chat]_&]:px-6">
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
            "cpk:h-full cpk:max-h-full cpk:flex cpk:flex-col cpk:min-h-0 cpk:overflow-y-scroll cpk:overflow-x-hidden cpk:relative",
            className,
          )}
          {...props}
        >
          <div
            ref={contentRef}
            className="cpk:px-4 cpk:sm:px-0 cpk:[div[data-sidebar-chat]_&]:px-8 cpk:[div[data-popup-chat]_&]:px-6"
          >
            {children}
          </div>

          {/* Feather gradient overlay */}
          {BoundFeather}

          {/* Scroll to bottom button for manual mode */}
          {showScrollButton && !isResizing && (
            <div
              className="cpk:absolute cpk:inset-x-0 cpk:flex cpk:justify-center cpk:z-30 cpk:pointer-events-none"
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
          "cpk:h-full cpk:max-h-full cpk:flex cpk:flex-col cpk:min-h-0 cpk:relative",
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
      data-testid="copilot-scroll-to-bottom"
      variant="outline"
      size="sm"
      className={twMerge(
        "cpk:rounded-full cpk:w-10 cpk:h-10 cpk:p-0 cpk:pointer-events-auto",
        "cpk:bg-white cpk:dark:bg-gray-900",
        "cpk:shadow-lg cpk:border cpk:border-gray-200 cpk:dark:border-gray-700",
        "cpk:hover:bg-gray-50 cpk:dark:hover:bg-gray-800",
        "cpk:flex cpk:items-center cpk:justify-center cpk:cursor-pointer",
        className,
      )}
      {...props}
    >
      <ChevronDown className="cpk:w-4 cpk:h-4 cpk:text-gray-600 cpk:dark:text-white" />
    </Button>
  );

  export const Feather: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
    className,
    style,
    ...props
  }) => (
    <div
      className={cn(
        "cpk:absolute cpk:bottom-0 cpk:left-0 cpk:right-4 cpk:h-24 cpk:pointer-events-none cpk:z-10 cpk:bg-gradient-to-t",
        "cpk:from-white cpk:via-white cpk:to-transparent",
        "cpk:dark:from-[rgb(33,33,33)] cpk:dark:via-[rgb(33,33,33)]",
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
          "cpk:text-xl cpk:sm:text-2xl cpk:font-medium cpk:text-foreground cpk:text-center",
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
        <div data-copilotkit style={{ display: "contents" }}>
          {children({
            welcomeMessage: BoundWelcomeMessage,
            input,
            suggestionView,
            className,
            ...props,
          })}
        </div>
      );
    }

    return (
      <div
        data-testid="copilot-welcome-screen"
        className={cn(
          "cpk:flex-1 cpk:flex cpk:flex-col cpk:items-center cpk:justify-center cpk:px-4",
          className,
        )}
        {...props}
      >
        <div className="cpk:w-full cpk:max-w-3xl cpk:flex cpk:flex-col cpk:items-center">
          {/* Welcome message */}
          <div className="cpk:mb-6">{BoundWelcomeMessage}</div>

          {/* Input */}
          <div className="cpk:w-full">{input}</div>

          {/* Suggestions */}
          <div className="cpk:mt-4 cpk:flex cpk:justify-center">
            {suggestionView}
          </div>
        </div>
      </div>
    );
  };
}

export default CopilotChatView;
