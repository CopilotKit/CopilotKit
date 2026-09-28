import { useMemo, useState } from "react";
import { Copy, Check, Edit, ChevronLeft, ChevronRight } from "lucide-react";
import {
  useCopilotChatConfiguration,
  CopilotChatDefaultLabels,
} from "../../providers/CopilotChatConfigurationProvider";
import { twMerge } from "tailwind-merge";
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
import type {
  ImageInputPart,
  AudioInputPart,
  VideoInputPart,
  DocumentInputPart,
} from "@copilotkit/shared";
import { CopilotChatAttachmentRenderer } from "./CopilotChatAttachmentRenderer";
import { Streamdown } from "streamdown";
import { prepareUserMarkdown } from "./user-markdown";

// Headings that slip past prepareUserMarkdown (e.g. setext underlines) render
// as plain paragraphs: a user message never grows article-sized headings.
const PlainParagraph = ({ children }: { children?: React.ReactNode }) => (
  <p>{children}</p>
);
const userMarkdownComponents = {
  h1: PlainParagraph,
  h2: PlainParagraph,
  h3: PlainParagraph,
  h4: PlainParagraph,
  h5: PlainParagraph,
  h6: PlainParagraph,
};

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
    /**
     * Render the message as markdown (code blocks, lists, links; headings stay
     * literal). Defaults to `true`; set `false` for the plain text as typed.
     */
    markdown?: boolean;
  } & React.HTMLAttributes<HTMLDivElement>
>;

export function CopilotChatUserMessage({
  message,
  onEditMessage,
  branchIndex,
  numberOfBranches,
  onSwitchToBranch,
  additionalToolbarItems,
  markdown = true,
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
      markdown,
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
      <div className="cpk:flex cpk:items-center cpk:gap-0.5 cpk:justify-end">
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
        "copilotKitMessage copilotKitUserMessage cpk:flex cpk:flex-col cpk:items-end cpk:group cpk:pt-8",
        className,
      )}
      data-message-id={message.id}
      {...props}
    >
      {mediaParts.length > 0 && (
        <div className="cpk:flex cpk:flex-row cpk:flex-wrap cpk:max-w-full cpk:justify-end cpk:gap-2 cpk:mb-2">
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
    /** Render as markdown (default) or as the plain text as typed. */
    markdown?: boolean;
    className?: string;
  }> = ({ content, markdown = true, className }) => (
    <div
      className={twMerge(
        "cpk:prose cpk:dark:prose-invert cpk:bg-muted cpk:text-foreground cpk:relative cpk:max-w-[80%] cpk:min-w-0 cpk:rounded-2xl cpk:px-4 cpk:py-2 cpk:inline-block cpk:break-words",
        !markdown && "cpk:whitespace-pre-wrap",
        className,
      )}
    >
      {markdown ? (
        // User text arrives complete, so render it statically. The key
        // remounts on edits: streamdown's elements memoize on source position,
        // so a same-length change would otherwise keep the old text.
        <Streamdown
          key={content}
          mode="static"
          parseIncompleteMarkdown={false}
          components={userMarkdownComponents}
        >
          {prepareUserMarkdown(content)}
        </Streamdown>
      ) : (
        content
      )}
    </div>
  );

  export const Toolbar: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
    className,
    ...props
  }) => (
    <div
      data-testid="copilot-user-toolbar"
      className={twMerge(
        "cpk:w-full cpk:bg-transparent cpk:flex cpk:items-center cpk:justify-end cpk:-mr-1 cpk:mt-1 cpk:opacity-0 cpk:transition-opacity cpk:duration-150 cpk:group-hover:opacity-100 cpk:focus-within:opacity-100",
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
        const result: unknown = await Promise.resolve(onClick(event));
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
          <Check className="cpk:size-4" />
        ) : (
          <Copy className="cpk:size-4" />
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
        <Edit className="cpk:size-4" />
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
        className={twMerge("cpk:flex cpk:items-center cpk:gap-0.5", className)}
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
          className="cpk:size-6 cpk:p-0"
        >
          <ChevronLeft className="cpk:size-4" />
        </Button>
        <span className="cpk:min-w-7 cpk:text-center cpk:text-xs cpk:tabular-nums cpk:text-muted-foreground cpk:font-medium">
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
          className="cpk:size-6 cpk:p-0"
        >
          <ChevronRight className="cpk:size-4" />
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
