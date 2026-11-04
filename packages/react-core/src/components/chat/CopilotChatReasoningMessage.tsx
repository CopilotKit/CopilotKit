import type { ReasoningMessage, Message } from "@ag-ui/core";
import { useEffect, useState, useSyncExternalStore } from "react";
import { CopilotIcon } from "../icons/CopilotIcon";
import { cn } from "../../lib/utils";
import { StreamingMarkdownDefaultRenderer } from "./StreamingMarkdownDefaultRenderer";
import type { WithSlots } from "../../lib/slots";
import { renderSlot } from "../../lib/slots";
import {
  CopilotChatDefaultLabels,
  ɵgetReasoningHeaderLabel,
  ɵReasoningDisclosure,
} from "@copilotkit/core";
import { useCopilotChatConfiguration } from "../../providers/CopilotChatConfigurationProvider";

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
    /**
     * Whether this is the last message the chat renders. The message view
     * passes it, because the rendered list can differ from `messages` when
     * `transformMessages` drops, replaces or reorders messages. Defaults to
     * comparing against the last entry of `messages`.
     */
    isLatest?: boolean;
  } & React.HTMLAttributes<HTMLDivElement>
>;

/**
 * A reasoning message as a collapsible block. While the model reasons it is
 * open and the header shows `labels.reasoningMessageThinkingLabel`; when
 * streaming ends it collapses and the header reads
 * `labels.reasoningMessageThoughtForLabel` ("Thought for 4 seconds"). The
 * `header` slot also receives `elapsedSeconds`.
 */
export function CopilotChatReasoningMessage({
  message,
  messages,
  isRunning,
  isLatest: isLatestProp,
  header,
  contentView,
  toggle,
  children,
  className,
  ...props
}: CopilotChatReasoningMessageProps) {
  const config = useCopilotChatConfiguration();
  const labels = config?.labels ?? CopilotChatDefaultLabels;
  const isLatest =
    isLatestProp ?? messages?.[messages.length - 1]?.id === message.id;
  const isStreaming = !!(isRunning && isLatest);
  const hasContent = !!(message.content && message.content.length > 0);

  // Open while streaming, auto-collapse when it ends unless the user
  // toggled, and the elapsed time: see core's ɵReasoningDisclosure.
  const [disclosure] = useState(
    () => new ɵReasoningDisclosure({ isStreaming }),
  );
  const { isOpen, elapsedSeconds: elapsed } = useSyncExternalStore(
    disclosure.subscribe,
    disclosure.getSnapshot,
    disclosure.getSnapshot,
  );
  useEffect(() => {
    disclosure.setStreaming(isStreaming);
  }, [disclosure, isStreaming]);
  useEffect(() => disclosure.dispose, [disclosure]);

  const handleToggle = hasContent ? disclosure.toggle : undefined;

  const label = ɵgetReasoningHeaderLabel(
    { isStreaming, elapsedSeconds: elapsed },
    labels,
  );

  const boundHeader = renderSlot(header, CopilotChatReasoningMessage.Header, {
    isOpen,
    label,
    hasContent,
    isStreaming,
    elapsedSeconds: elapsed,
    onClick: handleToggle,
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
      <div data-copilotkit style={{ display: "contents" }}>
        {children({
          header: boundHeader,
          contentView: boundContent,
          toggle: boundToggle,
          message,
          messages,
          isRunning,
        })}
      </div>
    );
  }

  return (
    <div
      className={cn("cpk-reasoning-message", className)}
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
      /**
       * Seconds spent reasoning so far, updated every second while streaming.
       * The default label formats it in English ("Thought for 12 seconds");
       * a custom header can use it to build a localized label.
       */
      elapsedSeconds?: number;
    }
  > = ({
    isOpen,
    label = "Thoughts",
    hasContent,
    isStreaming,
    elapsedSeconds: _elapsedSeconds,
    className,
    children: headerChildren,
    ...headerProps
  }) => {
    const isExpandable = !!hasContent;

    return (
      <button
        type="button"
        className={cn(
          "cpk-reasoning-message-header",
          isExpandable && "cpk-reasoning-message-header-expandable",
          className,
        )}
        aria-expanded={isExpandable ? isOpen : undefined}
        {...headerProps}
      >
        <span className="cpk-reasoning-message-label">{label}</span>
        {isStreaming && !hasContent && (
          <span className="cpk-reasoning-message-indicator">
            <span className="cpk-reasoning-message-indicator-dot" />
          </span>
        )}
        {headerChildren}
        {isExpandable && (
          <CopilotIcon
            name="ChevronRight"
            className={cn(
              "cpk-reasoning-message-chevron",
              isOpen && "cpk-reasoning-message-chevron-open",
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
      <div
        className={cn("cpk-reasoning-message-content", className)}
        {...contentProps}
      >
        <div className="cpk-reasoning-message-text">
          {/* Reasoning content always uses the built-in streaming renderer; the
              pluggable provider renderer applies to assistant messages only. */}
          <StreamingMarkdownDefaultRenderer
            content={typeof contentChildren === "string" ? contentChildren : ""}
            isStreaming={isStreaming}
          />
          {isStreaming && hasContent && (
            <span className="cpk-reasoning-message-cursor">
              <span className="cpk-reasoning-message-cursor-dot" />
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
        className={cn("cpk-reasoning-message-toggle", className)}
        style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
        {...toggleProps}
      >
        <div className="cpk-reasoning-message-toggle-content">
          {toggleChildren}
        </div>
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
