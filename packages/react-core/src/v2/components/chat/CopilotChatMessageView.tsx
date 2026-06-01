import React, {
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ScrollElementContext } from "./scroll-element-context";
import type { WithSlots } from "../../lib/slots";
import { renderSlot, isReactComponentType } from "../../lib/slots";
import CopilotChatAssistantMessage from "./CopilotChatAssistantMessage";
import CopilotChatUserMessage from "./CopilotChatUserMessage";
import CopilotChatReasoningMessage from "./CopilotChatReasoningMessage";
import type {
  ActivityMessage,
  AssistantMessage,
  Message,
  ReasoningMessage,
  ToolMessage,
  UserMessage,
} from "@ag-ui/core";
import { twMerge } from "tailwind-merge";
import { useRenderActivityMessage, useRenderCustomMessages } from "../../hooks";
import { useCopilotKit } from "../../providers/CopilotKitProvider";
import { useCopilotChatConfiguration } from "../../providers/CopilotChatConfigurationProvider";
import { IntelligenceIndicator } from "../intelligence-indicator";
import { DEFAULT_AGENT_ID } from "@copilotkit/shared";

/**
 * Resolves a slot value into a { Component, slotProps } pair, handling the three
 * slot forms: a component type, a className string, or a partial-props object.
 */
