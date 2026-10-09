import React, {
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { VirtualItem, Virtualizer } from "@tanstack/react-virtual";
import { ScrollElementContext } from "./scroll-element-context";
import { ScrollPinnedContext } from "./scroll-pinned-context";
import type { WithSlots } from "../../lib/slots";
import { renderSlot, isReactComponentType } from "../../lib/slots";
import CopilotChatAssistantMessage from "./CopilotChatAssistantMessage";
import type { CopilotChatFeedbackMessage } from "./CopilotChatAssistantMessage";
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
import {
  IntelligenceIndicator,
  getIntelligenceTurnAnchors,
} from "../intelligence-indicator";
import type { IntelligenceIndicatorView } from "../intelligence-indicator";
import {
  DEFAULT_AGENT_ID,
  commitRowKeyStore,
  createRowKeyStore,
  resolveRowRenderKeysById,
} from "@copilotkit/shared";
import type { RowKeyStore } from "@copilotkit/shared";

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
    isLatest,
    AssistantMessageComponent,
    slotProps,
  }: {
    message: AssistantMessage;
    messages: Message[];
    isRunning: boolean;
    isLatest: boolean;
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
        isLatest={isLatest}
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

    // A message renders as in-progress (toolbar hidden) only while it is the
    // latest one and the run is going. Re-render when that flips, including a
    // message that stops being the latest mid-run; not for every change in
    // either flag, so earlier messages stay put while a new one streams in.
    if (
      (prevProps.isRunning && prevProps.isLatest) !==
      (nextProps.isRunning && nextProps.isLatest)
    )
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
    isLatest,
    ReasoningMessageComponent,
    slotProps,
  }: {
    message: ReasoningMessage;
    messages: Message[];
    isRunning: boolean;
    isLatest: boolean;
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
        isLatest={isLatest}
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
    if (prevProps.isLatest !== nextProps.isLatest) return false;

    // Only care about isRunning if this message is CURRENTLY the latest
    if (nextProps.isLatest && prevProps.isRunning !== nextProps.isRunning)
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
/**
 * Collapse tool calls that share an id, keeping first-seen order.
 *
 * AG-UI's TOOL_CALL_START handler appends to the parent message's `toolCalls`
 * without checking whether that id is already present. So whenever a start
 * event is applied twice — which the human-in-the-loop flow triggers when the
 * run syncs after `respond()` — the message ends up carrying the same call
 * twice. The second copy has EMPTY `arguments`, because a start event carries
 * none; the args arrive later as TOOL_CALL_ARGS deltas addressed to the first
 * copy.
 *
 * Left alone that renders the same tool call twice: once populated and once
 * blank (an approval card with no transaction id, offering live buttons for an
 * action already taken), and React warns "Encountered two children with the
 * same key" because the call id is the render key.
 *
 * The empty copy is the redundant one, so prefer whichever entry actually
 * carries arguments rather than blindly taking the first.
 */
function dedupeToolCalls(
  toolCalls: NonNullable<AssistantMessage["toolCalls"]>,
): NonNullable<AssistantMessage["toolCalls"]> {
  const byId = new Map<string, (typeof toolCalls)[number]>();
  for (const toolCall of toolCalls) {
    const existing = byId.get(toolCall.id);
    if (!existing) {
      byId.set(toolCall.id, toolCall);
      continue;
    }
    if (!existing.function?.arguments && toolCall.function?.arguments) {
      byId.set(toolCall.id, toolCall);
    }
  }
  return byId.size === toolCalls.length ? toolCalls : [...byId.values()];
}

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
        toolCalls: toolCalls ? dedupeToolCalls(toolCalls) : toolCalls,
      } as AssistantMessage);
    } else if (message.role === "assistant" && message.toolCalls) {
      // Duplicate call ids also arrive on a message that was never itself
      // duplicated, so this cannot live in the merge branch above.
      acc.set(message.id, {
        ...message,
        toolCalls: dedupeToolCalls(message.toolCalls),
      } as AssistantMessage);
    } else {
      acc.set(message.id, message);
    }
  }
  return [...acc.values()];
}

/** What the view passes the wrapper of a message group. */
export interface MessageGroupWrapperProps<S = unknown> {
  /** The group's key, as returned by `groupMessages`. */
  groupKey: string;
  /** The messages in the group, in order. */
  messages: Message[];
  /** The default rendering of the group's messages. */
  children: React.ReactNode;
  /**
   * State the view keeps for this group, keyed by `groupKey`. It survives the
   * row leaving the window and the wrapper remounting, is dropped once the key
   * no longer appears, and is cleared when the thread changes. `undefined`
   * until first set.
   */
  state: S | undefined;
  setState: (next: S) => void;
}

