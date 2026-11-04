import { useMemo } from "react";
import { CopilotIcon } from "../icons/CopilotIcon";
import {
  CopilotChatDefaultLabels,
  ɵflattenUserMessageContent,
  ɵgetBranchNavState,
  ɵgetUserMessageMediaFilename,
  ɵgetUserMessageMediaParts,
} from "@copilotkit/core";
import { useCopilotChatConfiguration } from "../../providers/CopilotChatConfigurationProvider";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import type { UserMessage } from "@ag-ui/core";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../components/ui/tooltip";
import type { WithSlots } from "../../lib/slots";
import { renderSlot } from "../../lib/slots";
import { copyToClipboard } from "@copilotkit/shared";
import { CopilotChatAttachmentRenderer } from "./CopilotChatAttachmentRenderer";
import { useCopyFeedback } from "./use-copy-feedback";

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
    () => ɵflattenUserMessageContent(message.content),
    [message.content],
  );

  const mediaParts = useMemo(
    () => ɵgetUserMessageMediaParts(message.content),
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

  const { show: showBranchNavigation } = ɵgetBranchNavState({
    branchIndex: branchIndex ?? 0,
    numberOfBranches: numberOfBranches ?? 1,
    canSwitch: onSwitchToBranch !== undefined,
  });

  const BoundToolbar = renderSlot(toolbar, CopilotChatUserMessage.Toolbar, {
    children: (
      <div className="cpk-user-message-toolbar-items">
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
      className={cn(
        "copilotKitMessage copilotKitUserMessage cpk-user-message",
        className,
      )}
      data-message-id={message.id}
      {...props}
    >
      {mediaParts.length > 0 && (
        <div className="cpk-user-message-attachments">
          {mediaParts.map((part, index) => (
            <CopilotChatAttachmentRenderer
              key={index}
              type={part.type}
              source={part.source}
              filename={ɵgetUserMessageMediaFilename(part)}
            />
          ))}
        </div>
      )}
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
    <div className={cn("cpk-user-message-container", className)} {...props}>
      {children}
    </div>
  );

  export const MessageRenderer: React.FC<{
    content: string;
    className?: string;
  }> = ({ content, className }) => (
    <div className={cn("cpk-user-message-bubble", className)}>{content}</div>
  );

  export const Toolbar: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
    className,
    ...props
  }) => (
    <div
      data-testid="copilot-user-toolbar"
      className={cn("cpk-user-message-toolbar", className)}
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
            className={className}
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
    const { copied, markCopied } = useCopyFeedback();

    const handleClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
      if (!onClick) return;
      // onClick may return a boolean indicating copy success
      const result: unknown = await Promise.resolve(onClick(event));
      if (result === true) markCopied();
    };

    return (
      <ToolbarButton
        data-testid="copilot-user-copy-button"
        title={title || labels.userMessageToolbarCopyMessageLabel}
        onClick={(event) => {
          void handleClick(event);
        }}
        className={className}
        {...props}
      >
        {copied ? (
          <CopilotIcon name="Check" className="cpk-user-message-toolbar-icon" />
        ) : (
          <CopilotIcon name="Copy" className="cpk-user-message-toolbar-icon" />
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
        <CopilotIcon name="Edit" className="cpk-user-message-toolbar-icon" />
      </ToolbarButton>
    );
  };

  /**
   * Previous/next buttons and an "n/m" counter for switching between branches
   * of a user message. Renders only with more than one branch and an
   * `onSwitchToBranch` handler. The buttons are named by
   * `labels.userMessageToolbarPreviousBranchLabel` and
   * `labels.userMessageToolbarNextBranchLabel`.
   */
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
    const config = useCopilotChatConfiguration();
    const labels = config?.labels ?? CopilotChatDefaultLabels;

    const { show, canGoPrev, canGoNext } = ɵgetBranchNavState({
      branchIndex: currentBranch,
      numberOfBranches,
      canSwitch: onSwitchToBranch !== undefined,
    });
    if (!show) return null;

    return (
      <div
        data-testid="copilot-branch-navigation"
        className={cn("cpk-user-message-branch-navigation", className)}
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
          className="cpk-user-message-branch-button"
          aria-label={labels.userMessageToolbarPreviousBranchLabel}
        >
          <CopilotIcon
            name="ChevronLeft"
            className="cpk-user-message-branch-icon"
          />
        </Button>
        <span className="cpk-user-message-branch-counter">
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
          className="cpk-user-message-branch-button"
          aria-label={labels.userMessageToolbarNextBranchLabel}
        >
          <CopilotIcon
            name="ChevronRight"
            className="cpk-user-message-branch-icon"
          />
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
