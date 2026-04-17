import { useMemo, useState } from "react";
import { Copy, Check, Edit, ChevronLeft, ChevronRight } from "lucide-react";
import {
  useCopilotChatConfiguration,
  CopilotChatDefaultLabels,
} from "../../providers/CopilotChatConfigurationProvider";
import { twMerge } from "tailwind-merge";
import { Button } from "../../components/ui/button";
import { UserMessage } from "@ag-ui/core";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../components/ui/tooltip";
import { renderSlot, WithSlots } from "../../lib/slots";
import {
  type ImageInputPart,
  type AudioInputPart,
  type VideoInputPart,
  type DocumentInputPart,
  copyToClipboard,
} from "@copilotkit/shared";
import { CopilotChatAttachmentRenderer } from "./CopilotChatAttachmentRenderer";

function flattenUserMessageContent(content?: UserMessage["content"]): string {
  if (!content) {
    return "";
  }

  if (typeof content === "string") {
    return content;
  }

  return content
    .map((part) => {
      if (
        part &&
        typeof part === "object" &&
        "type" in part &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        return (part as { text: string }).text;
      }
      return "";
    })
    .filter((text) => text.length > 0)
    .join("\n");
}

type MediaPart =
  | ImageInputPart
  | AudioInputPart
  | VideoInputPart
  | DocumentInputPart;

function getMediaParts(content: UserMessage["content"]): MediaPart[] {
  if (!content || typeof content === "string") return [];
  return content.filter(
    (part): part is MediaPart =>
      part.type === "image" ||
      part.type === "audio" ||
      part.type === "video" ||
      part.type === "document",
  );
}

function getFilename(part: MediaPart): string | undefined {
  const meta = part.metadata;
  if (
    meta != null &&
    typeof meta === "object" &&
    "filename" in meta &&
    typeof meta.filename === "string"
  ) {
    return meta.filename;
  }
  return undefined;
}

export interface CopilotChatUserMessageOnEditMessageProps {
  message: UserMessage;
}

export interface CopilotChatUserMessageOnSwitchToBranchProps {
  message: UserMessage;
  branchIndex: number;
  numberOfBranches: number;
}

export type CopilotChatUserMessageProps = WithSlots<
  {
    messageRenderer: typeof CopilotChatUserMessage.MessageRenderer;
    toolbar: typeof CopilotChatUserMessage.Toolbar;
    copyButton: typeof CopilotChatUserMessage.CopyButton;
    editButton: typeof CopilotChatUserMessage.EditButton;
    branchNavigation: typeof CopilotChatUserMessage.BranchNavigation;
  },
  {
    onEditMessage?: (props: CopilotChatUserMessageOnEditMessageProps) => void;
    onSwitchToBranch?: (
      props: CopilotChatUserMessageOnSwitchToBranchProps,
    ) => void;
    message: UserMessage;
    branchIndex?: number;
    numberOfBranches?: number;
    additionalToolbarItems?: React.ReactNode;
  } & React.HTMLAttributes<HTMLDivElement>
>;