/** Several messages rendered as one row, inside an app-provided wrapper. */
export interface MessageGroup<S = unknown> {
  type: "group";
  /**
   * Identifies the group across renders: its React key and the key its state
   * is held under. Keep it stable while the thread streams, e.g. the id of the
   * group's first message.
   */
  key: string;
  messages: Message[];
  /**
   * Define it once at module level. A component created inside
   * `groupMessages` is a new type on every call and remounts each time.
   */
  wrapper: React.ComponentType<MessageGroupWrapperProps<S>>;
}

/** One row of the message list: a single message, or a group of them. */
export type MessageRow = { type: "message"; message: Message } | MessageGroup;

/** A row holding a single message, rendered as it would be ungrouped. */
export function messageRow(message: Message): MessageRow {
  return { type: "message", message };
}

/** A row holding a group of messages, rendered inside `wrapper`. */
export function messageGroup<S>(
  group: Omit<MessageGroup<S>, "type">,
): MessageRow {
  // A group's state type is between it and its own wrapper; the row list only
  // hands back what that wrapper set. Erased once here so groups with
  // different state types can share one array.
  return { type: "group", ...group } as unknown as MessageGroup;
}

const GROUP_ROW_KEY_PREFIX = "copilotkit-group:";

export type CopilotChatMessageViewProps = Omit<
  WithSlots<
    {
      assistantMessage: typeof CopilotChatAssistantMessage;
      userMessage: typeof CopilotChatUserMessage;
      reasoningMessage: typeof CopilotChatReasoningMessage;
      cursor: typeof CopilotChatMessageView.Cursor;
      intelligenceIndicator: typeof IntelligenceIndicatorView;
    },
    {
      isRunning?: boolean;
      messages?: Message[];
      /**
       * Reshapes the message list before it renders: drop, replace or reorder
       * messages with the whole list in view. Receives the list after duplicate
       * ids are merged. Row keys, virtualization and rendering all work off
       * the returned list, so a dropped message takes no row.
       *
       * Tool-call cards still look up their results in the full list, so
       * hiding tool-result messages here does not strip results from them.
       *
       * Memoized on the input list and this function — pass a stable function
       * (e.g. `useCallback`) or it reruns on every render.
       */
      transformMessages?: (messages: Message[]) => Message[];
      /**
       * Splits the message list into rows. Return `messageRow(message)` for a
       * message that renders on its own, and `messageGroup({ key, messages,
       * wrapper })` for messages that render together inside `wrapper` — a
       * collapsible block of tool calls, say. Receives the list after
       * `transformMessages`. Each row is one virtualized row.
       *
       * Return each message in at most one row. Tool-call cards still find
       * their results in the full list.
       *
       * Memoized on its input and this function — pass a stable function.
       */
      groupMessages?: (messages: Message[]) => MessageRow[];
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
  intelligenceIndicator,
  isRunning = false,
  transformMessages,
  groupMessages,
  children,
  className,
  ...props
}: CopilotChatMessageViewProps) {
  const isPinnedToBottom = useContext(ScrollPinnedContext);
  const renderCustomMessage = useRenderCustomMessages();
  const { renderActivityMessage } = useRenderActivityMessage();
  const { copilotkit, showIntelligenceIndicator = true } = useCopilotKit();
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

  // What actually renders. Everything below — row keys, virtualization,
  // rendering — works off this list. Tool-result lookups keep using the full
  // `messages`, so a transform that hides tool results cannot break the cards
  // that display them.
  const transformedMessages = useMemo(
    () =>
      transformMessages
        ? transformMessages(deduplicatedMessages)
        : deduplicatedMessages,
    [deduplicatedMessages, transformMessages],
  );

  // One entry per virtualized row. Without grouping, every message is its own.
  const rows = useMemo<MessageRow[]>(
    () =>
      groupMessages
        ? groupMessages(transformedMessages)
        : transformedMessages.map(messageRow),
    [transformedMessages, groupMessages],
  );

  // Every message that renders, in the order it renders, whether on its own
  // row or inside a group. The message-level machinery below (row keys, the
  // latest message, Intelligence anchors) reads this, not `rows`.
  const renderedMessages = useMemo(
    () =>
      groupMessages
        ? rows.flatMap((row) =>
            row.type === "group" ? row.messages : [row.message],
          )
        : transformedMessages,
    [rows, groupMessages, transformedMessages],
  );

  // "Latest" means the last row on screen, not the last entry of `messages`:
  // a transform can drop, replace or reorder the tail. Streaming state and the
  // assistant toolbar key off this.
  const latestRenderedId = renderedMessages[renderedMessages.length - 1]?.id;

  // Row keys are looked up by message id, so two rendered messages sharing an
  // id would share a React key. Deduplication already ran on the input, so a
  // repeat here can only come from the transform.
  const transformDuplicateId = useMemo(() => {
    if (
      process.env.NODE_ENV === "production" ||
      (!transformMessages && !groupMessages)
    ) {
      return;
    }
    const seen = new Set<string>();
    for (const message of renderedMessages) {
      if (seen.has(message.id)) return message.id;
      seen.add(message.id);
    }
  }, [renderedMessages, transformMessages, groupMessages]);
  useEffect(() => {
    if (transformDuplicateId === undefined) return;
    console.warn(
      groupMessages
        ? `[CopilotKit] CopilotChatMessageView: the message with id "${transformDuplicateId}" renders more than once. ` +
            "`groupMessages` should place each message in at most one row, and `transformMessages` return each id at most once."
        : `[CopilotKit] CopilotChatMessageView: \`transformMessages\` returned more than one message with id "${transformDuplicateId}". ` +
            "Return each id at most once; a message you create needs its own id, stable across renders.",
    );
  }, [transformDuplicateId, groupMessages]);

  // Group keys are React keys and state keys, so two groups sharing one would
  // share both.
  const duplicateGroupKey = useMemo(() => {
    if (process.env.NODE_ENV === "production" || !groupMessages) return;
    const seen = new Set<string>();
    for (const row of rows) {
      if (row.type !== "group") continue;
      if (seen.has(row.key)) return row.key;
      seen.add(row.key);
    }
  }, [rows, groupMessages]);
  useEffect(() => {
    if (duplicateGroupKey === undefined) return;
    console.warn(
      `[CopilotKit] CopilotChatMessageView: \`groupMessages\` returned more than one group with key "${duplicateGroupKey}". ` +
        "Give each group its own key, stable across renders.",
    );
  }, [duplicateGroupKey]);

  // Stable per-row React keys. Backends can re-key a message mid-stream, and
  // keying rows by the canonical id remounts the row on that swap (the HITL
  // chat flash). See @copilotkit/shared row-render-keys for the mechanism.
  const rowKeyStoreRef = useRef<RowKeyStore | null>(null);
  rowKeyStoreRef.current ??= createRowKeyStore();
  const rowKeyStore = rowKeyStoreRef.current;

  const rowRenderKeys = useMemo(
    () => resolveRowRenderKeysById(rowKeyStore, renderedMessages),
    [rowKeyStore, renderedMessages],
  );

  // Record what this commit rendered, never what a render merely proposed: an
  // anchor from a render React goes on to abandon would re-key a committed row
  // and remount it. Layout phase, so the store is current before any later
  // render reads it.
  useLayoutEffect(() => {
    commitRowKeyStore(rowKeyStore, renderedMessages);
  }, [rowKeyStore, renderedMessages]);

  // A group's key, made stable the same way: a key that is a message id (the
  // documented choice is the group's first message) resolves through
  // `rowRenderKeys`, so a backend renaming that message mid-stream neither
  // remounts the group nor loses its state.
  const stableGroupKey = (key: string): string => rowRenderKeys.get(key) ?? key;

  // State each group's wrapper keeps here rather than in itself, so it
  // survives the row being windowed out and the wrapper remounting. Cleared
  // when the thread changes; pruned to the groups still on the list. One
  // setter per group, kept with its state, so a wrapper that depends on
  // `setState` in an effect or memo sees the same function every render.
  const groupStateRef = useRef<Map<string, unknown>>(new Map());
  const groupSettersRef = useRef<Map<string, (next: unknown) => void>>(
    new Map(),
  );
  const groupStateThreadRef = useRef(config?.threadId);
  if (groupStateThreadRef.current !== config?.threadId) {
    groupStateThreadRef.current = config?.threadId;
    groupStateRef.current = new Map();
    groupSettersRef.current = new Map();
  }
  const groupSetter = (key: string): ((next: unknown) => void) => {
    let setter = groupSettersRef.current.get(key);
    if (!setter) {
      setter = (next) => {
        groupStateRef.current.set(key, next);
        forceUpdate();
      };
      groupSettersRef.current.set(key, setter);
    }
    return setter;
  };
  useLayoutEffect(() => {
    const live = new Set<string>();
    for (const row of rows) {
      if (row.type === "group") live.add(stableGroupKey(row.key));
    }
    for (const store of [groupStateRef.current, groupSettersRef.current]) {
      for (const key of store.keys()) if (!live.has(key)) store.delete(key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stableGroupKey reads rowRenderKeys
  }, [rows, rowRenderKeys]);

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
  const agentId = config?.agentId;
  const threadId = config?.threadId;
  const assistantSlotPropsWithFeedback = useMemo(() => {
    const onThumbsUp = assistantSlotProps?.onThumbsUp as
      | ((message: CopilotChatFeedbackMessage) => void)
      | undefined;
    const onThumbsDown = assistantSlotProps?.onThumbsDown as
      | ((message: CopilotChatFeedbackMessage) => void)
      | undefined;
    if (!onThumbsUp && !onThumbsDown) return assistantSlotProps;

    const withRawEvent = (
      message: AssistantMessage,
    ): CopilotChatFeedbackMessage => {
      const rawEvent =
        agentId === undefined || threadId === undefined
          ? undefined
          : copilotkit.getRawEventForMessage(agentId, threadId, message.id);
      return rawEvent === undefined ? message : { ...message, rawEvent };
    };

    return {
      ...assistantSlotProps,
      ...(onThumbsUp && {
        onThumbsUp: (message: AssistantMessage) =>
          onThumbsUp(withRawEvent(message)),
      }),
      ...(onThumbsDown && {
        onThumbsDown: (message: AssistantMessage) =>
          onThumbsDown(withRawEvent(message)),
      }),
    };
  }, [assistantSlotProps, agentId, threadId, copilotkit]);
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
    renderedMessages.length > VIRTUALIZE_THRESHOLD;

  // Warn once in dev when the `children` render prop is the only thing keeping
  // a long thread off the virtual path. Nothing else signals it: the chat just
  // mounts every message and gets slower as the thread grows.
  const childrenDisabledVirtualization =
    !!children &&
    !!scrollElement &&
    renderedMessages.length > VIRTUALIZE_THRESHOLD;
  const warnedChildrenRef = useRef(false);
  useEffect(() => {
    if (
      process.env.NODE_ENV === "production" ||
      !childrenDisabledVirtualization ||
      warnedChildrenRef.current
    ) {
      return;
    }
    warnedChildrenRef.current = true;
    console.warn(
      `[CopilotKit] CopilotChatMessageView: the \`children\` render prop disables virtualization, ` +
        `so all ${renderedMessages.length} messages are mounted. ` +
        (transformMessages || groupMessages
          ? "`transformMessages` and `groupMessages` keep virtualization on by themselves; drop `children` to use them."
          : "To reshape the list and keep virtualization, use `transformMessages` instead, or `groupMessages` to render several messages as one row."),
    );
  }, [
    childrenDisabledVirtualization,
    renderedMessages.length,
    transformMessages,
  ]);

  // Mean of the rows measured so far in this thread, used as the estimate for
  // rows that have not been measured yet. A flat 100 px estimate is off by
  // roughly an order of magnitude for a message carrying a code block, so the
  // total size lurches every time such a row is measured; an estimate drawn
  // from this thread's own rows keeps those corrections small.
  //
  // Sizes are kept per row rather than as a running sum because a row is
  // re-measured every time its ResizeObserver fires — a streaming message
  // reports a new height on every chunk — and treating each of those as a
  // fresh sample would drag the mean toward whatever that one row happened to
  // be mid-stream. Held in a ref because feeding it back through state would
  // re-render on every measure.
  const measuredRef = React.useRef({
    total: 0,
    sizes: new Map<number, number>(),
  });

  // The measurements describe one thread, so drop them when the thread
  // changes (detected by the first message ID changing, same as the
  // scroll-to-bottom effect below). Done during render rather than in that
  // effect because rows are measured from ref callbacks, which run before
  // layout effects — resetting there would discard the new thread's first
  // measurements instead of the old thread's. Read from the untransformed
  // list: a transform that hides or reorders the head is not a thread change.
  const firstMessageId = deduplicatedMessages[0]?.id;
  const measuredThreadRef = React.useRef(firstMessageId);
  if (measuredThreadRef.current !== firstMessageId) {
    measuredThreadRef.current = firstMessageId;
    measuredRef.current = { total: 0, sizes: new Map() };
  }

  const estimateRowSize = React.useCallback(() => {
    const { total, sizes } = measuredRef.current;
    return sizes.size > 0 ? Math.max(1, Math.round(total / sizes.size)) : 100;
  }, []);

  const measureRowElement = React.useCallback((el: Element) => {
    const height = el?.getBoundingClientRect().height ?? 0;
    // `data-index` is set on every virtual row below, and is what the
    // virtualizer itself uses to identify a measured element.
    const index = Number((el as HTMLElement | null)?.dataset?.index);
    if (height > 0 && Number.isInteger(index)) {
      const { total, sizes } = measuredRef.current;
      measuredRef.current.total = total - (sizes.get(index) ?? 0) + height;
      sizes.set(index, height);
    }
    return height;
  }, []);

  const isPinnedToBottomRef = React.useRef(isPinnedToBottom);
  const shouldAdjustScrollOnResize = React.useCallback(
    (
      item: VirtualItem,
      _delta: number,
      instance: Virtualizer<HTMLElement, Element>,
    ) => {
      // While the pin is following the bottom it owns the scroll position;
      // compensating as well is what makes the two fight (see below).
      if (isPinnedToBottomRef.current) return false;
      // Otherwise keep the rule this property replaces rather than
      // compensating for every resize: only a row starting above the current
      // scroll offset can shift what the reader is looking at when it
      // changes size. Moving the scroll position for a row *below* the
      // viewport — an overscanned row settling, say — is the same unwanted
      // motion, just in the other direction. `scrollAdjustments` is not on
      // the public type but is part of that rule; leaving it out would drop
      // the corrections already applied.
      const scrollAdjustments =
        (instance as unknown as { scrollAdjustments?: number })
          .scrollAdjustments ?? 0;
      return item.start < (instance.scrollOffset ?? 0) + scrollAdjustments;
    },
    [],
  );

  const virtualizer = useVirtualizer({
    // count=0 disables the virtualizer without changing hook call order.
    count: shouldVirtualize ? rows.length : 0,
    getScrollElement: () => scrollElement,
    estimateSize: estimateRowSize,
    overscan: 5,
    measureElement: measureRowElement,
    // Assume a 600 px viewport before the real element is measured so that
    // the first virtual render shows ~6 items rather than 0.
    initialRect: { width: 0, height: 600 },
  });

  // While the pin-to-bottom behaviour is following the bottom it is already
  // going to move the scroll position, and its ResizeObserver reads our
  // total-size changes as content growth. Compensating here as well makes the
  // two fight: each correction triggers an animation, the animation pulls
  // unmeasured rows into view, measuring them moves the total again. Stand
  // down while it is pinned; keep compensating when the reader has scrolled
  // up, which is the case the compensation is actually for.
  //
  // This is an instance property on the virtualizer rather than one of its
  // options, so it has to be assigned. Assigned during render (not in an
  // effect) because a row can be measured before effects run. The read goes
  // through a ref so the assigned function stays referentially stable.
  isPinnedToBottomRef.current = isPinnedToBottom;
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange =
    shouldAdjustScrollOnResize;

  // Scroll to the bottom when virtual mode first activates or the thread changes
  // (detected by the first message ID changing). For streaming new messages,
  // use-stick-to-bottom handles auto-scroll via content height growth detection
  // on the virtualizer's total-size div — same as the flat path. Adding
  // renderedMessages.length here would forcibly yank the user to the bottom
  // on every streaming chunk even if they've scrolled up to read history.
  useLayoutEffect(() => {
    if (!shouldVirtualize || !rows.length) return;
    virtualizer.scrollToIndex(rows.length - 1, {
      align: "end",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldVirtualize, firstMessageId]);

  // Map each Intelligence-using turn's anchor message → stable turn id. One
  // indicator is emitted per turn (keyed by the turn id) at its anchor, so it
  // moves with the anchor without remounting. `getIntelligenceTurnAnchors`
  // only yields anchors for turns that invoked the knowledge-base tool, so
  // non-Intelligence turns naturally produce an empty map (and the indicator
  // itself also hard-gates on intelligence mode).
  const intelligenceTurnAnchors = useMemo(
    () => getIntelligenceTurnAnchors(deduplicatedMessages, renderedMessages),
    [deduplicatedMessages, renderedMessages],
  );

  // ---------------------------------------------------------------------------
  // Per-message rendering helper (shared by flat and virtual paths)
  // ---------------------------------------------------------------------------
  const renderMessageBlock = (message: Message): React.ReactElement[] => {
    const elements: (React.ReactElement | null | undefined)[] = [];
    // Only custom message renderers consume the snapshot, and resolving it
    // deep-clones the agent's whole state (LangGraph's includes the `messages`
    // channel). Computing it unconditionally cost one clone per message per
    // render even when no renderer was registered.
    const stateSnapshot = renderCustomMessage
      ? getStateSnapshotForMessage(message.id)
      : undefined;
    // Row key only — everything keyed to message identity (state snapshots,
    // tool lookups) must keep using message.id.
    const rowKey = rowRenderKeys.get(message.id) ?? message.id;

    if (renderCustomMessage) {
      elements.push(
        <MemoizedCustomMessage
          key={`${rowKey}-custom-before`}
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
          key={rowKey}
          message={message as AssistantMessage}
          messages={messages}
          isRunning={isRunning}
          isLatest={message.id === latestRenderedId}
          AssistantMessageComponent={AssistantComponent}
          slotProps={assistantSlotPropsWithFeedback}
        />,
      );
    } else if (message.role === "user") {
      elements.push(
        <MemoizedUserMessage
          key={rowKey}
          message={message as UserMessage}
          UserMessageComponent={UserComponent}
          slotProps={userSlotProps}
        />,
      );
    } else if (message.role === "activity") {
      elements.push(
        <MemoizedActivityMessage
          key={rowKey}
          message={message as ActivityMessage}
          renderActivityMessage={renderActivityMessage}
        />,
      );
    } else if (message.role === "reasoning") {
      elements.push(
        <MemoizedReasoningMessage
          key={rowKey}
          message={message as ReasoningMessage}
          messages={messages}
          isRunning={isRunning}
          isLatest={message.id === latestRenderedId}
          ReasoningMessageComponent={ReasoningComponent}
          slotProps={reasoningSlotProps}
        />,
      );
    }

    if (renderCustomMessage) {
      elements.push(
        <MemoizedCustomMessage
          key={`${rowKey}-custom-after`}
          message={message}
          position="after"
          renderCustomMessage={renderCustomMessage}
          stateSnapshot={stateSnapshot}
        />,
      );
    }

    // Auto-mount the IntelligenceIndicator once per Intelligence-using turn,
    // at that turn's anchor message (its first bash-using assistant), keyed by
    // the stable turn id. Keying by turn (not message) means the indicator
    // moves with the anchor across a hand-off without remounting, and past
    // turns keep their own indicator.
    const intelligenceTurnId = showIntelligenceIndicator
      ? intelligenceTurnAnchors.get(message.id)
      : undefined;
    if (intelligenceTurnId !== undefined) {
      elements.push(
        <IntelligenceIndicator
          key={`intelligence-${intelligenceTurnId}`}
          message={message}
          agentId={config?.agentId ?? DEFAULT_AGENT_ID}
          intelligenceIndicator={intelligenceIndicator}
        />,
      );
    }

    return elements.filter(Boolean) as React.ReactElement[];
  };

  const rowKey = (row: MessageRow): string =>
    row.type === "group"
      ? `${GROUP_ROW_KEY_PREFIX}${stableGroupKey(row.key)}`
      : (rowRenderKeys.get(row.message.id) ?? row.message.id);

  const renderRow = (row: MessageRow): React.ReactElement[] => {
    if (row.type === "message") return renderMessageBlock(row.message);
    const Wrapper = row.wrapper;
    const stateKey = stableGroupKey(row.key);
    return [
      <Wrapper
        key={rowKey(row)}
        groupKey={row.key}
        messages={row.messages}
        state={groupStateRef.current.get(stateKey)}
        setState={groupSetter(stateKey)}
      >
        {row.messages.flatMap(renderMessageBlock)}
      </Wrapper>,
    ];
  };

  // Build the flat element list only when we're not virtualizing (avoids
  // creating 500 React elements that we'd immediately discard).
  const messageElements: React.ReactElement[] = shouldVirtualize
    ? []
    : rows.flatMap(renderRow);

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

  // Hide the chat-level loading cursor when the last rendered message is a
  // reasoning message — the reasoning card already shows its own loading
  // indicator. A reasoning message the transform hid shows no indicator.
  const lastMessage = renderedMessages[renderedMessages.length - 1];
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
            const row = rows[virtualItem.index]!;
            return (
              <div
                key={rowKey(row)}
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
                {renderRow(row)}
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
