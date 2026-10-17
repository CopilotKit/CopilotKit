import type { AssistantMessage, Message } from "@ag-ui/core";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowUp,
  Copy,
  Check,
  ThumbsUp,
  ThumbsDown,
  Volume2,
  RefreshCw,
} from "lucide-react";
import {
  useCopilotChatConfiguration,
  CopilotChatDefaultLabels,
} from "../../providers/CopilotChatConfigurationProvider";
import { twMerge } from "tailwind-merge";
import { Button } from "../../components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../components/ui/tooltip";
import { useKatexStyles } from "../../hooks/useKatexStyles";
import type { SlotValue, WithSlots } from "../../lib/slots";
import { renderSlot } from "../../lib/slots";
import { Streamdown } from "streamdown";
import { copyToClipboard } from "@copilotkit/shared";
import CopilotChatToolCallsView from "./CopilotChatToolCallsView";
import { useCopilotKitInspector } from "../CopilotKitInspectorContext";
import {
  CopilotChatInspectorButton,
  useInspectorShortcutsHidden,
} from "./CopilotChatInspectorButton";
import type { CopilotKitInspectorOpenRequest } from "../CopilotKitInspectorContext";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "../../components/ui/popover";
import { useFeedbackComment, useMessageFeedback } from "./message-feedback";
import type { FeedbackComment } from "./message-feedback";
import { MESSAGE_FEEDBACK_MAX_COMMENT_LENGTH } from "../../lib/message-feedback";
import type { MessageFeedbackRating } from "../../lib/message-feedback";

export type CopilotChatFeedbackMessage = AssistantMessage & {
  rawEvent?: unknown;
};

export type CopilotChatAssistantMessageProps = WithSlots<
  {
    markdownRenderer: typeof CopilotChatAssistantMessage.MarkdownRenderer;
    toolbar: typeof CopilotChatAssistantMessage.Toolbar;
    copyButton: typeof CopilotChatAssistantMessage.CopyButton;
    inspectorButton: typeof CopilotChatAssistantMessage.InspectorButton;
    thumbsUpButton: typeof CopilotChatAssistantMessage.ThumbsUpButton;
    thumbsDownButton: typeof CopilotChatAssistantMessage.ThumbsDownButton;
    readAloudButton: typeof CopilotChatAssistantMessage.ReadAloudButton;
    regenerateButton: typeof CopilotChatAssistantMessage.RegenerateButton;
    toolCallsView: typeof CopilotChatToolCallsView;
  },
  {
    onThumbsUp?: (message: CopilotChatFeedbackMessage) => void;
    onThumbsDown?: (message: CopilotChatFeedbackMessage) => void;
    onReadAloud?: (message: AssistantMessage) => void;
    onRegenerate?: (message: AssistantMessage) => void;
    message: AssistantMessage;
    messages?: Message[];
    isRunning?: boolean;
    /**
     * Whether this is the last message the chat renders. The message view
     * passes it, because the rendered list can differ from `messages` when
     * `transformMessages` drops, replaces or reorders messages. Defaults to
     * comparing against the last entry of `messages`.
     */
    isLatest?: boolean;
    additionalToolbarItems?: React.ReactNode;
    toolbarVisible?: boolean;
    /**
     * The comment field of a reply rating, inside the popover next to the
     * chosen thumb. Shown only while Automatic Learning records ratings; it
     * renders after `children`, so a `children` layout does not place it.
     */
    feedbackComment?: SlotValue<
      typeof CopilotChatAssistantMessage.FeedbackComment
    >;
  } & React.HTMLAttributes<HTMLDivElement>
>;

/**
 * Binds the Inspector action to the active chat without making the full
 * assistant message subscribe to chat configuration changes.
 */
function BoundInspectorButton({
  inspectorButton,
  messageId,
  openInspector,
  ...props
}: {
  inspectorButton: CopilotChatAssistantMessageProps["inspectorButton"];
  messageId: string;
  openInspector: (request: CopilotKitInspectorOpenRequest) => void;
} & Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick"
>): React.ReactElement {
  const chatConfiguration = useCopilotChatConfiguration();

  return renderSlot(
    inspectorButton,
    CopilotChatAssistantMessage.InspectorButton,
    {
      ...props,
      onClick: () =>
        openInspector({
          messageId,
          threadId: chatConfiguration?.threadId,
          agentId: chatConfiguration?.agentId,
        }),
    },
  );
}

