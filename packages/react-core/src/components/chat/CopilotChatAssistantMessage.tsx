import type { AssistantMessage, Message } from "@ag-ui/core";
import React, {
  Fragment,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CopilotIcon } from "../icons/CopilotIcon";
import { CopilotChatDefaultLabels } from "@copilotkit/core";
import { useCopilotChatConfiguration } from "../../providers/CopilotChatConfigurationProvider";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../components/ui/tooltip";
import type { SlotValue, WithSlots } from "../../lib/slots";
import {
  renderSlot,
  isReactComponentType,
  useShallowStableRef,
} from "../../lib/slots";
import { StreamingMarkdownDefaultRenderer } from "./StreamingMarkdownDefaultRenderer";
import { useMarkdownRenderer } from "../../providers/MarkdownRendererContext";
import type {
  MarkdownRendererProps,
  DefaultMarkdownRendererProps,
  MarkdownRenderer as MarkdownRendererValue,
} from "../../providers/MarkdownRendererContext";
import { copyToClipboard } from "@copilotkit/shared";
import CopilotChatToolCallsView from "./CopilotChatToolCallsView";
import { Collapsible } from "./CopilotChatToolCallGroup";
import { ToolCallDisplayContext } from "./tool-call-display-context";
import { useCopilotKitInspector } from "../CopilotKitInspectorContext";
import {
  CopilotChatInspectorButton,
  useInspectorShortcutsHidden,
} from "./CopilotChatInspectorButton";
import type { CopilotKitInspectorOpenRequest } from "../CopilotKitInspectorContext";
import { useGenerativeUIRuntime } from "../../generative-ui/runtime-context";
import { MarkdownSurfaces } from "../../generative-ui/markdown/MarkdownSurfaces";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "../../components/ui/popover";
import { useFeedbackComment, useMessageFeedback } from "./message-feedback";
import type { FeedbackComment } from "./message-feedback";
import {
  ɵMESSAGE_FEEDBACK_MAX_COMMENT_LENGTH,
  ɵhasAssistantMessageText,
  ɵisOwnFeedbackThumb,
  ɵshouldShowAssistantToolbar,
} from "@copilotkit/core";
import { useCopyFeedback } from "./use-copy-feedback";
import type { ɵMessageFeedbackRating as MessageFeedbackRating } from "@copilotkit/core";

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

function resolveMarkdownRenderer(
  value: MarkdownRendererValue | undefined,
): React.FC<MarkdownRendererProps & DefaultMarkdownRendererProps> {
  if (!value) return CopilotChatAssistantMessage.MarkdownRenderer;
  if (isReactComponentType(value)) {
    // A provider-supplied component (escape hatch) renders with the bound
    // { content, isStreaming } props; wrap it so the resolved type matches the
    // slot's component type. createElement accepts function or class components.
    const ProvidedRenderer = value;
    const ProvidedMarkdownRenderer: React.FC<
      MarkdownRendererProps & DefaultMarkdownRendererProps
    > = (props) => React.createElement(ProvidedRenderer, props);
    return ProvidedMarkdownRenderer;
  }
  const config = value as DefaultMarkdownRendererProps;
  const ConfiguredRenderer: React.FC<
    MarkdownRendererProps & DefaultMarkdownRendererProps
  > = (props) => (
    // Provider config is the base; props (bound content/isStreaming plus any
    // per-message slot config merged in by renderSlot) override it, so a
    // per-message markdownRenderer wins over the provider per the documented
    // slot -> provider -> built-in resolution order.
    <CopilotChatAssistantMessage.MarkdownRenderer {...config} {...props} />
  );
  return ConfiguredRenderer;
}

/**
 * In the `"turn"` tool-call display, text in a reply's working phase was
 * narration: it fades to muted once a call follows it, and folds away with the
 * rest of the work when the reply is done. The wrapper is there for every
 * message in that display, so text that turns into narration keeps its node
 * (and its place) rather than remounting.
 */
