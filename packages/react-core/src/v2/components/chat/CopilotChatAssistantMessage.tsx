import type { AssistantMessage, Message } from "@ag-ui/core";
import { useEffect, useRef, useState } from "react";
import {
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
import type { WithSlots } from "../../lib/slots";
import { renderSlot } from "../../lib/slots";
import { Streamdown, defaultRehypePlugins } from "streamdown";
import { copyToClipboard } from "@copilotkit/shared";
import CopilotChatToolCallsView from "./CopilotChatToolCallsView";
import { getAssistantTurn } from "./assistant-turn";
import { rehypeCursorAnchor } from "./streaming-cursor";
import { useCopilotKitInspector } from "../CopilotKitInspectorContext";
import {
  CopilotChatInspectorButton,
  useInspectorShortcutsHidden,
} from "./CopilotChatInspectorButton";
import type { CopilotKitInspectorOpenRequest } from "../CopilotKitInspectorContext";

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
    additionalToolbarItems?: React.ReactNode;
    toolbarVisible?: boolean;
    /**
     * Where the toolbar (copy, feedback, regenerate…) appears.
     *
     * - `"turn"` (default): one toolbar per reply. When a single user message
     *   produces several assistant messages, only the last one shows the
     *   toolbar, and copy / read aloud cover the whole reply.
     * - `"message"`: every assistant message gets its own toolbar.
     *
     * Needs `messages` to find the reply; without it every message is its own turn.
     */
    toolbarScope?: "turn" | "message";
    /**
     * Shows a pulsing cursor at the end of the text while it's being written.
     * `CopilotChatMessageView` sets this on the reply that's streaming.
     */
    showCursor?: boolean;
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

export function CopilotChatAssistantMessage({
  message,
  messages,
  isRunning,
  onThumbsUp,
  onThumbsDown,
  onReadAloud,
  onRegenerate,
  additionalToolbarItems,
  toolbarVisible = true,
  toolbarScope = "turn",
  showCursor = false,
  markdownRenderer,
  toolbar,
  copyButton,
  inspectorButton,
  thumbsUpButton,
  thumbsDownButton,
  readAloudButton,
  regenerateButton,
  toolCallsView,
  children,
  className,
  ...props
}: CopilotChatAssistantMessageProps) {
  useKatexStyles();
  const { isInspectorEnabled, openInspector } = useCopilotKitInspector();
  const shortcutsHidden = useInspectorShortcutsHidden();
  const showInspectorShortcut = isInspectorEnabled && !shortcutsHidden;

  const turn =
    toolbarScope === "turn" && messages
      ? getAssistantTurn(messages, message.id)
      : undefined;
  // What copy / read aloud act on: the whole reply in turn scope.
  const replyContent = turn ? turn.content : message.content || "";

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
        if (replyContent) {
          return await copyToClipboard(replyContent);
        }
        return false;
      },
    },
  );

  const boundThumbsUpButton = renderSlot(
    thumbsUpButton,
    CopilotChatAssistantMessage.ThumbsUpButton,
    {
      onClick: onThumbsUp ? () => onThumbsUp(message) : undefined,
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
      onClick: onThumbsDown ? () => onThumbsDown(message) : undefined,
    },
  );

  const boundReadAloudButton = renderSlot(
    readAloudButton,
    CopilotChatAssistantMessage.ReadAloudButton,
    {
      onClick: onReadAloud
        ? () => onReadAloud({ ...message, content: replyContent })
        : undefined,
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
        <div className="cpk:flex cpk:w-full cpk:items-center cpk:gap-0.5">
          {boundCopyButton}
          {(onThumbsUp || thumbsUpButton) && boundThumbsUpButton}
          {(onThumbsDown || thumbsDownButton) && boundThumbsDownButton}
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

  // Don't show toolbar if the reply has no text (only tool calls)
  const hasContent = replyContent.trim().length > 0;
  const isLatestAssistantMessage =
    message.role === "assistant" &&
    messages?.[messages.length - 1]?.id === message.id;
  // In turn scope only the reply's last message carries the toolbar, and it
  // stays hidden while that reply is still being produced.
  const ownsToolbar = !turn || turn.lastMessageId === message.id;
  const isReplyInProgress = turn ? turn.isLatest : isLatestAssistantMessage;
  const shouldShowToolbar =
    toolbarVisible &&
    ownsToolbar &&
    (hasContent || showInspectorShortcut) &&
    !(isRunning && isReplyInProgress);

  if (children) {
    return (
      <div data-copilotkit style={{ display: "contents" }}>
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
          showCursor,
        })}
      </div>
    );
  }

  return (
    <div
      data-copilotkit
      data-testid="copilot-assistant-message"
      className={twMerge(
        "copilotKitMessage copilotKitAssistantMessage",
        className,
      )}
      {...props}
      data-message-id={message.id}
    >
      <div
        className="cpk:prose cpk:max-w-full cpk:break-words cpk:text-foreground cpk:dark:prose-invert"
        data-streaming-cursor={showCursor ? "" : undefined}
      >
        {boundMarkdownRenderer}
      </div>
      {boundToolCallsView}
      {shouldShowToolbar && boundToolbar}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace CopilotChatAssistantMessage {
  // Streamdown's plugins plus the streaming cursor's anchor.
  const rehypePlugins = [
    ...Object.values(defaultRehypePlugins),
    rehypeCursorAnchor,
  ];

  export const MarkdownRenderer: React.FC<
    Omit<React.ComponentProps<typeof Streamdown>, "children"> & {
      content: string;
    }
  > = ({ content, className, ...props }) => (
    <Streamdown className={className} rehypePlugins={rehypePlugins} {...props}>
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
        "cpk:w-full cpk:bg-transparent cpk:flex cpk:items-center cpk:-ml-1 cpk:mt-2",
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
    return (
      <Tooltip>
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
          <Check className="cpk:size-4" />
        ) : (
          <Copy className="cpk:size-4" />
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
        <ThumbsUp className="cpk:size-4" />
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
        <ThumbsDown className="cpk:size-4" />
      </ToolbarButton>
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
        <Volume2 className="cpk:size-4" />
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
        <RefreshCw className="cpk:size-4" />
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
CopilotChatAssistantMessage.ReadAloudButton.displayName =
  "CopilotChatAssistantMessage.ReadAloudButton";
CopilotChatAssistantMessage.RegenerateButton.displayName =
  "CopilotChatAssistantMessage.RegenerateButton";

export default CopilotChatAssistantMessage;