/** Whether focus came from the keyboard; a pointer click also focuses buttons. */
function isFocusVisible(element: Element): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    return false;
  }
}

// Checks `visibility: hidden` too, which a detached popover uses.
const HIDDEN_TOO = { checkVisibilityCSS: true, visibilityProperty: true };

// Elements Tab stops at; Radix focus guards are skipped.
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]",
]
  .map(
    (selector) =>
      `${selector}:not([tabindex="-1"]):not([data-radix-focus-guard])`,
  )
  .join(", ");

/** Approximately the element Tab reaches after `element`, outside `skip`. */
function nextFocusable(
  element: Element,
  skip: Element | null,
): HTMLElement | null {
  const all = Array.from(
    element.ownerDocument.querySelectorAll<HTMLElement>(FOCUSABLE),
  ).filter(
    (candidate) =>
      candidate === element ||
      (!skip?.contains(candidate) && !candidate.closest("[hidden], [inert]")),
  );
  const index = all.indexOf(element as HTMLElement);
  return index === -1 ? null : (all[index + 1] ?? null);
}

/**
 * The comment popover of a rated message, pointing at the chosen thumb. Kept
 * apart so only it, not the whole message, follows chat configuration.
 *
 * The popover lives in a portal, so it keeps keyboard order by hand: Shift+Tab
 * from its start returns to the thumb, Tab from its end moves on to the
 * control after the thumb, and Enter or Escape inside it returns to the thumb.
 */
function FeedbackCommentPopover({
  feedbackComment,
  comment,
  savedComment,
  rating,
  anchor,
  messageId,
}: {
  feedbackComment:
    | SlotValue<typeof CopilotChatAssistantMessage.FeedbackComment>
    | undefined;
  comment: FeedbackComment;
  savedComment: string;
  rating: MessageFeedbackRating;
  anchor: React.RefObject<HTMLElement | null>;
  messageId: string;
}): React.ReactElement {
  const config = useCopilotChatConfiguration();
  const labels = config?.labels ?? CopilotChatDefaultLabels;
  const contentRef = useRef<HTMLDivElement>(null);
  const focusInside = () =>
    contentRef.current?.contains(document.activeElement) ?? false;
  // A keyboard rating moves focus into the field, as the popover opens or,
  // when it was open already, as the field for the new rating renders.
  const { focusRequest, takeFocusRequest, inputRef } = comment;
  const focusField = useCallback(() => {
    if (inputRef.current && takeFocusRequest()) inputRef.current.focus();
  }, [inputRef, takeFocusRequest]);
  useEffect(() => focusField(), [focusRequest, focusField]);
  /** Whether `target` is a thumb of this message, whose click decides itself. */
  const isOwnThumb = (target: EventTarget | null) => {
    const thumb =
      target instanceof Element
        ? target.closest("[data-copilotkit-rating]")
        : null;
    return (
      thumb?.closest("[data-message-id]")?.getAttribute("data-message-id") ===
      messageId
    );
  };
  return (
    <Popover
      open={comment.open}
      onOpenChange={(open) => {
        if (!open) comment.close();
      }}
    >
      <PopoverAnchor virtualRef={anchor as React.RefObject<HTMLElement>} />
      <PopoverContent
        ref={contentRef}
        side="bottom"
        collisionPadding={8}
        hideWhenDetached
        aria-label={labels.assistantMessageFeedbackCommentPlaceholder}
        data-copilotkit-ignore
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          focusField();
        }}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          // A click on a thumb removes or switches the rating, so closing must
          // not first save the draft as the answer to the rating it replaces.
          if (isOwnThumb(event.target)) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          const returnFocus = focusInside();
          // Escape in the comment closes only the comment, not a chat popup
          // around it; with focus elsewhere it also reaches that control.
          if (returnFocus) event.stopPropagation();
          comment.close({ save: false });
          if (returnFocus) comment.returnFocus(anchor.current);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const focusables = Array.from(
            contentRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
          );
          const leaving = event.shiftKey
            ? document.activeElement === focusables[0]
            : document.activeElement === focusables[focusables.length - 1];
          if (!leaving || !anchor.current?.isConnected) return;
          event.preventDefault();
          const target = event.shiftKey
            ? anchor.current
            : (nextFocusable(anchor.current, contentRef.current) ??
              anchor.current);
          comment.close();
          if (target === anchor.current) comment.returnFocus(target);
          else target.focus();
        }}
        onPointerEnter={() => comment.enter("pointer")}
        onPointerLeave={() => comment.leave("pointer")}
        className="cpk:z-[1300]"
      >
        {/* Keyed on the rating, so a new rating starts with a fresh field. */}
        <Fragment key={rating}>
          {renderSlot(
            feedbackComment,
            CopilotChatAssistantMessage.FeedbackComment,
            {
              value: comment.draft,
              savedComment,
              inputRef: comment.inputRef,
              onChange: comment.setDraft,
              onSubmit: () => {
                comment.close();
                comment.returnFocus(anchor.current);
              },
              onEditingChange: comment.setEditing,
              onLeave: (next) => {
                // Focus moving within the popover or to a thumb, which the
                // pointer is still on, does not close it.
                if (
                  next &&
                  (contentRef.current?.contains(next) || isOwnThumb(next))
                )
                  return;
                comment.leave();
              },
            },
          )}
        </Fragment>
      </PopoverContent>
    </Popover>
  );
}