function WorkText({
  messageId,
  children,
}: {
  messageId: string;
  children: React.ReactElement;
}) {
  const context = useContext(ToolCallDisplayContext);
  if (context?.display !== "turn") return children;
  const open = context.workTextOpen.get(messageId);
  return (
    <Collapsible
      open={open ?? true}
      className="cpk-assistant-message-work-text"
    >
      <div
        className="cpk-assistant-message-work-text-content"
        data-work-text={open === undefined ? "reply" : "narration"}
      >
        {children}
      </div>
    </Collapsible>
  );
}

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
  messageId,
}: {
  feedbackComment:
    | SlotValue<typeof CopilotChatAssistantMessage.FeedbackComment>
    | undefined;
  comment: FeedbackComment;
  savedComment: string;
  rating: MessageFeedbackRating;
  messageId: string;
}): React.ReactElement {
  const config = useCopilotChatConfiguration();
  const labels = config?.labels ?? CopilotChatDefaultLabels;
  const contentRef = useRef<HTMLDivElement>(null);
  // Radix reads the anchor through a ref. A new ref per anchor, so nothing
  // changes a ref during render.
  const anchor = useMemo(() => ({ current: comment.anchor }), [comment.anchor]);
  // A keyboard rating moves focus into the field, as the popover opens or,
  // when it was open already, as the field for the new rating renders.
  const { focusRequest, focusField } = comment;
  useEffect(() => focusField(), [focusRequest, focusField]);
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
          if (ɵisOwnFeedbackThumb(event.target, messageId))
            event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          // Escape in the comment closes only the comment, not a chat popup
          // around it; with focus elsewhere it also reaches that control.
          if (comment.popoverEscape(contentRef.current))
            event.stopPropagation();
        }}
        onKeyDown={(event) => comment.popoverKeyDown(event, contentRef.current)}
        onPointerEnter={() => comment.enter("pointer")}
        onPointerLeave={() => comment.leave("pointer")}
        className="cpk-assistant-message-feedback-popover"
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
              onSubmit: comment.submit,
              onEditingChange: comment.setEditing,
              onLeave: (next) =>
                comment.popoverFocusLeave(next, contentRef.current, messageId),
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
  // Stabilize the provider value so a shallow-equal inline config object (e.g.
  // `markdownRenderer={{ caret: true }}`) with a fresh identity on each provider
  // render doesn't churn resolveMarkdownRenderer's output and remount the
  // markdown subtree (which would throw away streaming parser state). This is a
  // shallow, key-by-key compare — configs whose values are themselves new
  // objects each render (e.g. an inline `nodeRenderers`) or an inline component
  // renderer still change identity, so define those outside render / memoize
  // them, exactly as you would any component prop. Mirrors how slot props are
  // stabilized via the same helper.
  const providerRenderer = useShallowStableRef(useMarkdownRenderer());
  const DefaultMarkdownRenderer = useMemo(
    () => resolveMarkdownRenderer(providerRenderer),
    [providerRenderer],
  );

  // Don't show toolbar if message has no content (only tool calls)
  const hasContent = ɵhasAssistantMessageText(message.content);
  const isLatestAssistantMessage =
    message.role === "assistant" &&
    (isLatest ?? messages?.[messages.length - 1]?.id === message.id);
  const { isInspectorEnabled, openInspector } = useCopilotKitInspector();
  const shortcutsHidden = useInspectorShortcutsHidden();
  const showInspectorShortcut = isInspectorEnabled && !shortcutsHidden;
  // Set while this chat collects ratings for Learning: the thumbs record them.
  const feedback = useMessageFeedback(message);
  const comment = useFeedbackComment(feedback);
  const root = useRef<HTMLDivElement>(null);
  // A custom thumb that calls `onClick` without an event gives no element:
  // point at the chosen thumb once it renders, before the popover reads it.
  useLayoutEffect(() => comment.findAnchor(root.current));
  /**
   * A thumb click. A keyboard click (`detail` 0) moves focus into the
   * comment; custom thumb slots may call `onClick` without an event.
   */
  const rate = (
    value: MessageFeedbackRating,
    event?: React.MouseEvent<HTMLButtonElement>,
  ) =>
    comment.rate(value, {
      target: event?.currentTarget ?? null,
      keyboard: event?.detail === 0,
    });

  /** Props that let the chosen thumb open and point at its comment. */
  const thumbFeedbackProps = (value: MessageFeedbackRating) => {
    const thumb = comment.thumb(value);
    if (!thumb) return {};
    const { handlers } = thumb;
    if (!handlers) return thumb.attributes;
    return {
      ...thumb.attributes,
      onPointerEnter: handlers.pointerEnter,
      onPointerLeave: handlers.pointerLeave,
      onFocus: handlers.focus,
      onBlur: handlers.blur,
      onKeyDown: handlers.keyDown,
    };
  };

  const boundMarkdownRenderer = renderSlot(
    markdownRenderer,
    DefaultMarkdownRenderer,
    {
      content: message.content || "",
      isStreaming: !!(isRunning && isLatestAssistantMessage),
      messageId: message.id,
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
        <div className="cpk-assistant-message-toolbar-items">
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

  const shouldShowToolbar = ɵshouldShowAssistantToolbar({
    toolbarVisible,
    hasContent,
    showInspectorShortcut,
    isRunning: !!isRunning,
    isLatest: isLatestAssistantMessage,
  });
  // The popover shows only with the toolbar and a rating. Hiding the toolbar
  // keeps the edit; a rating removed elsewhere or Learning turned off ends it.
  const rating = feedback?.feedback?.rating;
  const { open: commentOpen, sync: syncComment } = comment;
  useEffect(() => {
    // react-doctor-disable-next-line react-doctor/no-pass-data-to-parent -- syncs core's feedback controller, an external store, not a parent's state
    syncComment({ showsToolbar: shouldShowToolbar });
  }, [commentOpen, shouldShowToolbar, rating, syncComment]);

  // Floats in a portal next to the chosen thumb, so it never moves the chat.
  const feedbackComment = feedback?.feedback && shouldShowToolbar && (
    <FeedbackCommentPopover
      feedbackComment={feedbackCommentSlot}
      comment={comment}
      savedComment={feedback.feedback.comment ?? ""}
      rating={feedback.feedback.rating}
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
      className={cn("copilotKitMessage copilotKitAssistantMessage", className)}
      {...props}
      data-message-id={message.id}
    >
      <WorkText messageId={message.id}>
        <div className="cpk-markdown cpk-assistant-message-markdown">
          {boundMarkdownRenderer}
        </div>
      </WorkText>
      {boundToolCallsView}
      {shouldShowToolbar && boundToolbar}
      {feedbackComment}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace CopilotChatAssistantMessage {
  export const MarkdownRenderer: React.FC<
    MarkdownRendererProps &
      DefaultMarkdownRendererProps & {
        /** Id of the rendered message. The markdown transport finds its fences by it. */
        messageId?: string;
      }
  > = ({ content, isStreaming, className, messageId, ...config }) => {
    // With the markdown transport, ```a2ui fences render as surfaces. The
    // fences are found by the message id, so without one they stay code.
    const generativeUI = useGenerativeUIRuntime();
    if (generativeUI?.transport === "markdown" && messageId !== undefined) {
      return (
        <MarkdownSurfaces
          content={content ?? ""}
          messageId={messageId}
          isStreaming={isStreaming}
          className={className}
          {...config}
        />
      );
    }
    return (
      <StreamingMarkdownDefaultRenderer
        content={content ?? ""}
        isStreaming={isStreaming}
        className={className}
        {...config}
      />
    );
  };

  export const Toolbar: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
    className,
    ...props
  }) => (
    <div
      data-testid="copilot-assistant-toolbar"
      className={cn("cpk-assistant-message-toolbar", className)}
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
    const { copied, markCopied } = useCopyFeedback();

    const handleClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
      if (!onClick) return;
      // onClick may return a boolean indicating copy success
      const result: unknown = await Promise.resolve(onClick(event));
      if (result === true) markCopied();
    };

    return (
      <ToolbarButton
        data-testid="copilot-copy-button"
        title={title || labels.assistantMessageToolbarCopyMessageLabel}
        onClick={(event) => {
          void handleClick(event);
        }}
        className={className}
        {...props}
      >
        {copied ? (
          <CopilotIcon
            name="Check"
            className="cpk-assistant-message-toolbar-icon"
          />
        ) : (
          <CopilotIcon
            name="Copy"
            className="cpk-assistant-message-toolbar-icon"
          />
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
        <CopilotIcon
          name="ThumbsUp"
          className="cpk-assistant-message-toolbar-icon"
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
        <CopilotIcon
          name="ThumbsDown"
          className="cpk-assistant-message-toolbar-icon"
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
        className={cn("cpk-assistant-message-feedback-comment", className)}
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
          maxLength={ɵMESSAGE_FEEDBACK_MAX_COMMENT_LENGTH}
          onChange={(event) => onChange(event.target.value)}
          placeholder={labels.assistantMessageFeedbackCommentPlaceholder}
          aria-label={labels.assistantMessageFeedbackCommentPlaceholder}
          className="cpk-assistant-message-feedback-comment-input"
        />
        {changed && (
          <Button
            type="submit"
            variant="assistantMessageToolbarButton"
            aria-label={labels.assistantMessageFeedbackCommentSubmitLabel}
            title={labels.assistantMessageFeedbackCommentSubmitLabel}
          >
            <CopilotIcon
              name="ArrowUp"
              className="cpk-assistant-message-feedback-comment-submit-icon"
            />
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
        <CopilotIcon
          name="Volume2"
          className="cpk-assistant-message-read-aloud-icon"
        />
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
        <CopilotIcon
          name="RefreshCw"
          className="cpk-assistant-message-toolbar-icon"
        />
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
