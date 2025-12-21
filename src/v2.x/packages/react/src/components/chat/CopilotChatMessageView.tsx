import React from "react";
import { WithSlots, renderSlot } from "@/lib/slots";
import CopilotChatAssistantMessage from "./CopilotChatAssistantMessage";
import CopilotChatUserMessage from "./CopilotChatUserMessage";
import { ActivityMessage, AssistantMessage, Message, UserMessage } from "@ag-ui/core";
import { twMerge } from "tailwind-merge";
import { useRenderActivityMessage, useRenderCustomMessages } from "@/hooks";

/**
 * Memoized wrapper for assistant messages to prevent re-renders when other messages change.
 */
const MemoizedAssistantMessage = React.memo(
  function MemoizedAssistantMessage({
    message,
    messages,
    isRunning,
    AssistantMessageComponent,
  }: {
    message: AssistantMessage;
    messages: Message[];
    isRunning: boolean;
    AssistantMessageComponent: typeof CopilotChatAssistantMessage;
  }) {
    return (
      <AssistantMessageComponent
        message={message}
        messages={messages}
        isRunning={isRunning}
      />
    );
  },
  (prevProps, nextProps) => {
    // Only re-render if this specific message changed
    if (prevProps.message.id !== nextProps.message.id) return false;
    if (prevProps.message.content !== nextProps.message.content) return false;

    // Compare tool calls if present
    const prevToolCalls = prevProps.message.toolCalls;
    const nextToolCalls = nextProps.message.toolCalls;
    if (prevToolCalls?.length !== nextToolCalls?.length) return false;
    if (prevToolCalls && nextToolCalls) {
      for (let i = 0; i < prevToolCalls.length; i++) {
        const prevTc = prevToolCalls[i];
        const nextTc = nextToolCalls[i];
        if (!prevTc || !nextTc) return false;
        if (prevTc.id !== nextTc.id) return false;
        if (prevTc.function.arguments !== nextTc.function.arguments) return false;
      }
    }

    // Check if tool results changed for this message's tool calls
    // Tool results are separate messages with role="tool" that reference tool call IDs
    if (prevToolCalls && prevToolCalls.length > 0) {
      const toolCallIds = new Set(prevToolCalls.map(tc => tc.id));

      const prevToolResults = prevProps.messages.filter(
        m => m.role === "tool" && toolCallIds.has((m as any).toolCallId)
      );
      const nextToolResults = nextProps.messages.filter(
        m => m.role === "tool" && toolCallIds.has((m as any).toolCallId)
      );

      // If number of tool results changed, re-render
      if (prevToolResults.length !== nextToolResults.length) return false;

      // If any tool result content changed, re-render
      for (let i = 0; i < prevToolResults.length; i++) {
        if ((prevToolResults[i] as any).content !== (nextToolResults[i] as any).content) return false;
      }
    }

    // Only care about isRunning if this message is CURRENTLY the latest
    // (we don't need to re-render just because a message stopped being the latest)
    const nextIsLatest = nextProps.messages[nextProps.messages.length - 1]?.id === nextProps.message.id;
    if (nextIsLatest && prevProps.isRunning !== nextProps.isRunning) return false;

    // Check if component reference changed
    if (prevProps.AssistantMessageComponent !== nextProps.AssistantMessageComponent) return false;

    return true;
  }
);

/**
 * Memoized wrapper for user messages to prevent re-renders when other messages change.
 */
const MemoizedUserMessage = React.memo(
  function MemoizedUserMessage({
    message,
    UserMessageComponent,
  }: {
    message: UserMessage;
    UserMessageComponent: typeof CopilotChatUserMessage;
  }) {
    return <UserMessageComponent message={message} />;
  },
  (prevProps, nextProps) => {
    // Only re-render if this specific message changed
    if (prevProps.message.id !== nextProps.message.id) return false;
    if (prevProps.message.content !== nextProps.message.content) return false;
    if (prevProps.UserMessageComponent !== nextProps.UserMessageComponent) return false;
    return true;
  }
);

/**
 * Memoized wrapper for activity messages to prevent re-renders when other messages change.
 */
const MemoizedActivityMessage = React.memo(
  function MemoizedActivityMessage({
    message,
    renderActivityMessage,
  }: {
    message: ActivityMessage;
    renderActivityMessage: (message: ActivityMessage) => React.ReactElement | null;
  }) {
    return renderActivityMessage(message);
  },
  (prevProps, nextProps) => {
    // Only re-render if this specific activity message changed
    if (prevProps.message.id !== nextProps.message.id) return false;
    if (prevProps.message.activityType !== nextProps.message.activityType) return false;
    // Compare content - need to stringify since it's an object
    if (JSON.stringify(prevProps.message.content) !== JSON.stringify(nextProps.message.content)) return false;
    // Note: We don't compare renderActivityMessage function reference because it changes
    // frequently due to useCallback dependencies in useRenderActivityMessage.
    // The message content comparison is sufficient to determine if a re-render is needed.
    return true;
  }
);

