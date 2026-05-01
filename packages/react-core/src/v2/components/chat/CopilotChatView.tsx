import React, {
  useCallback,
  useRef,
  useState,
  useEffect,
  useLayoutEffect,
} from "react";
import { ScrollElementContext } from "./scroll-element-context";
import type { WithSlots, SlotValue } from "../../lib/slots";
import { renderSlot } from "../../lib/slots";
import CopilotChatMessageView from "./CopilotChatMessageView";
import type {
  CopilotChatInputProps,
  CopilotChatInputMode,
} from "./CopilotChatInput";
import CopilotChatInput from "./CopilotChatInput";
import CopilotChatSuggestionView, {
  CopilotChatSuggestionViewProps,
} from "./CopilotChatSuggestionView";
import type { Suggestion } from "@copilotkit/core";
import type { Message } from "@ag-ui/core";
import type { Attachment } from "@copilotkit/shared";
import { CopilotChatAttachmentQueue } from "./CopilotChatAttachmentQueue";
import { twMerge } from "tailwind-merge";
import {
  StickToBottom,
  useStickToBottom,
  useStickToBottomContext,
} from "use-stick-to-bottom";
import { ChevronDown, Upload } from "lucide-react";
import { Button } from "../../components/ui/button";
import { cn } from "../../lib/utils";
import {
  useCopilotChatConfiguration,
  CopilotChatDefaultLabels,
} from "../../providers/CopilotChatConfigurationProvider";
import { useKeyboardHeight } from "../../hooks/use-keyboard-height";
import { normalizeAutoScroll } from "./normalize-auto-scroll";
import type { AutoScrollMode } from "./normalize-auto-scroll";
import { usePinToSend } from "../../hooks/use-pin-to-send";

// Vertical gap between the scroll-to-bottom button and the input container.
const SCROLL_BUTTON_OFFSET = 16;

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
    autoScroll?: AutoScrollMode | boolean;
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
    // Attachment props
    attachments?: Attachment[];
    onRemoveAttachment?: (id: string) => void;
    onAddFile?: () => void;
    dragOver?: boolean;
    onDragOver?: (e: React.DragEvent) => void;
    onDragLeave?: (e: React.DragEvent) => void;
    onDrop?: (e: React.DragEvent) => void;
    /**
     * When `true`, suppresses the welcome screen while a thread's initial
     * connect is in flight. Prevents the "How can I help you today?" flash
     * that would otherwise appear between mounting an empty cloned agent and
     * the bootstrap messages arriving from /connect.
     */
    isConnecting?: boolean;
    /**
     * When `true`, the caller has explicitly picked a thread (via `threadId`
     * prop or `CopilotChatConfigurationProvider`). Suppresses the welcome
     * screen unconditionally — a caller-managed thread targets a specific
     * conversation and should render its messages (or an empty panel during
     * connect) rather than a generic "start a new chat" greeting.
     */
    hasExplicitThreadId?: boolean;
    /**
     * @deprecated Use the `input` slot's `disclaimer` prop instead:
     * ```tsx
     * <CopilotChat input={{ disclaimer: MyDisclaimer }} />
     * ```
     */
    disclaimer?: SlotValue<React.FC<React.HTMLAttributes<HTMLDivElement>>>;
  } & React.HTMLAttributes<HTMLDivElement>
>;

