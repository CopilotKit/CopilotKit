import React, { useEffect, useReducer, useState } from "react";
import { WithSlots, renderSlot, isReactComponentType } from "@/lib/slots";
import CopilotChatAssistantMessage from "./CopilotChatAssistantMessage";
import CopilotChatUserMessage from "./CopilotChatUserMessage";
import CopilotChatReasoningMessage from "./CopilotChatReasoningMessage";
import {
  ActivityMessage,
  AssistantMessage,
  Message,
  ReasoningMessage,
  UserMessage,
} from "@ag-ui/core";
import { twMerge } from "tailwind-merge";
import { useRenderActivityMessage, useRenderCustomMessages } from "@/hooks";
import { useCopilotKit } from "@/providers/CopilotKitProvider";
import { useCopilotChatConfiguration } from "@/providers/CopilotChatConfigurationProvider";

/**
 * Memoized wrapper for assistant messages to prevent re-renders when other messages change.
 */
const MemoizedAssistantMessage = React.memo(
  function MemoizedAssistantMessage({
    message,
    messages,
    isRunning,
    AssistantMessageComponent,
    slotProps,
  }: {
    message: AssistantMessage;
    messages: Message[];
    isRunning: boolean;
    AssistantMessageComponent: typeof CopilotChatAssistantMessage;
    slotProps?: Partial<
      React.ComponentProps<typeof CopilotChatAssistantMessage>
    >;
  }) {
    return (
      <AssistantMessageComponent
        message={message}
        messages={messages}
        isRunning={isRunning}
        {...slotProps}
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
        if (prevTc.function.arguments !== nextTc.function.arguments)
          return false;
      }
    }

    // Check if tool results changed for this message's tool calls
    // Tool results are separate messages with role="tool" that reference tool call IDs
    if (prevToolCalls && prevToolCalls.length > 0) {
      const toolCallIds = new Set(prevToolCalls.map((tc) => tc.id));

      const prevToolResults = prevProps.messages.filter(
        (m) => m.role === "tool" && toolCallIds.has((m as any).toolCallId),
      );
      const nextToolResults = nextProps.messages.filter(
        (m) => m.role === "tool" && toolCallIds.has((m as any).toolCallId),
      );

      // If number of tool results changed, re-render
      if (prevToolResults.length !== nextToolResults.length) return false;

      // If any tool result content changed, re-render
      for (let i = 0; i < prevToolResults.length; i++) {
        if (
          (prevToolResults[i] as any).content !==
          (nextToolResults[i] as any).content
        )
          return false;
      }
    }

    // Only care about isRunning if this message is CURRENTLY the latest
    // (we don't need to re-render just because a message stopped being the latest)
    const nextIsLatest =
      nextProps.messages[nextProps.messages.length - 1]?.id ===
      nextProps.message.id;
    if (nextIsLatest && prevProps.isRunning !== nextProps.isRunning)
      return false;

    // Check if component reference changed
    if (
      prevProps.AssistantMessageComponent !==
      nextProps.AssistantMessageComponent
    )
      return false;

    // Check if slot props changed
    if (prevProps.slotProps !== nextProps.slotProps) return false;

    return true;
  },
);

/**
 * Memoized wrapper for user messages to prevent re-renders when other messages change.
 */
const MemoizedUserMessage = React.memo(
  function MemoizedUserMessage({
    message,
    UserMessageComponent,
    slotProps,
  }: {
    message: UserMessage;
    UserMessageComponent: typeof CopilotChatUserMessage;
    slotProps?: Partial<React.ComponentProps<typeof CopilotChatUserMessage>>;
  }) {
    return <UserMessageComponent message={message} {...slotProps} />;
  },
  (prevProps, nextProps) => {
    // Only re-render if this specific message changed
    if (prevProps.message.id !== nextProps.message.id) return false;
    if (prevProps.message.content !== nextProps.message.content) return false;
    if (prevProps.UserMessageComponent !== nextProps.UserMessageComponent)
      return false;
    // Check if slot props changed
    if (prevProps.slotProps !== nextProps.slotProps) return false;
    return true;
  },
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
    renderActivityMessage: (
      message: ActivityMessage,
    ) => React.ReactElement | null;
  }) {
    return renderActivityMessage(message);
  },
  (prevProps, nextProps) => {
    // Message ID changed = different message, must re-render
    if (prevProps.message.id !== nextProps.message.id) return false;

    // Activity type changed = must re-render
    if (prevProps.message.activityType !== nextProps.message.activityType)
      return false;

    // Compare content using JSON.stringify (native code, handles deep comparison)
    if (
      JSON.stringify(prevProps.message.content) !==
      JSON.stringify(nextProps.message.content)
    )
      return false;

    return true;
  },
);

/**
 * Memoized wrapper for reasoning messages to prevent re-renders when other messages change.
 */