export function CopilotChatUserMessage({
  message,
  onEditMessage,
  branchIndex,
  numberOfBranches,
  onSwitchToBranch,
  additionalToolbarItems,
  messageRenderer,
  toolbar,
  copyButton,
  editButton,
  branchNavigation,
  children,
  className,
  ...props
}: CopilotChatUserMessageProps) {
  const flattenedContent = useMemo(
    () => flattenUserMessageContent(message.content),
    [message.content],
  );

  const mediaParts = useMemo(
    () => getMediaParts(message.content),
    [message.content],
  );

  const BoundMessageRenderer = renderSlot(
    messageRenderer,
    CopilotChatUserMessage.MessageRenderer,
    {
      content: flattenedContent,
    },
  );

  const BoundCopyButton = renderSlot(
    copyButton,
    CopilotChatUserMessage.CopyButton,
    {
      onClick: async () => {
        if (flattenedContent) {
          return await copyToClipboard(flattenedContent);
        }
        return false;
      },
    },
  );

  const BoundEditButton = renderSlot(
    editButton,
    CopilotChatUserMessage.EditButton,
    {
      onClick: () => onEditMessage?.({ message }),
    },
  );

  const BoundBranchNavigation = renderSlot(
    branchNavigation,
    CopilotChatUserMessage.BranchNavigation,
    {
      currentBranch: branchIndex,
      numberOfBranches,
      onSwitchToBranch,
      message,
    },
  );

  const showBranchNavigation =
    numberOfBranches && numberOfBranches > 1 && onSwitchToBranch;

  const BoundToolbar = renderSlot(toolbar, CopilotChatUserMessage.Toolbar, {
    children: (
      <div className="cpk:flex cpk:items-center cpk:gap-1 cpk:justify-end">
        {additionalToolbarItems}
        {BoundCopyButton}
        {onEditMessage && BoundEditButton}
        {showBranchNavigation && BoundBranchNavigation}
      </div>
    ),
  });

  if (children) {
    return (
      <div data-copilotkit style={{ display: "contents" }}>
        {children({
          messageRenderer: BoundMessageRenderer,
          toolbar: BoundToolbar,
          copyButton: BoundCopyButton,
          editButton: BoundEditButton,
          branchNavigation: BoundBranchNavigation,
          message,
          branchIndex,
          numberOfBranches,
          additionalToolbarItems,
        })}
      </div>
    );
  }

  return (
    <div
      data-copilotkit
      data-testid="copilot-user-message"
      className={twMerge(
        "copilotKitMessage copilotKitUserMessage cpk:flex cpk:flex-col cpk:items-end cpk:group cpk:pt-10",
        className,
      )}
      data-message-id={message.id}
      {...props}
    >
      {BoundMessageRenderer}
      {mediaParts.length > 0 && (
        <div className="cpk:flex cpk:flex-col cpk:items-end cpk:gap-2 cpk:mt-2">
          {mediaParts.map((part, index) => (
            <CopilotChatAttachmentRenderer
              key={index}
              type={part.type}
              source={part.source}
              filename={getFilename(part)}
            />
          ))}
        </div>
      )}
      {BoundToolbar}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace CopilotChatUserMessage {
  export const Container: React.FC<
    React.PropsWithChildren<React.HTMLAttributes<HTMLDivElement>>
  > = ({ children, className, ...props }) => (
    <div
      className={twMerge(
        "cpk:flex cpk:flex-col cpk:items-end cpk:group",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );

  export const MessageRenderer: React.FC<{
    content: string;
    className?: string;
  }> = ({ content, className }) => (
    <div
      className={twMerge(
        "cpk:prose cpk:dark:prose-invert cpk:bg-muted cpk:relative cpk:max-w-[80%] cpk:rounded-[18px] cpk:px-4 cpk:py-1.5 cpk:data-[multiline]:py-3 cpk:inline-block cpk:whitespace-pre-wrap",
        className,
      )}
    >
      {content}
    </div>
  );

  export const Toolbar: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
    className,
    ...props
  }) => (
    <div
      data-testid="copilot-user-toolbar"
      className={twMerge(
        "cpk:w-full cpk:bg-transparent cpk:flex cpk:items-center cpk:justify-end cpk:-mr-[5px] cpk:mt-[4px] cpk:invisible cpk:group-hover:visible",
        className,
      )}
      {...props}
    />
  );

  export const ToolbarButton: React.FC<
    React.ButtonHTMLAttributes<HTMLButtonElement> & {
      title: string;
      children: React.ReactNode;
    }
  > = ({ title, children, className, ...props }) => {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="assistantMessageToolbarButton"
            aria-label={title}
            className={twMerge(className)}
            {...props}
          >
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{title}</p>
        </TooltipContent>
      </Tooltip>
    );
  };

  export const CopyButton: React.FC<
    React.ButtonHTMLAttributes<HTMLButtonElement> & { copied?: boolean }
  > = ({ className, title, onClick, ...props }) => {
    const config = useCopilotChatConfiguration();
    const labels = config?.labels ?? CopilotChatDefaultLabels;
    const [copied, setCopied] = useState(false);

    const handleClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
      let success = false;
      if (onClick) {
        // onClick may return a boolean indicating copy success
        const result = await Promise.resolve(onClick(event));
        success = result === true;
      }

      if (success) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    };

    return (
      <ToolbarButton
        data-testid="copilot-user-copy-button"
        title={title || labels.userMessageToolbarCopyMessageLabel}
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

  export const EditButton: React.FC<
    React.ButtonHTMLAttributes<HTMLButtonElement>
  > = ({ className, title, ...props }) => {
    const config = useCopilotChatConfiguration();
    const labels = config?.labels ?? CopilotChatDefaultLabels;
    return (
      <ToolbarButton
        data-testid="copilot-edit-button"
        title={title || labels.userMessageToolbarEditMessageLabel}
        className={className}
        {...props}
      >
        <Edit className="cpk:size-[18px]" />
      </ToolbarButton>
    );
  };

  export const BranchNavigation: React.FC<
    React.HTMLAttributes<HTMLDivElement> & {
      currentBranch?: number;
      numberOfBranches?: number;
      onSwitchToBranch?: (
        props: CopilotChatUserMessageOnSwitchToBranchProps,
      ) => void;
      message: UserMessage;
    }
  > = ({
    className,
    currentBranch = 0,
    numberOfBranches = 1,
    onSwitchToBranch,
    message,
    ...props
  }) => {
    if (!numberOfBranches || numberOfBranches <= 1 || !onSwitchToBranch) {
      return null;
    }

    const canGoPrev = currentBranch > 0;
    const canGoNext = currentBranch < numberOfBranches - 1;

    return (
      <div
        data-testid="copilot-branch-navigation"
        className={twMerge("cpk:flex cpk:items-center cpk:gap-1", className)}
        {...props}
      >
        <Button
          type="button"
          variant="assistantMessageToolbarButton"
          onClick={() =>
            onSwitchToBranch?.({
              branchIndex: currentBranch - 1,
              numberOfBranches,
              message,
            })
          }
          disabled={!canGoPrev}
          className="cpk:h-6 cpk:w-6 cpk:p-0"
        >
          <ChevronLeft className="cpk:size-[20px]" />
        </Button>
        <span className="cpk:text-sm cpk:text-muted-foreground cpk:px-0 cpk:font-medium">
          {currentBranch + 1}/{numberOfBranches}
        </span>
        <Button
          type="button"
          variant="assistantMessageToolbarButton"
          onClick={() =>
            onSwitchToBranch?.({
              branchIndex: currentBranch + 1,
              numberOfBranches,
              message,
            })
          }
          disabled={!canGoNext}
          className="cpk:h-6 cpk:w-6 cpk:p-0"
        >
          <ChevronRight className="cpk:size-[20px]" />
        </Button>
      </div>
    );
  };
}

CopilotChatUserMessage.Container.displayName =
  "CopilotChatUserMessage.Container";
CopilotChatUserMessage.MessageRenderer.displayName =
  "CopilotChatUserMessage.MessageRenderer";
CopilotChatUserMessage.Toolbar.displayName = "CopilotChatUserMessage.Toolbar";
CopilotChatUserMessage.ToolbarButton.displayName =
  "CopilotChatUserMessage.ToolbarButton";
CopilotChatUserMessage.CopyButton.displayName =
  "CopilotChatUserMessage.CopyButton";
CopilotChatUserMessage.EditButton.displayName =
  "CopilotChatUserMessage.EditButton";
CopilotChatUserMessage.BranchNavigation.displayName =
  "CopilotChatUserMessage.BranchNavigation";

export default CopilotChatUserMessage;
