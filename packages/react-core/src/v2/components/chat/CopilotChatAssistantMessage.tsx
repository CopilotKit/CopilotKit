import type { AssistantMessage, Message } from "@ag-ui/core";
import React, { useEffect, useMemo, useRef, useState } from "react";
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
import type { WithSlots } from "../../lib/slots";
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
    /**
     * Whether this is the last message the chat renders. The message view
     * passes it, because the rendered list can differ from `messages` when
     * `transformMessages` drops, replaces or reorders messages. Defaults to
     * comparing against the last entry of `messages`.
     */
    isLatest?: boolean;
    additionalToolbarItems?: React.ReactNode;
    toolbarVisible?: boolean;
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
  const hasContent = !!(message.content && message.content.trim().length > 0);
  const isLatestAssistantMessage =
    message.role === "assistant" &&
    (isLatest ?? messages?.[messages.length - 1]?.id === message.id);
  const { isInspectorEnabled, openInspector } = useCopilotKitInspector();
  const shortcutsHidden = useInspectorShortcutsHidden();
  const showInspectorShortcut = isInspectorEnabled && !shortcutsHidden;

  const boundMarkdownRenderer = renderSlot(
    markdownRenderer,
    DefaultMarkdownRenderer,
    {
      content: message.content || "",
      isStreaming: !!(isRunning && isLatestAssistantMessage),
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

  const shouldShowToolbar =
    toolbarVisible &&
    (hasContent || showInspectorShortcut) &&
    !(isRunning && isLatestAssistantMessage);

  if (children) {
    return (
      <div
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
      <div className="cpk:prose cpk:max-w-full cpk:break-words cpk:dark:prose-invert">
        {boundMarkdownRenderer}
      </div>
      {boundToolCallsView}
      {shouldShowToolbar && boundToolbar}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace CopilotChatAssistantMessage {
  export const MarkdownRenderer: React.FC<
    MarkdownRendererProps & DefaultMarkdownRendererProps
  > = ({ content, isStreaming, className, ...config }) => (
    <StreamingMarkdownDefaultRenderer
      content={content ?? ""}
      isStreaming={isStreaming}
      className={className}
      {...config}
    />
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
        <ThumbsUp className="cpk:size-[18px]" />
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
        <ThumbsDown className="cpk:size-[18px]" />
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
CopilotChatAssistantMessage.ReadAloudButton.displayName =
  "CopilotChatAssistantMessage.ReadAloudButton";
CopilotChatAssistantMessage.RegenerateButton.displayName =
  "CopilotChatAssistantMessage.RegenerateButton";

export default CopilotChatAssistantMessage;
