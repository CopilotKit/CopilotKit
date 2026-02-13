import { ReasoningMessage, Message } from "@ag-ui/core";
import { useState, useEffect, useRef } from "react";
import { ChevronRight } from "lucide-react";
import { twMerge } from "tailwind-merge";
import { Streamdown } from "streamdown";
import { WithSlots, renderSlot } from "@/lib/slots";

export type CopilotChatReasoningMessageProps = WithSlots<
  {
    header: typeof CopilotChatReasoningMessage.Header;
    contentView: typeof CopilotChatReasoningMessage.Content;
    toggle: typeof CopilotChatReasoningMessage.Toggle;
  },
  {
    message: ReasoningMessage;
    messages?: Message[];
    isRunning?: boolean;
  } & React.HTMLAttributes<HTMLDivElement>
>;

/**
 * Formats an elapsed duration (in seconds) to a human-readable string.
 */
function formatDuration(seconds: number): string {
  if (seconds < 1) return "a few seconds";
  if (seconds < 60) return `${Math.round(seconds)} seconds`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (secs === 0) return `${mins} minute${mins > 1 ? "s" : ""}`;
  return `${mins}m ${secs}s`;
}

export function CopilotChatReasoningMessage({
  message,
  messages,
  isRunning,
  header,
  contentView,
  toggle,
  children,
  className,
  ...props
}: CopilotChatReasoningMessageProps) {
  const isLatest = messages?.[messages.length - 1]?.id === message.id;
  const isStreaming = !!(isRunning && isLatest);
  const hasContent = !!(message.content && message.content.length > 0);

  // Track elapsed time while streaming
  const startTimeRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (isStreaming && startTimeRef.current === null) {
      startTimeRef.current = Date.now();
    }

    if (!isStreaming && startTimeRef.current !== null) {
      // Final snapshot of elapsed time
      setElapsed((Date.now() - startTimeRef.current) / 1000);
      return;
    }

    if (!isStreaming) return;

    // Tick every second while streaming
    const timer = setInterval(() => {
      if (startTimeRef.current !== null) {
        setElapsed((Date.now() - startTimeRef.current) / 1000);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [isStreaming]);

  // Default to open while streaming, auto-collapse when streaming ends
  const [isOpen, setIsOpen] = useState(isStreaming);

  useEffect(() => {
    if (isStreaming) {
      setIsOpen(true);
    } else {
      // Auto-collapse when reasoning finishes
      setIsOpen(false);
    }
  }, [isStreaming]);

  const label = isStreaming
    ? "Thinking…"
    : `Thought for ${formatDuration(elapsed)}`;

  const boundHeader = renderSlot(header, CopilotChatReasoningMessage.Header, {
    isOpen,
    label,
    hasContent,
    isStreaming,
    onClick: hasContent ? () => setIsOpen((prev) => !prev) : undefined,
  });

  const boundContent = renderSlot(
    contentView,
    CopilotChatReasoningMessage.Content,
    {
      isStreaming,
      hasContent,
      children: message.content,
    },
  );

  const boundToggle = renderSlot(toggle, CopilotChatReasoningMessage.Toggle, {
    isOpen,
    children: boundContent,
  });

  if (children) {
    return (
      <>
        {children({
          header: boundHeader,
          contentView: boundContent,
          toggle: boundToggle,
          message,
          messages,
          isRunning,
        })}
      </>
    );
  }

  return (
    <div
      className={twMerge("my-1", className)}
      data-message-id={message.id}
      {...props}
    >
      {boundHeader}
      {boundToggle}
    </div>
  );
}

export namespace CopilotChatReasoningMessage {
  export const Header: React.FC<
    React.ButtonHTMLAttributes<HTMLButtonElement> & {
      isOpen?: boolean;
      label?: string;
      hasContent?: boolean;
      isStreaming?: boolean;
    }
  > = ({
    isOpen,
    label = "Thoughts",
    hasContent,
    isStreaming,
    className,
    children: headerChildren,
    ...headerProps
  }) => {
    const isExpandable = !!hasContent;

    return (
      <button
        type="button"
        className={twMerge(
          "inline-flex items-center gap-1 py-1 text-sm text-muted-foreground transition-colors select-none",
          isExpandable
            ? "hover:text-foreground cursor-pointer"
            : "cursor-default",
          className,
        )}
        aria-expanded={isExpandable ? isOpen : undefined}
        {...headerProps}
      >
        <span className="font-medium">{label}</span>
        {isStreaming && !hasContent && (
          <span className="inline-flex items-center ml-1">
            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-pulse" />
          </span>
        )}
        {headerChildren}
        {isExpandable && (
          <ChevronRight
            className={twMerge(
              "size-3.5 shrink-0 transition-transform duration-200",
              isOpen && "rotate-90",
            )}
          />
        )}
      </button>
    );
  };

  export const Content: React.FC<
    React.HTMLAttributes<HTMLDivElement> & {
      isStreaming?: boolean;
      hasContent?: boolean;
    }
  > = ({
    isStreaming,
    hasContent,
    className,
    children: contentChildren,
    ...contentProps
  }) => {
    // Don't render the content area at all when there's nothing to show
    if (!hasContent && !isStreaming) return null;

    return (
      <div className={twMerge("pb-2 pt-1", className)} {...contentProps}>
        <div className="text-sm text-muted-foreground">
          <Streamdown>
            {typeof contentChildren === "string" ? contentChildren : ""}
          </Streamdown>
          {isStreaming && hasContent && (
            <span className="inline-flex items-center ml-1 align-middle">
              <span className="w-2 h-2 rounded-full bg-muted-foreground animate-pulse-cursor" />
            </span>
          )}
        </div>
      </div>
    );
  };

  export const Toggle: React.FC<
    React.HTMLAttributes<HTMLDivElement> & {
      isOpen?: boolean;
    }
  > = ({ isOpen, className, children: toggleChildren, ...toggleProps }) => {
    return (
      <div
        className={twMerge(
          "grid transition-[grid-template-rows] duration-200 ease-in-out",
          className,
        )}
        style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
        {...toggleProps}
      >
        <div className="overflow-hidden">{toggleChildren}</div>
      </div>
    );
  };
}

CopilotChatReasoningMessage.Header.displayName =
  "CopilotChatReasoningMessage.Header";
CopilotChatReasoningMessage.Content.displayName =
  "CopilotChatReasoningMessage.Content";
CopilotChatReasoningMessage.Toggle.displayName =
  "CopilotChatReasoningMessage.Toggle";

export default CopilotChatReasoningMessage;