function resolveSlotComponent<T extends React.ComponentType<any>>(
  slot: unknown,
  DefaultComponent: T,
): { Component: T; slotProps: Partial<React.ComponentProps<T>> | undefined } {
  if (isReactComponentType(slot)) {
    return { Component: slot as T, slotProps: undefined };
  }
  if (typeof slot === "string") {
    return {
      Component: DefaultComponent,
      slotProps: { className: slot } as unknown as Partial<
        React.ComponentProps<T>
      >,
    };
  }
  if (slot && typeof slot === "object") {
    return {
      Component: DefaultComponent,
      slotProps: slot as Partial<React.ComponentProps<T>>,
    };
  }
  return { Component: DefaultComponent, slotProps: undefined };
}

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
        const prevTc = prevToolCalls[i]!;
        const nextTc = nextToolCalls[i]!;
        if (prevTc.id !== nextTc.id) return false;
        if (prevTc.function.arguments !== nextTc.function.arguments)
          return false;
      }
    }

    // Check if tool results changed for this message's tool calls.
    // Tool results are separate messages with role="tool" that reference tool call IDs.
    if (prevToolCalls && prevToolCalls.length > 0) {
      const toolCallIds = new Set(prevToolCalls.map((tc) => tc.id));

      const prevToolResults = prevProps.messages.filter(
        (m): m is ToolMessage =>
          m.role === "tool" && toolCallIds.has(m.toolCallId),
      );
      const nextToolResults = nextProps.messages.filter(
        (m): m is ToolMessage =>
          m.role === "tool" && toolCallIds.has(m.toolCallId),
      );

      if (prevToolResults.length !== nextToolResults.length) return false;

      for (let i = 0; i < prevToolResults.length; i++) {
        if (prevToolResults[i]!.content !== nextToolResults[i]!.content)
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

/**
 * Deduplicates messages by ID. For assistant messages, merges occurrences:
 * recovers non-empty content from any earlier occurrence if the latest wiped it
 * (empty string means the streaming update cleared the field, not blank text),
 * and similarly recovers toolCalls from earlier occurrences if the latest is
 * undefined (an empty array [] is treated as intentional and kept as-is).
 * For all other roles, keeps the last entry.
 *
 * @internal Exported for unit testing only — not part of the public API.
 */
export function deduplicateMessages(messages: Message[]): Message[] {
  const acc = new Map<string, Message>();
  for (const message of messages) {
    const existing = acc.get(message.id);
    if (
      existing &&
      message.role === "assistant" &&
      existing.role === "assistant"
    ) {
      // Empty string means the streaming update cleared the field — fall back to
      // any non-empty content seen earlier. Use { ...existing, ...message } so
      // fields present only in an earlier occurrence are not silently dropped.
      const content = message.content || existing.content;
      // undefined toolCalls means this chunk had no tool call activity — recover
      // from earlier occurrences. An explicit [] means all tool calls completed.
      const toolCalls = message.toolCalls ?? existing.toolCalls;
      acc.set(message.id, {
        ...existing,
        ...message,
        content,
        toolCalls,
      } as AssistantMessage);
    } else {
      acc.set(message.id, message);
    }
  }
  return [...acc.values()];
}

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

// Above this many messages, activate TanStack Virtual to avoid mounting the
// full DOM tree. Below the threshold the overhead of virtualization isn't
// worth it and the simpler flat render is faster.
const VIRTUALIZE_THRESHOLD = 50;

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

  const deduplicatedMessages = useMemo(
    () => deduplicateMessages(messages),
    [messages],
  );

  if (
    process.env.NODE_ENV === "development" &&
    deduplicatedMessages.length < messages.length
  ) {
    console.warn(
      `CopilotChatMessageView: Merged ${messages.length - deduplicatedMessages.length} message(s) with duplicate IDs.`,
    );
  }

  // Resolve slot values once per prop change rather than inside renderMessageBlock.
  // resolveSlotComponent returns a new object every call when the slot is a CSS
  // class string, which would defeat MemoizedAssistantMessage's slotProps
  // reference-equality check and cause all completed messages to re-render.
  const { Component: AssistantComponent, slotProps: assistantSlotProps } =
    useMemo(
      () => resolveSlotComponent(assistantMessage, CopilotChatAssistantMessage),
      [assistantMessage],
    );
  const { Component: UserComponent, slotProps: userSlotProps } = useMemo(
    () => resolveSlotComponent(userMessage, CopilotChatUserMessage),
    [userMessage],
  );
  const { Component: ReasoningComponent, slotProps: reasoningSlotProps } =
    useMemo(
      () => resolveSlotComponent(reasoningMessage, CopilotChatReasoningMessage),
      [reasoningMessage],
    );

  // ---------------------------------------------------------------------------
  // Virtualization
  // ---------------------------------------------------------------------------
  // Receive the scroll container from context. ScrollView provides the element
  // as state (not a ref) so this component re-renders reactively when the
  // container first mounts. clientHeight === 0 means no real layout (jsdom) —
  // skip virtualization so tests run the flat path.
  const scrollElementFromCtx = useContext(ScrollElementContext);
  const scrollElement =
    scrollElementFromCtx && scrollElementFromCtx.clientHeight > 0
      ? scrollElementFromCtx
      : null;

  // Warn once in dev when a scroll element is provided but has no height —
  // this silently disables virtualization (e.g. chat inside display:none tab).
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" &&
      scrollElementFromCtx &&
      scrollElementFromCtx.clientHeight === 0
    ) {
      console.warn(
        "[CopilotKit] Chat scroll container has clientHeight=0 — virtualization disabled. " +
          "Ensure the chat is rendered in a visible container with a non-zero height.",
      );
    }
  }, [scrollElementFromCtx]);

  // Virtualize only when we have a scroll element and enough messages. The
  // `children` render prop delegates layout to the caller, so we keep
  // messageElements flat for that case.
  const shouldVirtualize =
    !!scrollElement &&
    !children &&
    deduplicatedMessages.length > VIRTUALIZE_THRESHOLD;

  const virtualizer = useVirtualizer({
    // count=0 disables the virtualizer without changing hook call order.
    count: shouldVirtualize ? deduplicatedMessages.length : 0,
    getScrollElement: () => scrollElement,
    // Conservative height estimate. Items are measured by ResizeObserver after
    // first render so the estimate only affects the initial total height.
    estimateSize: () => 100,
    overscan: 5,
    measureElement: (el: Element) => el?.getBoundingClientRect().height ?? 0,
    // Assume a 600 px viewport before the real element is measured so that
    // the first virtual render shows ~6 items rather than 0.
    initialRect: { width: 0, height: 600 },
  });

  // Scroll to the bottom when virtual mode first activates or the thread changes
  // (detected by the first message ID changing). For streaming new messages,
  // use-stick-to-bottom handles auto-scroll via content height growth detection
  // on the virtualizer's total-size div — same as the flat path. Adding
  // deduplicatedMessages.length here would forcibly yank the user to the bottom
  // on every streaming chunk even if they've scrolled up to read history.
  const firstMessageId = deduplicatedMessages[0]?.id;
  useLayoutEffect(() => {
    if (!shouldVirtualize || !deduplicatedMessages.length) return;
    virtualizer.scrollToIndex(deduplicatedMessages.length - 1, {
      align: "end",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldVirtualize, firstMessageId]);

  // ---------------------------------------------------------------------------
  // Per-message rendering helper (shared by flat and virtual paths)
  // ---------------------------------------------------------------------------
  const renderMessageBlock = (message: Message): React.ReactElement[] => {
    const elements: (React.ReactElement | null | undefined)[] = [];
    const stateSnapshot = getStateSnapshotForMessage(message.id);

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

    if (message.role === "assistant") {
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
      elements.push(
        <MemoizedUserMessage
          key={message.id}
          message={message as UserMessage}
          UserMessageComponent={UserComponent}
          slotProps={userSlotProps}
        />,
      );
    } else if (message.role === "activity") {
      elements.push(
        <MemoizedActivityMessage
          key={message.id}
          message={message as ActivityMessage}
          renderActivityMessage={renderActivityMessage}
        />,
      );
    } else if (message.role === "reasoning") {
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

    // Auto-mount the IntelligenceIndicator on assistant message slots
    // when the runtime is in intelligence mode. The component self-gates
    // further (latest matching-assistant slot, pending tool-call grace
    // window) so only one pill renders at a time — mounting only for
    // assistant messages avoids the per-slot `useAgent` subscription
    // and four effects on user/reasoning/activity slots that would just
    // return null at the role gate anyway.
    if (copilotkit.intelligence !== undefined && message.role === "assistant") {
      elements.push(
        <IntelligenceIndicator
          key={`${message.id}-intelligence`}
          message={message}
          agentId={config?.agentId ?? DEFAULT_AGENT_ID}
        />,
      );
    }

    return elements.filter(Boolean) as React.ReactElement[];
  };

  // Build the flat element list only when we're not virtualizing (avoids
  // creating 500 React elements that we'd immediately discard).
  const messageElements: React.ReactElement[] = shouldVirtualize
    ? []
    : deduplicatedMessages.flatMap(renderMessageBlock);

  // ---------------------------------------------------------------------------
  // children render prop (custom layout, always non-virtual)
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Render — shared wrapper, conditional inner content (virtual vs flat)
  // ---------------------------------------------------------------------------
  return (
    <div
      data-copilotkit
      data-testid="copilot-message-list"
      className={twMerge("copilotKitMessages cpk:flex cpk:flex-col", className)}
      {...props}
    >
      {shouldVirtualize ? (
        // Virtual path: only visible items are in the DOM; outer div maintains
        // total scroll height so the scrollbar reflects the full list size.
        <div
          style={{ height: virtualizer.getTotalSize(), position: "relative" }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const message = deduplicatedMessages[virtualItem.index]!;
            return (
              <div
                key={message.id}
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                {renderMessageBlock(message)}
              </div>
            );
          })}
        </div>
      ) : (
        messageElements
      )}
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
      data-testid="copilot-loading-cursor"
      className={twMerge(
        "cpk:w-[11px] cpk:h-[11px] cpk:rounded-full cpk:bg-foreground cpk:animate-pulse-cursor cpk:ml-1",
        className,
      )}
      {...props}
    />
  );
};

export default CopilotChatMessageView;