const MemoizedReasoningMessage = React.memo(
  function MemoizedReasoningMessage({
    message,
    messages,
    isRunning,
    ReasoningMessageComponent,
    slotProps,
  }: {
    message: ReasoningMessage;
    messages: Message[];
    isRunning: boolean;
    ReasoningMessageComponent: typeof CopilotChatReasoningMessage;
    slotProps?: Partial<
      React.ComponentProps<typeof CopilotChatReasoningMessage>
    >;
  }) {
    return (
      <ReasoningMessageComponent
        message={message}
        messages={messages}
        isRunning={isRunning}
        {...slotProps}
      />
    );
  },
  (prevProps, nextProps) => {
    // Only re-render if this specific message changed
    if (prevProps.message.id !== nextProps.message.id) return false;
    if (prevProps.message.content !== nextProps.message.content) return false;

    // Re-render when "latest" status changes (e.g. reasoning message is no longer the last message
    // because a text message was added after it — this transitions isStreaming from true to false)
    const prevIsLatest =
      prevProps.messages[prevProps.messages.length - 1]?.id ===
      prevProps.message.id;
    const nextIsLatest =
      nextProps.messages[nextProps.messages.length - 1]?.id ===
      nextProps.message.id;
    if (prevIsLatest !== nextIsLatest) return false;

    // Only care about isRunning if this message is CURRENTLY the latest
    if (nextIsLatest && prevProps.isRunning !== nextProps.isRunning)
      return false;

    // Check if component reference changed
    if (
      prevProps.ReasoningMessageComponent !==
      nextProps.ReasoningMessageComponent
    )
      return false;

    // Check if slot props changed
    if (prevProps.slotProps !== nextProps.slotProps) return false;

    return true;
  },
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
    renderCustomMessage: (params: {
      message: Message;
      position: "before" | "after";
    }) => React.ReactElement | null;
    stateSnapshot?: unknown;
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
    // Compare state snapshot - custom renderers may depend on state
    if (
      JSON.stringify(prevProps.stateSnapshot) !==
      JSON.stringify(nextProps.stateSnapshot)
    )
      return false;
    // Note: We don't compare renderCustomMessage function reference because it changes
    // frequently. The message and state comparison is sufficient to determine if a re-render is needed.
    return true;
  },
);

export type CopilotChatMessageViewProps = Omit<
  WithSlots<
    {
      assistantMessage: typeof CopilotChatAssistantMessage;
      userMessage: typeof CopilotChatUserMessage;
      reasoningMessage: typeof CopilotChatReasoningMessage;
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
    interruptElement: React.ReactElement | null;
  }) => React.ReactElement;
};