/**
 * Memoized wrapper for custom messages to prevent re-renders when other messages change.
 */
const MemoizedCustomMessage = React.memo(
  function MemoizedCustomMessage({
    message,
    position,
    renderCustomMessage,
  }: {
    message: Message;
    position: "before" | "after";
    renderCustomMessage: (params: { message: Message; position: "before" | "after" }) => React.ReactElement | null;
  }) {
    return renderCustomMessage({ message, position });
  },
  (prevProps, nextProps) => {
    // Only re-render if the message or position changed
    if (prevProps.message.id !== nextProps.message.id) return false;
    if (prevProps.position !== nextProps.position) return false;
    // Compare message content - for assistant messages this is a string, for others may differ
    if (prevProps.message.content !== nextProps.message.content) return false;
    if (prevProps.message.role !== nextProps.message.role) return false;
    // Note: We don't compare renderCustomMessage function reference because it changes
    // frequently. The message content comparison is sufficient to determine if a re-render is needed.
    return true;
  }
);

export type CopilotChatMessageViewProps = Omit<
  WithSlots<
    {
      assistantMessage: typeof CopilotChatAssistantMessage;
      userMessage: typeof CopilotChatUserMessage;
      cursor: typeof CopilotChatMessageView.Cursor;
    },
    {
      isRunning?: boolean;
      messages?: Message[];
    } & React.HTMLAttributes<HTMLDivElement>
  >,
  "children"
> & {
  children?: (props: {
    isRunning: boolean;
    messages: Message[];
    messageElements: React.ReactElement[];
  }) => React.ReactElement;
};

export function CopilotChatMessageView({
  messages = [],
  assistantMessage,
  userMessage,
  cursor,
  isRunning = false,
  children,
  className,
  ...props
}: CopilotChatMessageViewProps) {
  const renderCustomMessage = useRenderCustomMessages();
  const renderActivityMessage = useRenderActivityMessage();

  const messageElements: React.ReactElement[] = messages
    .flatMap((message) => {
      const elements: (React.ReactElement | null | undefined)[] = [];

      // Render custom message before (using memoized wrapper)
      if (renderCustomMessage) {
        elements.push(
          <MemoizedCustomMessage
            key={`${message.id}-custom-before`}
            message={message}
            position="before"
            renderCustomMessage={renderCustomMessage}
          />
        );
      }

      // Render the main message using memoized wrappers to prevent unnecessary re-renders
      if (message.role === "assistant") {
        // Determine the component to use (custom slot or default)
        const AssistantComponent = (
          typeof assistantMessage === "function"
            ? assistantMessage
            : CopilotChatAssistantMessage
        ) as typeof CopilotChatAssistantMessage;

        elements.push(
          <MemoizedAssistantMessage
            key={message.id}
            message={message as AssistantMessage}
            messages={messages}
            isRunning={isRunning}
            AssistantMessageComponent={AssistantComponent}
          />
        );
      } else if (message.role === "user") {
        // Determine the component to use (custom slot or default)
        const UserComponent = (
          typeof userMessage === "function"
            ? userMessage
            : CopilotChatUserMessage
        ) as typeof CopilotChatUserMessage;

        elements.push(
          <MemoizedUserMessage
            key={message.id}
            message={message as UserMessage}
            UserMessageComponent={UserComponent}
          />
        );
      } else if (message.role === "activity") {
        // Use memoized wrapper to prevent re-renders when other messages change
        elements.push(
          <MemoizedActivityMessage
            key={message.id}
            message={message as ActivityMessage}
            renderActivityMessage={renderActivityMessage}
          />
        );
      }

      // Render custom message after (using memoized wrapper)
      if (renderCustomMessage) {
        elements.push(
          <MemoizedCustomMessage
            key={`${message.id}-custom-after`}
            message={message}
            position="after"
            renderCustomMessage={renderCustomMessage}
          />
        );
      }

      return elements;
    })
    .filter(Boolean) as React.ReactElement[];

  if (children) {
    return children({ messageElements, messages, isRunning });
  }

  return (
    <div className={twMerge("flex flex-col", className)} {...props}>
      {messageElements}
      {isRunning && renderSlot(cursor, CopilotChatMessageView.Cursor, {})}
    </div>
  );
}

CopilotChatMessageView.Cursor = function Cursor({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={twMerge("w-[11px] h-[11px] rounded-full bg-foreground animate-pulse-cursor ml-1", className)}
      {...props}
    />
  );
};

export default CopilotChatMessageView;
