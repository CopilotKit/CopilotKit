import type { AssistantMessage, Message } from "@ag-ui/core";
import { useCallback, useEffect, useId, useRef, useState } from "react";
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
import { Streamdown } from "streamdown";
import { copyToClipboard } from "@copilotkit/shared";
import CopilotChatToolCallsView from "./CopilotChatToolCallsView";
import { useCopilotKitInspector } from "../CopilotKitInspectorContext";

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
  } & React.HTMLAttributes<HTMLDivElement>
>;

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
  const { isLocalInspectorEnabled, openInspector } = useCopilotKitInspector();
  const chatConfiguration = useCopilotChatConfiguration();

  const handleThumbsUp = useCallback(
    () => onThumbsUp?.(message),
    [message, onThumbsUp],
  );
  const handleThumbsDown = useCallback(
    () => onThumbsDown?.(message),
    [message, onThumbsDown],
  );

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
      onClick: onThumbsUp ? handleThumbsUp : undefined,
    },
  );

  const boundInspectorButton = renderSlot(
    inspectorButton,
    CopilotChatAssistantMessage.InspectorButton,
    {
      onClick: () =>
        openInspector({
          messageId: message.id,
          threadId: chatConfiguration?.threadId,
          agentId: chatConfiguration?.agentId,
        }),
    },
  );

  const boundThumbsDownButton = renderSlot(
    thumbsDownButton,
    CopilotChatAssistantMessage.ThumbsDownButton,
    {
      onClick: onThumbsDown ? handleThumbsDown : undefined,
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
        <div className="cpk:flex cpk:items-center cpk:gap-1">
          {boundCopyButton}
          {isLocalInspectorEnabled && boundInspectorButton}
          {(onThumbsUp || thumbsUpButton) && boundThumbsUpButton}
          {(onThumbsDown || thumbsDownButton) && boundThumbsDownButton}
          {(onReadAloud || readAloudButton) && boundReadAloudButton}
          {(onRegenerate || regenerateButton) && boundRegenerateButton}
          {additionalToolbarItems}
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
    messages?.[messages.length - 1]?.id === message.id;
  const shouldShowToolbar =
    toolbarVisible &&
    (hasContent || isLocalInspectorEnabled) &&
    !(isRunning && isLatestAssistantMessage);

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

function CopilotKitColoredIcon() {
  const gradientId = useId().replace(/:/g, "");

  return (
    <svg
      aria-hidden="true"
      className="cpk:size-5"
      data-testid="copilot-inspector-icon"
      viewBox="0 0 24 24"
    >
      <path
        d="M8.162 7.758c2.093-2.738 3.831-5.445 4.498-7.63a.093.093 0 01.14-.051c2.324 1.539 6.558 2.552 10.301 2.576a.09.09 0 01.085.124c-1.243 3.158-2.765 8.817-2.823 15.28-.001.095-.135.13-.183.046-2.131-3.729-8.955-8.968-11.982-10.205a.09.09 0 01-.036-.14z"
        fill={`url(#${gradientId}-purple)`}
      />
      <path
        d="M15.223 6.083A61.492 61.492 0 018.25 7.827c-.045.008-.055.071-.012.089 3.05 1.267 9.84 6.492 11.952 10.206a.017.017 0 00.022.007.018.018 0 00.01-.024l-4.999-12.02z"
        fill={`url(#${gradientId}-blue)`}
      />
      <path
        d="M12.81.07c2.8 1.528 6.037 2.214 10.33 2.575.028.002.036.039.012.051-.55.282-3.695 1.883-6.03 2.74-.626.23-1.256.443-1.876.64a.028.028 0 01-.033-.016L12.746.128c-.017-.04.027-.078.065-.058z"
        fill={`url(#${gradientId}-light-blue)`}
      />
      <path
        className="cpk:fill-[#513C9F] cpk:dark:fill-[#B99AE8]"
        d="M12.725.075c.046-.019.1.003.119.05l7.514 17.923a.091.091 0 01-.148.1l-.02-.03L12.675.195a.091.091 0 01.049-.12z"
      />
      <path
        className="cpk:fill-[#513C9F] cpk:dark:fill-[#B99AE8]"
        d="M23.06 2.66c.044-.025.1-.01.125.034.025.044.009.1-.035.124v.001l-.008.004-.025.015-.1.054a41.384 41.384 0 01-1.811.92A47.05 47.05 0 0116.33 5.82c-1.954.674-3.97 1.197-5.497 1.552a66.27 66.27 0 01-2.38.507l-.138.026-.036.007h-.01l-.002.002a.091.091 0 11-.033-.18l.016.09-.015-.09h.002l.01-.002.035-.007.137-.025a66.16 66.16 0 002.373-.506c1.524-.354 3.533-.876 5.479-1.547a46.857 46.857 0 006.276-2.709c.166-.087.295-.156.381-.204l.099-.054.024-.014.008-.004z"
      />
      <path
        className="cpk:fill-[#ABABAB] cpk:dark:fill-[#D4D4D4]"
        d="M13.838 2.272a.16.16 0 01.107.2l-2.72 9.055h6.4l.061.013a.16.16 0 010 .295l-.061.013h-6.541L.679 24.099l-.05.04a.16.16 0 01-.194-.245l10.43-12.285 2.773-9.23a.16.16 0 01.2-.107z"
      />
      <path
        d="M7.809 21.461l-1.232.173c.638 1.69 1.949 2.427 3.514 2.427 3.831 0 2.661-4.334 4.883-4.334 1.61 0 .956 3.513 4.423 3.513 2.116 0 2.326-2.131 1.966-3.048l-.008-.016-.567-.868c-.037-.058-.127-.036-.133.032l-.106 1.053a1.01 1.01 0 00.003.219c.088.727.144 2.491-1.155 2.491-1.37 0-1.7-3.467-4.423-3.467-3.196 0-2.785 4.289-4.747 4.289-1.294 0-2.28-1.46-2.418-2.464z"
        fill={`url(#${gradientId}-tail)`}
      />
      <defs>
        <linearGradient
          gradientUnits="userSpaceOnUse"
          id={`${gradientId}-purple`}
          x1="17.852"
          x2="14.202"
          y1="1.467"
          y2="11.504"
        >
          <stop className="cpk:[stop-color:#6430AB] cpk:dark:[stop-color:#B792F0]" />
          <stop
            className="cpk:[stop-color:#AA89D8] cpk:dark:[stop-color:#D3BDF7]"
            offset="1"
          />
        </linearGradient>
        <linearGradient
          gradientUnits="userSpaceOnUse"
          id={`${gradientId}-blue`}
          x1="15.024"
          x2="10.324"
          y1="7.125"
          y2="16.204"
        >
          <stop className="cpk:[stop-color:#005DBB] cpk:dark:[stop-color:#4D9FEF]" />
          <stop
            className="cpk:[stop-color:#3D92E8] cpk:dark:[stop-color:#84C0FA]"
            offset="1"
          />
        </linearGradient>
        <linearGradient
          gradientUnits="userSpaceOnUse"
          id={`${gradientId}-light-blue`}
          x1="17.122"
          x2="15.707"
          y1="1.467"
          y2="5.892"
        >
          <stop className="cpk:[stop-color:#1B70C4] cpk:dark:[stop-color:#61ACF2]" />
          <stop
            className="cpk:[stop-color:#54A4F2] cpk:dark:[stop-color:#9ACDFF]"
            offset="1"
          />
        </linearGradient>
        <linearGradient
          gradientUnits="userSpaceOnUse"
          id={`${gradientId}-tail`}
          x1="6.577"
          x2="21.506"
          y1="21.758"
          y2="21.758"
        >
          <stop className="cpk:[stop-color:#4497EA] cpk:dark:[stop-color:#79BCF5]" />
          <stop
            className="cpk:[stop-color:#1463B2] cpk:dark:[stop-color:#4594D8]"
            offset=".255"
          />
          <stop
            className="cpk:[stop-color:#0A437D] cpk:dark:[stop-color:#347CB7]"
            offset=".499"
          />
          <stop
            className="cpk:[stop-color:#2476C8] cpk:dark:[stop-color:#58A4E5]"
            offset=".667"
          />
          <stop
            className="cpk:[stop-color:#0C549A] cpk:dark:[stop-color:#3C87C7]"
            offset=".973"
          />
        </linearGradient>
      </defs>
    </svg>
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
  > = ({ title, className, ...props }) => {
    const config = useCopilotChatConfiguration();
    const labels = config?.labels ?? CopilotChatDefaultLabels;
    const primaryLabel = title || labels.assistantMessageToolbarInspectorLabel;
    const accessibleLabel = `${primaryLabel} (local only)`;
    return (
      <ToolbarButton
        data-testid="copilot-inspector-button"
        title={accessibleLabel}
        className={twMerge("cpk:w-auto cpk:gap-1.5 cpk:px-2", className)}
        tooltipClassName="cpk:max-w-64 cpk:text-left cpk:leading-4"
        tooltip="View this message in the Inspector to get more information. This button and the inspector only display during local development (localhost, dev env)."
        {...props}
      >
        <CopilotKitColoredIcon />
        <span className="cpk:font-medium">{primaryLabel}</span>
        <span className="cpk:text-xs cpk:text-muted-foreground">
          (local only)
        </span>
      </ToolbarButton>
    );
  };

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