export function CopilotChatMessageView({
  messages = [],
  assistantMessage,
  userMessage,
  reasoningMessage,
  cursor,
  isRunning = false,
  children,
  className,
  ...props
}: CopilotChatMessageViewProps) {
  const renderCustomMessage = useRenderCustomMessages();
  const { renderActivityMessage } = useRenderActivityMessage();
  const { copilotkit } = useCopilotKit();
  const config = useCopilotChatConfiguration();
  const [, forceUpdate] = useReducer((x) => x + 1, 0);

  // Subscribe to state changes so custom message renderers re-render when state updates.
  useEffect(() => {
    if (!config?.agentId) return;
    const agent = copilotkit.getAgent(config.agentId);
    if (!agent) return;

    const subscription = agent.subscribe({
      onStateChanged: forceUpdate,
    });
    return () => subscription.unsubscribe();
  }, [config?.agentId, copilotkit, forceUpdate]);

  // Subscribe to interrupt element changes for in-chat rendering.
  const [interruptElement, setInterruptElement] =
    useState<React.ReactElement | null>(null);
  useEffect(() => {
    setInterruptElement(copilotkit.interruptElement);
    const subscription = copilotkit.subscribe({
      onInterruptElementChanged: ({ interruptElement }) => {
        setInterruptElement(interruptElement);
      },
    });
    return () => subscription.unsubscribe();
  }, [copilotkit]);

  // Helper to get state snapshot for a message (used for memoization)
  const getStateSnapshotForMessage = (messageId: string): unknown => {
    if (!config) return undefined;
    const resolvedRunId =
      copilotkit.getRunIdForMessage(
        config.agentId,
        config.threadId,
        messageId,
      ) ??
      copilotkit
        .getRunIdsForThread(config.agentId, config.threadId)
        .slice(-1)[0];
    if (!resolvedRunId) return undefined;
    return copilotkit.getStateByRun(
      config.agentId,
      config.threadId,
      resolvedRunId,
    );
  };

  const messageElements: React.ReactElement[] = messages
    .flatMap((message) => {
      const elements: (React.ReactElement | null | undefined)[] = [];
      const stateSnapshot = getStateSnapshotForMessage(message.id);

      // Render custom message before (using memoized wrapper)
      if (renderCustomMessage) {
        elements.push(
          <MemoizedCustomMessage
            key={`${message.id}-custom-before`}
            message={message}
            position="before"
            renderCustomMessage={renderCustomMessage}
            stateSnapshot={stateSnapshot}
          />,
        );
      }

      // Render the main message using memoized wrappers to prevent unnecessary re-renders
      if (message.role === "assistant") {
        // Determine the component and props from slot value
        let AssistantComponent = CopilotChatAssistantMessage;
        let assistantSlotProps:
          | Partial<React.ComponentProps<typeof CopilotChatAssistantMessage>>
          | undefined;

        if (isReactComponentType(assistantMessage)) {
          // Custom component (function, forwardRef, memo, etc.)
          AssistantComponent =
            assistantMessage as typeof CopilotChatAssistantMessage;
        } else if (typeof assistantMessage === "string") {
          // className string
          assistantSlotProps = { className: assistantMessage };
        } else if (assistantMessage && typeof assistantMessage === "object") {
          // Props object
          assistantSlotProps = assistantMessage as Partial<
            React.ComponentProps<typeof CopilotChatAssistantMessage>
          >;
        }

        elements.push(
          <MemoizedAssistantMessage
            key={message.id}
            message={message as AssistantMessage}
            messages={messages}
            isRunning={isRunning}
            AssistantMessageComponent={AssistantComponent}
            slotProps={assistantSlotProps}
          />,
        );
      } else if (message.role === "user") {
        // Determine the component and props from slot value
        let UserComponent = CopilotChatUserMessage;
        let userSlotProps:
          | Partial<React.ComponentProps<typeof CopilotChatUserMessage>>
          | undefined;

        if (isReactComponentType(userMessage)) {
          // Custom component (function, forwardRef, memo, etc.)
          UserComponent = userMessage as typeof CopilotChatUserMessage;
        } else if (typeof userMessage === "string") {
          // className string
          userSlotProps = { className: userMessage };
        } else if (userMessage && typeof userMessage === "object") {
          // Props object
          userSlotProps = userMessage as Partial<
            React.ComponentProps<typeof CopilotChatUserMessage>
          >;
        }

        elements.push(
          <MemoizedUserMessage
            key={message.id}
            message={message as UserMessage}
            UserMessageComponent={UserComponent}
            slotProps={userSlotProps}
          />,
        );
      } else if (message.role === "activity") {
        // Use memoized wrapper to prevent re-renders when other messages change
        const activityMsg = message as ActivityMessage;
        elements.push(
          <MemoizedActivityMessage
            key={message.id}
            message={activityMsg}
            renderActivityMessage={renderActivityMessage}
          />,
        );
      } else if (message.role === "reasoning") {
        // Determine the component and props from slot value
        let ReasoningComponent = CopilotChatReasoningMessage;
        let reasoningSlotProps:
          | Partial<React.ComponentProps<typeof CopilotChatReasoningMessage>>
          | undefined;

        if (isReactComponentType(reasoningMessage)) {
          ReasoningComponent =
            reasoningMessage as typeof CopilotChatReasoningMessage;
        } else if (typeof reasoningMessage === "string") {
          reasoningSlotProps = { className: reasoningMessage };
        } else if (reasoningMessage && typeof reasoningMessage === "object") {
          reasoningSlotProps = reasoningMessage as Partial<
            React.ComponentProps<typeof CopilotChatReasoningMessage>
          >;
        }

        elements.push(
          <MemoizedReasoningMessage
            key={message.id}
            message={message as ReasoningMessage}
            messages={messages}
            isRunning={isRunning}
            ReasoningMessageComponent={ReasoningComponent}
            slotProps={reasoningSlotProps}
          />,
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
            stateSnapshot={stateSnapshot}
          />,
        );
      }

      return elements;
    })
    .filter(Boolean) as React.ReactElement[];

  if (children) {
    return (
      <div data-copilotkit style={{ display: "contents" }}>
        {children({ messageElements, messages, isRunning, interruptElement })}
      </div>
    );
  }

  // Hide the chat-level loading cursor when the last message is a reasoning
  // message — the reasoning card already shows its own loading indicator.
  const lastMessage = messages[messages.length - 1];
  const showCursor = isRunning && lastMessage?.role !== "reasoning";

  return (
    <div
      data-copilotkit
      className={twMerge("cpk:flex cpk:flex-col", className)}
      {...props}
    >
      {messageElements}
      {interruptElement}
      {showCursor && (
        <div className="cpk:mt-2">
          {renderSlot(cursor, CopilotChatMessageView.Cursor, {})}
        </div>
      )}
    </div>
  );
}

CopilotChatMessageView.Cursor = function Cursor({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={twMerge(
        "cpk:w-[11px] cpk:h-[11px] cpk:rounded-full cpk:bg-foreground cpk:animate-pulse-cursor cpk:ml-1",
        className,
      )}
      {...props}
    />
  );
};

export default CopilotChatMessageView;
