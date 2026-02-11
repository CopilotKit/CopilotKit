import { useMemo, useState } from "react";
import { Copy, Check, Edit, ChevronLeft, ChevronRight } from "lucide-react";
import {
  useCopilotChatConfiguration,
  CopilotChatDefaultLabels,
} from "@/providers/CopilotChatConfigurationProvider";
import { twMerge } from "tailwind-merge";
import { Button } from "@/components/ui/button";
import { UserMessage } from "@ag-ui/core";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { renderSlot, WithSlots } from "@/lib/slots";

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
      props: CopilotChatUserMessageOnSwitchToBranchProps
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
    [message.content]
  );

  const BoundMessageRenderer = renderSlot(
    messageRenderer,
    CopilotChatUserMessage.MessageRenderer,
    {
      content: flattenedContent,
    }
  );

  const BoundCopyButton = renderSlot(
    copyButton,
    CopilotChatUserMessage.CopyButton,
    {
      onClick: async () => {
        if (flattenedContent) {
          try {
            await navigator.clipboard.writeText(flattenedContent);
          } catch (err) {
            console.error("Failed to copy message:", err);
          }
        }
      },
    }
  );

  const BoundEditButton = renderSlot(
    editButton,
    CopilotChatUserMessage.EditButton,
    {
      onClick: () => onEditMessage?.({ message }),
    }
  );

  const BoundBranchNavigation = renderSlot(
    branchNavigation,
    CopilotChatUserMessage.BranchNavigation,
    {
      currentBranch: branchIndex,
      numberOfBranches,
      onSwitchToBranch,
      message,
    }
  );

  const showBranchNavigation =
    numberOfBranches && numberOfBranches > 1 && onSwitchToBranch;

  const BoundToolbar = renderSlot(toolbar, CopilotChatUserMessage.Toolbar, {
    children: (
      <div className="flex items-center gap-1 justify-end">
        {additionalToolbarItems}
        {BoundCopyButton}
        {onEditMessage && BoundEditButton}
        {showBranchNavigation && BoundBranchNavigation}
      </div>
    ),
  });

  if (children) {
    return (
      <>
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
      </>
    );
  }

  return (
    <div
      className={twMerge("flex flex-col items-end group pt-10", className)}
      data-message-id={message.id}
      {...props}
    >
      {BoundMessageRenderer}
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
      className={twMerge("flex flex-col items-end group", className)}
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
        "prose dark:prose-invert bg-muted relative max-w-[80%] rounded-[18px] px-4 py-1.5 data-[multiline]:py-3 inline-block whitespace-pre-wrap",
        className
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
      className={twMerge(
        "w-full bg-transparent flex items-center justify-end -mr-[5px] mt-[4px] invisible group-hover:visible",
        className
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

    const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);

      if (onClick) {
        onClick(event);
      }
    };

    return (
      <ToolbarButton
        title={title || labels.userMessageToolbarCopyMessageLabel}
        onClick={handleClick}
        className={className}
        {...props}
      >
        {copied ? (
          <Check className="size-[18px]" />
        ) : (
          <Copy className="size-[18px]" />
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
        title={title || labels.userMessageToolbarEditMessageLabel}
        className={className}
        {...props}
      >
        <Edit className="size-[18px]" />
      </ToolbarButton>
    );
  };

  export const BranchNavigation: React.FC<
    React.HTMLAttributes<HTMLDivElement> & {
      currentBranch?: number;
      numberOfBranches?: number;
      onSwitchToBranch?: (
        props: CopilotChatUserMessageOnSwitchToBranchProps
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
      <div className={twMerge("flex items-center gap-1", className)} {...props}>
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
          className="h-6 w-6 p-0"
        >
          <ChevronLeft className="size-[20px]" />
        </Button>
        <span className="text-sm text-muted-foreground px-0 font-medium">
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
          className="h-6 w-6 p-0"
        >
          <ChevronRight className="size-[20px]" />
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