export function CopilotChatAssistantMessage({
  message,
  messages,
  isRunning,
  isLatest,
  onThumbsUp,
  onThumbsDown,
  onReadAloud,
  onRegenerate,
  additionalToolbarItems,
  toolbarVisible = true,
  markdownRenderer,
  toolbar,
  copyButton,
  inspectorButton,
  thumbsUpButton,
  thumbsDownButton,
  readAloudButton,
  regenerateButton,
  feedbackComment: feedbackCommentSlot,
  toolCallsView,
  children,
  className,
  ...props
}: CopilotChatAssistantMessageProps) {
  useKatexStyles();
  const { isInspectorEnabled, openInspector } = useCopilotKitInspector();
  const shortcutsHidden = useInspectorShortcutsHidden();
  const showInspectorShortcut = isInspectorEnabled && !shortcutsHidden;
  // Set while this chat collects ratings for Learning: the thumbs record them.
  const feedback = useMessageFeedback(message);
  const comment = useFeedbackComment(feedback);
  const rating = feedback?.feedback?.rating;
  const root = useRef<HTMLDivElement>(null);
  // The chosen thumb the comment popover points at, and the rating the open
  // comment answers.
  const commentAnchor = useRef<HTMLElement | null>(null);
  const commentRating = useRef(rating);
  // A custom thumb that calls `onClick` without an event gives no element:
  // point at the chosen thumb once it renders, before the popover reads it.
  useLayoutEffect(() => {
    if (comment.open && !commentAnchor.current?.isConnected && rating)
      commentAnchor.current =
        root.current?.querySelector<HTMLElement>(
          `[data-copilotkit-rating="${rating}"]`,
        ) ??
        // A custom thumb that passes on only `aria-pressed`.
        root.current?.querySelector<HTMLElement>(
          'button[aria-pressed="true"]',
        ) ??
        null;
  });
  /**
   * Thumbs are toggles: a new rating is saved and opens its comment, and
   * clicking the chosen thumb again removes the rating. A keyboard click
   * (`detail` 0) moves focus into the comment, as there is no pointer.
   * Custom thumb slots may call `onClick` without an event.
   *
   * @returns Whether the app's handler should run: true for a new rating and
   * whenever this chat does not record ratings, false when one is removed.
   */
  const rate = (
    value: MessageFeedbackRating,
    event?: React.MouseEvent<HTMLButtonElement>,
  ): boolean => {
    if (!feedback) return true;
    if (rating === value) {
      comment.close({ save: false });
      feedback.clear();
      return false;
    }
    feedback.rate(value);
    commentRating.current = value;
    commentAnchor.current = event?.currentTarget ?? null;
    comment.show({ comment: "", focus: event?.detail === 0 });
    return true;
  };

  /** Props that let the chosen thumb open and point at its comment. */
  const thumbFeedbackProps = (value: MessageFeedbackRating) => {
    if (!feedback) return {};
    const thumb = { "data-copilotkit-rating": value };
    if (rating !== value) return { ...thumb, "aria-pressed": false };
    const enter = (target: HTMLElement, via: "pointer" | "focus") => {
      if (!comment.open) commentRating.current = value;
      commentAnchor.current = target;
      comment.enter(via);
    };
    return {
      ...thumb,
      "aria-pressed": true,
      "aria-haspopup": "dialog" as const,
      "aria-expanded": comment.open,
      onPointerEnter: (event: React.PointerEvent<HTMLButtonElement>) => {
        if (event.pointerType !== "touch")
          enter(event.currentTarget, "pointer");
      },
      onPointerLeave: (event: React.PointerEvent<HTMLButtonElement>) => {
        if (event.pointerType !== "touch") comment.leave("pointer");
      },
      // Keyboard focus opens the comment; Tab moves on into its field.
      onFocus: (event: React.FocusEvent<HTMLButtonElement>) => {
        if (isFocusVisible(event.currentTarget))
          enter(event.currentTarget, "focus");
      },
      onBlur: () => comment.leave(),
      onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
        const input = comment.inputRef.current;
        // Not while the popover hides because its thumb scrolled away.
        if (
          event.key === "Tab" &&
          !event.shiftKey &&
          comment.open &&
          input &&
          input.checkVisibility?.(HIDDEN_TOO) !== false
        ) {
          event.preventDefault();
          input.focus();
        }
      },
    };
  };

  const boundMarkdownRenderer = renderSlot(
    markdownRenderer,
    CopilotChatAssistantMessage.MarkdownRenderer,
    {
      content: message.content || "",
    },
  );

  const boundCopyButton = renderSlot(
    copyButton,
    CopilotChatAssistantMessage.CopyButton,
    {
      onClick: async () => {
        if (message.content) {
          return await copyToClipboard(message.content);
        }
        return false;
      },
    },
  );

  const boundThumbsUpButton = renderSlot(
    thumbsUpButton,
    CopilotChatAssistantMessage.ThumbsUpButton,
    {
      onClick:
        onThumbsUp || feedback
          ? (event?: React.MouseEvent<HTMLButtonElement>) => {
              // The app hears about a rating given, not about one removed.
              if (rate("up", event)) onThumbsUp?.(message);
            }
          : undefined,
      ...thumbFeedbackProps("up"),
    },
  );

  const boundInspectorButton = showInspectorShortcut ? (
    <BoundInspectorButton
      inspectorButton={inspectorButton}
      messageId={message.id}
      openInspector={openInspector}
    />
  ) : (
    <></>
  );

  const boundThumbsDownButton = renderSlot(
    thumbsDownButton,
    CopilotChatAssistantMessage.ThumbsDownButton,
    {
      onClick:
        onThumbsDown || feedback
          ? (event?: React.MouseEvent<HTMLButtonElement>) => {
              if (rate("down", event)) onThumbsDown?.(message);
            }
          : undefined,
      ...thumbFeedbackProps("down"),
    },
  );

  const boundReadAloudButton = renderSlot(
    readAloudButton,
    CopilotChatAssistantMessage.ReadAloudButton,
    {
      onClick: onReadAloud ? () => onReadAloud(message) : undefined,
    },
  );

  const boundRegenerateButton = renderSlot(
    regenerateButton,
    CopilotChatAssistantMessage.RegenerateButton,
    {
      onClick: onRegenerate ? () => onRegenerate(message) : undefined,
    },
  );

  const boundToolbar = renderSlot(
    toolbar,
    CopilotChatAssistantMessage.Toolbar,
    {
      children: (
        <div className="cpk:flex cpk:w-full cpk:items-center cpk:gap-1">
          {boundCopyButton}
          {(onThumbsUp || thumbsUpButton || feedback) && boundThumbsUpButton}
          {(onThumbsDown || thumbsDownButton || feedback) &&
            boundThumbsDownButton}
          {(onReadAloud || readAloudButton) && boundReadAloudButton}
          {(onRegenerate || regenerateButton) && boundRegenerateButton}
          {additionalToolbarItems}
          {showInspectorShortcut && boundInspectorButton}
        </div>
      ),
    },
  );

  const boundToolCallsView = renderSlot(
    toolCallsView,
    CopilotChatToolCallsView,
    {
      message,
      messages,
    },
  );

  // Don't show toolbar if message has no content (only tool calls)
  const hasContent = !!(message.content && message.content.trim().length > 0);
  const isLatestAssistantMessage =
    message.role === "assistant" &&
    (isLatest ?? messages?.[messages.length - 1]?.id === message.id);
  const shouldShowToolbar =
    toolbarVisible &&
    (hasContent || showInspectorShortcut) &&
    !(isRunning && isLatestAssistantMessage);
  // The popover shows only with the toolbar and a rating. Hiding the toolbar
  // keeps the edit; a rating removed elsewhere or Learning turned off ends it.
  const { open: commentOpen, close: closeComment } = comment;
  useEffect(() => {
    if (!commentOpen) return;
    // Changed or removed elsewhere: the draft answered the old rating.
    if (rating !== commentRating.current) closeComment({ save: false });
    else if (!shouldShowToolbar) closeComment();
  }, [commentOpen, shouldShowToolbar, rating, closeComment]);

  // Floats in a portal next to the chosen thumb, so it never moves the chat.
  const feedbackComment = feedback?.feedback && shouldShowToolbar && (
    <FeedbackCommentPopover
      feedbackComment={feedbackCommentSlot}
      comment={comment}
      savedComment={feedback.feedback.comment ?? ""}
      rating={feedback.feedback.rating}
      anchor={commentAnchor}
      messageId={message.id}
    />
  );

  if (children) {
    return (
      <div
        ref={root}
        data-copilotkit
        data-message-id={message.id}
        style={{ display: "contents" }}
      >
        {children({
          markdownRenderer: boundMarkdownRenderer,
          toolbar: boundToolbar,
          toolCallsView: boundToolCallsView,
          copyButton: boundCopyButton,
          inspectorButton: boundInspectorButton,
          thumbsUpButton: boundThumbsUpButton,
          thumbsDownButton: boundThumbsDownButton,
          readAloudButton: boundReadAloudButton,
          regenerateButton: boundRegenerateButton,
          message,
          messages,
          isRunning,
          onThumbsUp,
          onThumbsDown,
          onReadAloud,
          onRegenerate,
          additionalToolbarItems,
          toolbarVisible: shouldShowToolbar,
        })}
        {feedbackComment}
      </div>
    );
  }

  return (
    <div
      ref={root}
      data-copilotkit
      data-testid="copilot-assistant-message"
      className={twMerge(
        "copilotKitMessage copilotKitAssistantMessage",
        className,
      )}
      {...props}
      data-message-id={message.id}
    >
      <div className="cpk:prose cpk:max-w-full cpk:break-words cpk:dark:prose-invert">
        {boundMarkdownRenderer}
      </div>
      {boundToolCallsView}
      {shouldShowToolbar && boundToolbar}
      {feedbackComment}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace CopilotChatAssistantMessage {
  export const MarkdownRenderer: React.FC<
    Omit<React.ComponentProps<typeof Streamdown>, "children"> & {
      content: string;
    }
  > = ({ content, className, ...props }) => (
    <Streamdown className={className} {...props}>
      {content ?? ""}
    </Streamdown>
  );

  export const Toolbar: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
    className,
    ...props
  }) => (
    <div
      data-testid="copilot-assistant-toolbar"
      className={twMerge(
        "cpk:w-full cpk:bg-transparent cpk:flex cpk:items-center cpk:-ml-[5px] cpk:-mt-[0px]",
        className,
      )}
      {...props}
    />
  );

  export const ToolbarButton: React.FC<
    React.ButtonHTMLAttributes<HTMLButtonElement> & {
      title: string;
      tooltip?: React.ReactNode;
      tooltipClassName?: string;
      children: React.ReactNode;
    }
  > = ({ title, tooltip, tooltipClassName, children, ...props }) => {
    // Same element whether or not its popup is open, so pointer events stay
    // paired. The popup replaces the tooltip: an open tooltip closes, and a
    // request to open one while the popup shows is ignored, so the tooltip
    // does not reappear when the popup closes under a pointer that left.
    const [tooltipOpen, setTooltipOpen] = useState(false);
    const popupOpen = props["aria-expanded"] === true;
    if (popupOpen && tooltipOpen) setTooltipOpen(false);
    return (
      <Tooltip
        open={tooltipOpen && !popupOpen}
        onOpenChange={(open) => setTooltipOpen(open && !popupOpen)}
      >
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="assistantMessageToolbarButton"
            aria-label={title}
            {...props}
          >
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className={tooltipClassName}>
          {tooltip ?? <p>{title}</p>}
        </TooltipContent>
      </Tooltip>
    );
  };

  export const CopyButton: React.FC<
    React.ButtonHTMLAttributes<HTMLButtonElement>
  > = ({ className, title, onClick, ...props }) => {
    const config = useCopilotChatConfiguration();
    const labels = config?.labels ?? CopilotChatDefaultLabels;
    const [copied, setCopied] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
      return () => {
        if (timerRef.current !== null) {
          clearTimeout(timerRef.current);
        }
      };
    }, []);

    const handleClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
      let success = false;
      if (onClick) {
        // onClick may return a boolean indicating copy success
        const result: unknown = await Promise.resolve(onClick(event));
        success = result === true;
      }

      if (success) {
        setCopied(true);
        if (timerRef.current !== null) {
          clearTimeout(timerRef.current);
        }
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          setCopied(false);
        }, 2000);
      }
    };

    return (
      <ToolbarButton
        data-testid="copilot-copy-button"
        title={title || labels.assistantMessageToolbarCopyMessageLabel}
        onClick={handleClick}
        className={className}
        {...props}
      >
        {copied ? (
          <Check className="cpk:size-[18px]" />
        ) : (
          <Copy className="cpk:size-[18px]" />
        )}
      </ToolbarButton>
    );
  };

  export const InspectorButton: React.FC<
    React.ButtonHTMLAttributes<HTMLButtonElement>
  > = CopilotChatInspectorButton;

  export const ThumbsUpButton: React.FC<
    React.ButtonHTMLAttributes<HTMLButtonElement>
  > = ({ title, ...props }) => {
    const config = useCopilotChatConfiguration();
    const labels = config?.labels ?? CopilotChatDefaultLabels;
    return (
      <ToolbarButton
        data-testid="copilot-thumbs-up-button"
        title={title || labels.assistantMessageToolbarThumbsUpLabel}
        {...props}
      >
        <ThumbsUp
          className="cpk:size-[18px]"
          fill={props["aria-pressed"] === true ? "currentColor" : "none"}
        />
      </ToolbarButton>
    );
  };

  export const ThumbsDownButton: React.FC<
    React.ButtonHTMLAttributes<HTMLButtonElement>
  > = ({ title, ...props }) => {
    const config = useCopilotChatConfiguration();
    const labels = config?.labels ?? CopilotChatDefaultLabels;
    return (
      <ToolbarButton
        data-testid="copilot-thumbs-down-button"
        title={title || labels.assistantMessageToolbarThumbsDownLabel}
        {...props}
      >
        <ThumbsDown
          className="cpk:size-[18px]"
          fill={props["aria-pressed"] === true ? "currentColor" : "none"}
        />
      </ToolbarButton>
    );
  };

  /**
   * The comment field of a rating, shown in a popover next to the chosen
   * thumb. Enter saves; Send appears once the text differs from the saved
   * comment. The popover marks itself `data-copilotkit-ignore`, so Learning
   * records the saved comment but not the typing; outside it, mark the
   * field yourself.
   */
  export const FeedbackComment: React.FC<{
    value: string;
    /** The comment already saved. */
    savedComment: string;
    inputRef?: React.Ref<HTMLInputElement>;
    onChange: (value: string) => void;
    onSubmit: () => void;
    onEditingChange?: (editing: boolean) => void;
    /**
     * Focus left the form for `next`, or for no focusable element when null.
     * Not called when the window loses focus.
     */
    onLeave?: (next: Element | null) => void;
    className?: string;
  }> = ({
    value,
    savedComment,
    inputRef,
    onChange,
    onSubmit,
    onEditingChange,
    onLeave,
    className,
  }) => {
    const config = useCopilotChatConfiguration();
    const labels = config?.labels ?? CopilotChatDefaultLabels;
    const changed = value.trim() !== savedComment;

    return (
      <form
        data-testid="copilot-feedback-comment"
        className={twMerge(
          "cpk:flex cpk:w-80 cpk:max-w-[calc(100vw-1rem)] cpk:items-center cpk:gap-1 cpk:rounded-full cpk:border cpk:border-border cpk:bg-background cpk:py-0.5 cpk:pl-3 cpk:pr-0.5 cpk:text-sm cpk:shadow-md",
          className,
        )}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        onFocus={() => onEditingChange?.(true)}
        onBlur={(event) => {
          const next =
            event.relatedTarget instanceof Element ? event.relatedTarget : null;
          if (event.currentTarget.contains(next)) return;
          // Switching to another window is not leaving the comment.
          if (typeof document !== "undefined" && !document.hasFocus()) return;
          onEditingChange?.(false);
          onLeave?.(next);
        }}
      >
        <input
          ref={inputRef}
          value={value}
          maxLength={MESSAGE_FEEDBACK_MAX_COMMENT_LENGTH}
          onChange={(event) => onChange(event.target.value)}
          placeholder={labels.assistantMessageFeedbackCommentPlaceholder}
          aria-label={labels.assistantMessageFeedbackCommentPlaceholder}
          className="cpk:min-w-0 cpk:flex-1 cpk:bg-transparent cpk:py-1 cpk:text-foreground cpk:outline-none cpk:placeholder:text-muted-foreground"
        />
        {changed && (
          <Button
            type="submit"
            variant="assistantMessageToolbarButton"
            aria-label={labels.assistantMessageFeedbackCommentSubmitLabel}
            title={labels.assistantMessageFeedbackCommentSubmitLabel}
          >
            <ArrowUp className="cpk:size-[16px]" />
          </Button>
        )}
      </form>
    );
  };

  export const ReadAloudButton: React.FC<
    React.ButtonHTMLAttributes<HTMLButtonElement>
  > = ({ title, ...props }) => {
    const config = useCopilotChatConfiguration();
    const labels = config?.labels ?? CopilotChatDefaultLabels;
    return (
      <ToolbarButton
        data-testid="copilot-read-aloud-button"
        title={title || labels.assistantMessageToolbarReadAloudLabel}
        {...props}
      >
        <Volume2 className="cpk:size-[20px]" />
      </ToolbarButton>
    );
  };

  export const RegenerateButton: React.FC<
    React.ButtonHTMLAttributes<HTMLButtonElement>
  > = ({ title, ...props }) => {
    const config = useCopilotChatConfiguration();
    const labels = config?.labels ?? CopilotChatDefaultLabels;
    return (
      <ToolbarButton
        data-testid="copilot-regenerate-button"
        title={title || labels.assistantMessageToolbarRegenerateLabel}
        {...props}
      >
        <RefreshCw className="cpk:size-[18px]" />
      </ToolbarButton>
    );
  };
}

CopilotChatAssistantMessage.MarkdownRenderer.displayName =
  "CopilotChatAssistantMessage.MarkdownRenderer";
CopilotChatAssistantMessage.Toolbar.displayName =
  "CopilotChatAssistantMessage.Toolbar";
CopilotChatAssistantMessage.CopyButton.displayName =
  "CopilotChatAssistantMessage.CopyButton";
CopilotChatAssistantMessage.InspectorButton.displayName =
  "CopilotChatAssistantMessage.InspectorButton";
CopilotChatAssistantMessage.ThumbsUpButton.displayName =
  "CopilotChatAssistantMessage.ThumbsUpButton";
CopilotChatAssistantMessage.ThumbsDownButton.displayName =
  "CopilotChatAssistantMessage.ThumbsDownButton";
CopilotChatAssistantMessage.FeedbackComment.displayName =
  "CopilotChatAssistantMessage.FeedbackComment";
CopilotChatAssistantMessage.ReadAloudButton.displayName =
  "CopilotChatAssistantMessage.ReadAloudButton";
CopilotChatAssistantMessage.RegenerateButton.displayName =
  "CopilotChatAssistantMessage.RegenerateButton";

export default CopilotChatAssistantMessage;