function DropOverlay() {
  return (
    <div
      className={cn(
        "cpk:absolute cpk:inset-0 cpk:z-50 cpk:pointer-events-none",
        "cpk:flex cpk:items-center cpk:justify-center",
        "cpk:bg-primary/5 cpk:backdrop-blur-[2px]",
        "cpk:border-2 cpk:border-dashed cpk:border-primary/40 cpk:rounded-lg cpk:m-2",
      )}
    >
      <div className="cpk:flex cpk:flex-col cpk:items-center cpk:gap-2 cpk:text-primary/70">
        <Upload className="cpk:w-8 cpk:h-8" />
        <span className="cpk:text-sm cpk:font-medium">Drop files here</span>
      </div>
    </div>
  );
}

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
  // Attachment props
  attachments,
  onRemoveAttachment,
  onAddFile,
  dragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  isConnecting = false,
  hasExplicitThreadId = false,
  // Deprecated — forwarded to input slot
  disclaimer,
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
    onAddFile,
    positioning: "static",
    keyboardHeight: isKeyboardOpen ? keyboardHeight : 0,
    showDisclaimer: true,
    // The parent overlay wrapper handles absolute bottom-0 positioning.
    // `bottomAnchored` still triggers the license-banner offset padding
    // inside CopilotChatInput. The welcome-screen input (below) intentionally
    // omits this flag.
    bottomAnchored: true,
    ...(disclaimer !== undefined ? { disclaimer } : {}),
  } as CopilotChatInputProps);

  // Hide suggestions while a thread is connecting or a run is in flight.
  // Otherwise, mid-replay (bootstrap stream from /connect) or mid-run, the
  // suggestions would render against a still-assembling message tree and
  // visibly jump as each final text chunk reflows the layout.
  const hasSuggestions =
    !isConnecting &&
    !isRunning &&
    Array.isArray(suggestions) &&
    suggestions.length > 0;
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
        data-testid="copilot-scroll-content"
        style={{
          paddingBottom: `${inputContainerHeight + (hasSuggestions ? 4 : 32)}px`,
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
  // Suppress the welcome screen (1) while the initial connect is in flight
  // and (2) whenever the caller has picked a specific thread. The caller-
  // managed case targets a conversation directly, so the generic welcome
  // greeting is never the right thing to show — even for a thread that
  // happens to have no messages yet.
  const shouldShowWelcomeScreen =
    isEmpty && !welcomeScreenDisabled && !isConnecting && !hasExplicitThreadId;

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
      onAddFile,
      positioning: "static",
      showDisclaimer: true,
      ...(disclaimer !== undefined ? { disclaimer } : {}),
    } as CopilotChatInputProps);

    // Convert boolean `true` to undefined (use default), and exclude `false` since we've checked for it
    const welcomeScreenSlot = (
      welcomeScreen === true ? undefined : welcomeScreen
    ) as SlotValue<React.FC<WelcomeScreenProps>> | undefined;
    // Wrap the input with attachment queue above it
    const inputWithAttachments = (
      <div className="cpk:w-full">
        {attachments && attachments.length > 0 && (
          <CopilotChatAttachmentQueue
            attachments={attachments}
            onRemoveAttachment={(id) => onRemoveAttachment?.(id)}
            className="cpk:mb-2"
          />
        )}
        {BoundInputForWelcome}
      </div>
    );

    const BoundWelcomeScreen = renderSlot(
      welcomeScreenSlot,
      CopilotChatView.WelcomeScreen,
      {
        input: inputWithAttachments,
        suggestionView: BoundSuggestionView ?? <></>,
      },
    );

    return (
      <div
        data-copilotkit
        data-testid="copilot-chat"
        data-copilot-running={isRunning ? "true" : "false"}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          "copilotKitChat cpk:relative cpk:h-full cpk:flex cpk:flex-col",
          className,
        )}
        {...props}
      >
        {dragOver && <DropOverlay />}
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
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        "copilotKitChat cpk:relative cpk:h-full cpk:flex cpk:flex-col",
        className,
      )}
      {...props}
    >
      {dragOver && <DropOverlay />}
      {BoundScrollView}

      <div
        ref={inputContainerRef}
        data-testid="copilot-input-overlay"
        className="cpk:absolute cpk:bottom-0 cpk:left-0 cpk:right-0 cpk:z-20 cpk:pointer-events-none"
      >
        {attachments && attachments.length > 0 && (
          <div className="cpk:max-w-3xl cpk:mx-auto cpk:w-full cpk:pointer-events-auto">
            <CopilotChatAttachmentQueue
              attachments={attachments}
              onRemoveAttachment={(id) => onRemoveAttachment?.(id)}
              className="cpk:px-4"
            />
          </div>
        )}
        {BoundInput}
      </div>
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
    const { isAtBottom, scrollToBottom, scrollRef } = useStickToBottomContext();

    // Capture the scroll element in state so the context value is reactive —
    // consumers re-render when the element is first set rather than reading a
    // ref that silently stays null until after their own layout effects fire.
    const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
    useLayoutEffect(() => {
      setScrollEl(scrollRef.current ?? null);
      // scrollRef is a stable object; omitting from deps is intentional.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const BoundFeather = renderSlot(feather, CopilotChatView.Feather, {});

    return (
      // Provide the scroll element so CopilotChatMessageView can feed it to
      // useVirtualizer's getScrollElement. Using state (not the raw ref) means
      // the context value updates reactively when the element mounts.
      <ScrollElementContext.Provider value={scrollEl}>
        <>
          <StickToBottom.Content
            className="cpk:overflow-y-auto cpk:overflow-x-hidden"
            style={{ flex: "1 1 0%", minHeight: 0 }}
          >
            <div className="cpk:px-4 cpk:sm:px-0 cpk:[div[data-sidebar-chat]_&]:px-8 cpk:[div[data-popup-chat]_&]:px-6">
              {children}
            </div>
          </StickToBottom.Content>

          {BoundFeather}

          {/* Scroll to bottom button - hidden during resize */}
          {!isAtBottom && !isResizing && (
            <div
              className="cpk:absolute cpk:inset-x-0 cpk:flex cpk:justify-center cpk:z-30 cpk:pointer-events-none"
              style={{
                bottom: `${inputContainerHeight + SCROLL_BUTTON_OFFSET}px`,
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
      </ScrollElementContext.Provider>
    );
  };

  // Internal component for pin-to-send scroll behavior — not exported on CopilotChatView.
  const PinToSendScrollContainer: React.FC<
    React.HTMLAttributes<HTMLDivElement> & {
      scrollRef: React.MutableRefObject<HTMLElement | null>;
      contentRef: React.MutableRefObject<HTMLElement | null>;
      scrollToBottom: () => void;
      scrollToBottomButton?: SlotValue<
        React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>>
      >;
      feather?: SlotValue<React.FC<React.HTMLAttributes<HTMLDivElement>>>;
      inputContainerHeight: number;
      isResizing: boolean;
      nonAutoScrollEl: HTMLElement | null;
      nonAutoScrollRefCallback: (el: HTMLElement | null) => void;
      showScrollButton: boolean;
    }
  > = ({
    children,
    scrollRef,
    contentRef,
    scrollToBottom,
    scrollToBottomButton,
    feather,
    inputContainerHeight,
    isResizing,
    nonAutoScrollEl,
    nonAutoScrollRefCallback,
    showScrollButton,
    className,
    ...props
  }) => {
    const spacerRef = useRef<HTMLDivElement>(null);

    usePinToSend({
      scrollRef,
      contentRef,
      spacerRef,
      topOffset: 16,
    });

    // The feather and scroll-to-bottom button live OUTSIDE the scroll
    // container. `position: absolute` children of an `overflow: auto` element
    // are positioned relative to the scroll *content*, which means they
    // scroll away with it. Placing them as siblings of the scroll container
    // (inside a `relative` wrapper) keeps them pinned to the viewport bottom.
    const BoundFeather = renderSlot(feather, CopilotChatView.Feather, {});

    return (
      <ScrollElementContext.Provider value={nonAutoScrollEl}>
        <div
          className={cn(
            "cpk:h-full cpk:max-h-full cpk:flex cpk:flex-col cpk:min-h-0 cpk:relative",
            className,
          )}
        >
          <div
            ref={nonAutoScrollRefCallback}
            className="cpk:flex-1 cpk:min-h-0 cpk:overflow-y-auto cpk:overflow-x-hidden"
            {...props}
          >
            <div
              ref={contentRef}
              className="cpk:px-4 cpk:sm:px-0 cpk:[div[data-sidebar-chat]_&]:px-8 cpk:[div[data-popup-chat]_&]:px-6"
            >
              {children}
            </div>
            <div
              ref={spacerRef}
              data-pin-to-send-spacer
              aria-hidden="true"
              style={{ height: 0, flex: "0 0 auto" }}
            />
          </div>
          {BoundFeather}
          {/* Scroll to bottom button */}
          {showScrollButton && !isResizing && (
            <div
              className="cpk:absolute cpk:inset-x-0 cpk:flex cpk:justify-center cpk:z-30 cpk:pointer-events-none"
              style={{
                bottom: `${inputContainerHeight + SCROLL_BUTTON_OFFSET}px`,
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
      </ScrollElementContext.Provider>
    );
  };

  export const ScrollView: React.FC<
    React.HTMLAttributes<HTMLDivElement> & {
      autoScroll?: AutoScrollMode | boolean;
      scrollToBottomButton?: SlotValue<
        React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>>
      >;
      feather?: SlotValue<React.FC<React.HTMLAttributes<HTMLDivElement>>>;
      inputContainerHeight?: number;
      isResizing?: boolean;
    }
  > = ({
    children,
    autoScroll = "pin-to-bottom",
    scrollToBottomButton,
    feather,
    inputContainerHeight = 0,
    isResizing = false,
    className,
    ...props
  }) => {
    const mode = normalizeAutoScroll(autoScroll);
    const [hasMounted, setHasMounted] = useState(false);
    // Plain refs for the "none" and "pin-to-send" paths. Do NOT use
    // useStickToBottom() here — its internal effects would attach scroll-following
    // behavior to these refs and fight pin-to-send. The "pin-to-bottom" path
    // gets its refs via <StickToBottom> below, scoped to that branch only.
    const scrollRef = useRef<HTMLElement | null>(null);
    const contentRef = useRef<HTMLElement | null>(null);
    const scrollToBottom = useCallback(() => {
      const el = scrollRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }, []);
    const [showScrollButton, setShowScrollButton] = useState(false);
    // Tracks the scroll container element for the non-autoScroll path so the
    // context value is reactive (element state, not a ref).
    const [nonAutoScrollEl, setNonAutoScrollEl] = useState<HTMLElement | null>(
      null,
    );

    // Callback ref that keeps scrollRef in sync with the DOM element while also
    // updating context state — eliminates the need for a useLayoutEffect.
    const nonAutoScrollRefCallback = useCallback(
      (el: HTMLElement | null) => {
        scrollRef.current = el;
        setNonAutoScrollEl(el);
      },
      // scrollRef is a stable ref object; safe to omit.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    );

    useEffect(() => {
      setHasMounted(true);
    }, []);

    // Monitor scroll position for non-autoscroll mode
    useEffect(() => {
      if (mode === "pin-to-bottom") return; // Skip for autoscroll mode

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
    }, [scrollRef, mode]);

    if (!hasMounted) {
      return (
        <div className="cpk:h-full cpk:max-h-full cpk:flex cpk:flex-col cpk:min-h-0 cpk:overflow-y-auto cpk:overflow-x-hidden">
          <div className="cpk:px-4 cpk:sm:px-0 cpk:[div[data-sidebar-chat]_&]:px-8 cpk:[div[data-popup-chat]_&]:px-6">
            {children}
          </div>
        </div>
      );
    }

    if (mode === "none") {
      const BoundFeather = renderSlot(feather, CopilotChatView.Feather, {});

      return (
        // Provide the scroll element so CopilotChatMessageView can use it for
        // useVirtualizer. Element state (not a ref) keeps the context reactive.
        <ScrollElementContext.Provider value={nonAutoScrollEl}>
          <div
            ref={nonAutoScrollRefCallback}
            className={cn(
              "cpk:h-full cpk:max-h-full cpk:flex cpk:flex-col cpk:min-h-0 cpk:overflow-y-auto cpk:overflow-x-hidden cpk:relative",
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

            {BoundFeather}

            {/* Scroll to bottom button for manual mode */}
            {showScrollButton && !isResizing && (
              <div
                className="cpk:absolute cpk:inset-x-0 cpk:flex cpk:justify-center cpk:z-30 cpk:pointer-events-none"
                style={{
                  bottom: `${inputContainerHeight + SCROLL_BUTTON_OFFSET}px`,
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
        </ScrollElementContext.Provider>
      );
    }

    if (mode === "pin-to-send") {
      return (
        <PinToSendScrollContainer
          scrollRef={scrollRef}
          contentRef={contentRef}
          scrollToBottom={scrollToBottom}
          scrollToBottomButton={scrollToBottomButton}
          feather={feather}
          inputContainerHeight={inputContainerHeight}
          isResizing={isResizing}
          nonAutoScrollEl={nonAutoScrollEl}
          nonAutoScrollRefCallback={nonAutoScrollRefCallback}
          showScrollButton={showScrollButton}
          className={className}
          {...props}
        >
          {children}
        </PinToSendScrollContainer>
      );
    }

    // mode === "pin-to-bottom" (default)
    return (
      <StickToBottom
        className={cn(
          "cpk:flex-1 cpk:max-h-full cpk:flex cpk:flex-col cpk:min-h-0",
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

  // Default renders an empty div — no visual, but the element is still in the
  // tree so a slot override of the form `scrollView={{ feather: "my-class" }}`
  // can apply classes (and any consumer with a full component override gets
  // the className/style forwarding they expect).
  export const Feather: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
    className,
    ...props
  }) => <div className={className} {...props} />;

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
