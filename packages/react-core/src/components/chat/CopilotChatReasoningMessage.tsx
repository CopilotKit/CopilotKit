import type { ReasoningMessage, Message } from "@ag-ui/core";
import { useState, useEffect, useRef } from "react";
import { CopilotIcon } from "../icons/CopilotIcon";
import { cn } from "../../lib/utils";
import { StreamingMarkdownDefaultRenderer } from "./StreamingMarkdownDefaultRenderer";
import type { WithSlots } from "../../lib/slots";
import { renderSlot } from "../../lib/slots";
import {
  CopilotChatDefaultLabels,
  ɵformatLabel,
  ɵformatReasoningDuration,
  ɵformatCountLabel,
} from "@copilotkit/core";
import type { CopilotChatLabels } from "@copilotkit/core";
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
 * The reasoning time as label text, such as "4 seconds" or "1m 5s".
 *
 * @param seconds - The elapsed time in seconds. It may have a fraction.
 * @param labels - The chat labels that hold the duration texts.
 */
function formatDuration(seconds: number, labels: CopilotChatLabels) {
  const duration = ɵformatReasoningDuration(seconds);
  switch (duration.unit) {
    case "fewSeconds":
      return labels.reasoningMessageDurationFewSeconds;
    case "seconds":
      return ɵformatLabel(labels.reasoningMessageDurationSeconds, {
        count: duration.seconds,
      });
    case "minutes":
      return ɵformatCountLabel(duration.minutes, {
        one: labels.reasoningMessageDurationMinutesOne,
        other: labels.reasoningMessageDurationMinutesOther,
      });
    case "minutesSeconds":
      return ɵformatLabel(labels.reasoningMessageDurationMinutesSeconds, {
        minutes: duration.minutes,
        seconds: duration.seconds,
      });
  }
}

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

  // Default to open while streaming, auto-collapse when streaming ends.
  // Track whether the user has manually toggled so auto-collapse doesn't
  // override their explicit intent (prevents flaky test failures on CI
  // where async forceUpdate timing can race with click handlers).
  const [isOpen, setIsOpen] = useState(isStreaming);
  const userToggledRef = useRef(false);

  useEffect(() => {
    if (isStreaming) {
      // Reset user-toggle tracking when a new streaming session starts
      userToggledRef.current = false;
      setIsOpen(true);
    } else if (!userToggledRef.current) {
      // Auto-collapse only if the user hasn't manually toggled
      setIsOpen(false);
    }
  }, [isStreaming]);

  const handleToggle = hasContent
    ? () => {
        userToggledRef.current = true;
        setIsOpen((prev) => !prev);
      }
    : undefined;

  const label = isStreaming
    ? labels.reasoningMessageThinkingLabel
    : ɵformatLabel(labels.reasoningMessageThoughtForLabel, {
        duration: formatDuration(elapsed, labels),
      });

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
