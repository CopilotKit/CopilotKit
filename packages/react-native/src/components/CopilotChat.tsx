import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import type { ListRenderItemInfo, ViewStyle } from "react-native";
import {
  useAgent,
  useRenderToolCall,
  useSuggestions,
} from "@copilotkit/react-core/v2/headless";
import { useCopilotKit } from "@copilotkit/react-core/v2/context";
import { AssistantMessage } from "./messages/AssistantMessage";
import { ToolCallCard } from "./messages/ToolCallCard";
import { UserMessage } from "./messages/UserMessage";
import { IntroRise, introDelay, useReducedMotion } from "./motion";
import type { IntroMode } from "./motion";
import { SuggestionBar, SuggestionGrid } from "./Suggestions";
import {
  CopilotColorSchemeProvider,
  radius,
  useCopilotTheme,
  withOpacity,
} from "./theme";
import type { CopilotColorScheme } from "./theme";
import type { Message } from "@copilotkit/shared";
import type { Suggestion } from "@copilotkit/core";
import type { ToolMessage } from "@ag-ui/client";

/** Shape of an assistant message with optional tool calls. */
interface AssistantMessageShape {
  id: string;
  role: "assistant";
  content?: string;
  toolCalls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

export interface CopilotChatProps {
  /** Agent ID to connect to. Defaults to 'default'. */
  agentName?: string;
  /** Placeholder text for the input field. */
  placeholder?: string;
  /**
   * Suggestions shown as cards on the welcome screen, before the first
   * message. The agent's own suggestions (`useConfigureSuggestions`) join them
   * there, and appear as pills above the input during the conversation.
   */
  initialMessages?: string[];
  /**
   * Show the agent's suggestions (`useConfigureSuggestions`). Defaults to
   * `true`; set `false` when your app renders them itself. `initialMessages`
   * are shown either way.
   */
  showSuggestions?: boolean;
  /** Title shown when there are no messages. */
  emptyStateTitle?: string;
  /** Subtitle shown when there are no messages. */
  emptyStateSubtitle?: string;
  /** Title for the optional header bar. */
  headerTitle?: string;
  /** Whether to show the header bar. Defaults to true. */
  showHeader?: boolean;
  /** Style override for the outermost container. */
  style?: ViewStyle;
  /**
   * Style override for the content container of the message list, and of the
   * welcome screen before the first message.
   */
  messageContainerStyle?: ViewStyle;
  /** Style override for the input bar (the text field and send button). */
  inputContainerStyle?: ViewStyle;
  /** Callback fired when the user sends a message. */
  onSendMessage?: (text: string) => void;
  /** Custom FlatList component (e.g. BottomSheetFlatList for use inside a bottom sheet). */
  FlatListComponent?: React.ComponentType<any>;
  /**
   * Custom ScrollView component for the welcome screen (e.g.
   * BottomSheetScrollView for use inside a bottom sheet).
   */
  ScrollViewComponent?: React.ComponentType<any>;
  /** When true, skip the KeyboardAvoidingView wrapper (useful when a parent already handles keyboard). */
  disableKeyboardAvoiding?: boolean;
  /**
   * Ease the welcome screen in: the greeting, suggestion cards and input rise
   * into place in sequence. Defaults to `true`; set `false` to show them
   * immediately. Always off when the user prefers reduced motion.
   */
  introAnimation?: boolean;
  /**
   * While a reply streams, show the cursor at the end of its text, as if it
   * were being typed. Defaults to `true`; set `false` to keep the cursor below
   * the messages.
   */
  inlineCursor?: boolean;
  /**
   * `"light"` (the default), `"dark"`, or `"system"` to follow the device's
   * setting. Applies to everything the chat renders.
   */
  colorScheme?: CopilotColorScheme;
}

interface ChatListItem {
  id: string;
  type: "user" | "assistant" | "tool-call" | "loading";
  /** For a tool call: the assistant message that made it. */
  messageId?: string;
  content?: string;
  toolCalls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

/**
 * Lightweight content fingerprint for an agent's message list.
 *
 * The identity of `agent.messages` is NOT a reliable change signal, and it fails
 * in BOTH directions:
 *
 * - It changes on paths that have nothing to do with what is read below.
 *   `@ag-ui/client`'s apply pipeline REASSIGNS the array
 *   (`AbstractAgent.processApplyEvents` does `this.messages = applied.messages`),
 *   so a streaming run hands down a fresh array — and fresh message, `toolCall`
 *   and `function` objects — on every applied delta.
 * - It does NOT change on the paths these memos exist to serve. Core inserts
 *   tool results by mutating in place —
 *   `agent.messages.splice(insertAt, 0, toolMessage)`
 *   (packages/core/src/core/run-handler.ts:931, :1080) —
 *   `AbstractAgent.addMessage` is a `this.messages.push(...)`, and `useAgent`
 *   re-renders with a bare `forceUpdate()` rather than a new array.
 *
 * (Grepping `packages/core/src` for a `.messages` assignment finds test files
 * only, but that proves nothing about identity: the reassignment lives in
 * `@ag-ui/client`, outside that tree.)
 *
 * So anything derived from messages must depend on their CONTENT, not on the
 * array reference.
 *
 * Captures exactly what the derivations below read — id, role, content size,
 * `toolCallId` (so an inserted tool result is visible), and each tool call's id
 * plus argument length (so streaming args advance).
 *
 * String and array content contribute their LENGTH rather than their value, so
 * large text and base64 attachment payloads are never re-serialized on every
 * render. Object content is the deliberate exception and IS serialized: a
 * length-based key is a constant 0 for every object, so an in-place content
 * replacement that keeps the same message id would otherwise be invisible to
 * every memo below.
 *
 * That object branch is convergence, not a fix for a reachable stale render: the
 * producer of same-id object content is an ACTIVITY_SNAPSHOT replace, and
 * `role: "activity"` never reaches `listItems`, which builds rows for `user` and
 * `assistant` only. It follows the SHAPE of react-core's `messagesMemoKey`
 * (react-core #6325). The two are independent implementations of the same idea —
 * a change to that key does not propagate here on its own, so treat this as a
 * documented parallel rather than a mirror.
 */
function messagesFingerprint(messages: readonly unknown[]): string {
  return messages
    .map((msg) => {
      const m = msg as {
        id?: string;
        role?: string;
        content?: unknown;
        toolCallId?: string;
        toolCalls?: Array<{ id: string; function?: { arguments?: string } }>;
      };
      const content = m.content;
      const contentKey =
        typeof content === "string" || Array.isArray(content)
          ? content.length
          : content && typeof content === "object"
            ? objectContentKey(content)
            : 0;
      const toolCallsKey = Array.isArray(m.toolCalls)
        ? m.toolCalls
            .map((tc) => `${tc.id}:${tc.function?.arguments?.length ?? 0}`)
            .join(";")
        : "";
      return `${m.id}:${m.role}:${contentKey}:${m.toolCallId ?? ""}:${toolCallsKey}`;
    })
    .join(",");
}

/**
 * Serializes object content for the fingerprint above.
 *
 * Guarded because `JSON.stringify` THROWS on a circular structure and
 * `messagesFingerprint` runs on EVERY render, so a bare call would take the whole
 * chat down on content this component is explicitly required to tolerate —
 * `toolResultContent` below documents why non-string content reaches RN at all,
 * and "does not throw on tool content that cannot be JSON-serialised" pins that a
 * circular tool result must still render.
 *
 * The fallback is a constant, which means a circular object is invisible to the
 * memo exactly as every object used to be. That is the correct trade: it confines
 * the old always-equal behaviour to the pathological case instead of letting it
 * decide the common one. NOTE: this guard is a deliberate divergence from
 * react-core's `messagesMemoKey`, which stringifies unguarded.
 */
function objectContentKey(content: object): string {
  try {
    return JSON.stringify(content) ?? "";
  } catch {
    return "[unserializable]";
  }
}

/**
 * Coerces a tool message's `content` to the `string` the renderer contract
 * requires (`ReactToolCallRenderer`'s Complete branch declares `result: string`)
 * WITHOUT inventing an empty result.
 *
 * Tool content is a string by construction across the stack: `ToolMessageSchema`
 * declares `content: z.string()`, the SSE transport zod-parses every
 * TOOL_CALL_RESULT before it reaches `agent.messages`, and core stringifies
 * non-string handler results itself (`JSON.stringify(result)` in run-handler)
 * before inserting the tool message. Non-string content is only reachable from a
 * producer that skipped that validation — restored thread history, a non-SSE
 * transport, or app code casting on `addMessage`. Core hedges against exactly
 * that case too (core accepts `unknown` content and handles arrays of text
 * parts), so this must not answer it with `""`:
 * an empty string is a LEGITIMATE tool result, which makes a dropped result
 * indistinguishable from an empty one. Serialise faithfully — the same
 * representation core uses for non-string results — and warn in dev.
 */
function toolResultContent(content: unknown, toolCallId: string): string {
  if (typeof content === "string") return content;

  // null/undefined carry no payload, so "" loses nothing — but the message is
  // still malformed, so it warns below rather than passing silently.
  let serialized = "";
  if (content !== null && content !== undefined) {
    try {
      serialized =
        JSON.stringify(content) ?? Object.prototype.toString.call(content);
    } catch {
      // Circular or otherwise non-serialisable: keep SOMETHING over dropping
      // the result, and never throw from a render path.
      serialized = Object.prototype.toString.call(content);
    }
  }

  if (typeof __DEV__ === "undefined" || __DEV__) {
    console.warn(
      `[CopilotChat] Tool message for tool call "${toolCallId}" had non-string ` +
        `content (${content === null ? "null" : typeof content}), but renderers ` +
        `receive \`result: string\`. Rendering a serialized form instead of ` +
        `dropping it: ${serialized === "" ? "<empty>" : serialized}`,
    );
  }

  return serialized;
}

/**
 * Full-screen chat UI component for React Native.
 *
 * Connects to a CopilotKit agent via `useAgent` and renders messages
 * using platform-appropriate AssistantMessage / UserMessage components.
 *
 * Usage:
 * ```tsx
 * <CopilotChat agentName="my-agent" headerTitle="Assistant" />
 * ```
 */
export function CopilotChat({
  agentName = "default",
  placeholder = "Type a message...",
  initialMessages = [],
  showSuggestions = true,
  emptyStateTitle = "How can I help?",
  emptyStateSubtitle = "Ask me anything or try a suggestion below.",
  headerTitle = "Chat",
  showHeader = true,
  style,
  messageContainerStyle,
  inputContainerStyle,
  onSendMessage,
  FlatListComponent = FlatList,
  ScrollViewComponent = ScrollView,
  disableKeyboardAvoiding = false,
  introAnimation = true,
  inlineCursor = true,
  colorScheme,
}: CopilotChatProps) {
  const [inputText, setInputText] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const messageIdCounter = useRef(0);

  const theme = useCopilotTheme(colorScheme);
  const { copilotkit, executingToolCallIds } = useCopilotKit();
  const { agent } = useAgent({ agentId: agentName });
  const { suggestions: agentSuggestions } = useSuggestions({
    agentId: agentName,
  });

  const messages = agent.messages ?? [];
  const isRunning = agent.isRunning;

  const renderToolCall = useRenderToolCall();

  // Recomputed every render — cheap, and the only honest dependency for the
  // message-derived memos below. See `messagesFingerprint` for why the array
  // reference cannot be trusted as one.
  const messagesKey = messagesFingerprint(messages);

  // toolCallId -> tool result message. react-core's renderer reports
  // status "complete" with `result` when a tool message exists; RN's chat
  // previously never correlated these, so `result` was always undefined.
  const toolMessages = useMemo(() => {
    const byId = new Map<string, ToolMessage>();
    for (const msg of messages) {
      const m = msg as {
        role?: string;
        id?: string;
        toolCallId?: string;
        content?: unknown;
      };
      if (m.role === "tool" && m.toolCallId) {
        byId.set(m.toolCallId, {
          id: m.id ?? m.toolCallId,
          role: "tool",
          toolCallId: m.toolCallId,
          content: toolResultContent(m.content, m.toolCallId),
        });
      }
    }
    return byId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messagesKey]);

  // Build flat list items from messages
  const listItems: ChatListItem[] = useMemo(() => {
    const items: ChatListItem[] = [];

    for (const msg of messages) {
      if (msg.role === "user") {
        items.push({
          id: msg.id,
          type: "user",
          content: typeof msg.content === "string" ? msg.content : "",
        });
      } else if (msg.role === "assistant") {
        const assistantMsg = msg as AssistantMessageShape;
        // Add text content if present
        if (assistantMsg.content) {
          items.push({
            id: msg.id,
            type: "assistant",
            content: assistantMsg.content,
          });
        }
        // Add tool calls if present
        if (assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
          for (const tc of assistantMsg.toolCalls) {
            items.push({
              id: `${msg.id}-tc-${tc.id}`,
              type: "tool-call",
              messageId: msg.id,
              toolCalls: [tc],
            });
          }
        }
      }
    }

    // While the agent runs, a streaming reply carries the cursor at the end
    // of its text. Otherwise (waiting for the reply, running a tool, or with
    // `inlineCursor` off) it gets its own row below the messages.
    if (isRunning) {
      const lastItem = items[items.length - 1];
      if (!inlineCursor || lastItem?.type !== "assistant") {
        items.push({ id: "__loading__", type: "loading" });
      }
    }

    return items;
    // Same reasoning as `toolMessages`: keyed on message CONTENT, because the
    // array reference does not track content in either direction — core's
    // in-place `splice` and `addMessage`'s push leave it untouched, while the
    // AG-UI apply pipeline replaces it on every delta. Without this, an
    // assistant message or tool call appended mid-run never reaches the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messagesKey, isRunning, inlineCursor]);

  // Id of the trailing row. renderItem needs "is this the last row?" to place
  // the streaming indicator; deriving it here keeps that a named scalar instead
  // of renderItem closing over `listItems` and index-reading its tail.
  const lastItemId = useMemo(
    () => listItems[listItems.length - 1]?.id,
    [listItems],
  );

  // The current turn's latest assistant message: the only one whose tool
  // calls can still be running. An earlier call left without a result (an
  // interrupted run, say) must not spin again during later runs.
  const activeAssistantId = useMemo(() => {
    let id: string | undefined;
    for (const msg of messages) {
      if (msg.role === "assistant") id = msg.id;
      else if (msg.role === "user") id = undefined;
    }
    return id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messagesKey]);

  // extraData defeats FlatList's PureComponent shallow-compare for the values
  // renderItem CLOSES OVER, as opposed to the ones it receives per row. Those
  // are exactly the six below, and they mirror renderItem's dependency array —
  // keep the two in sync. `listItems` is deliberately absent: renderItem's only
  // read of it is the tail id, now passed as `lastItemId`, and the array itself
  // is already the `data` prop, which invalidates cells on its own (every
  // rebuild allocates fresh item objects, so each cell's `item` prop differs).
  const extraData = useMemo(
    () => ({
      activeAssistantId,
      executingToolCallIds,
      inlineCursor,
      isRunning,
      lastItemId,
      renderToolCall,
      toolMessages,
    }),
    [
      activeAssistantId,
      executingToolCallIds,
      inlineCursor,
      isRunning,
      lastItemId,
      renderToolCall,
      toolMessages,
    ],
  );

  // Shared logic for sending a message to the agent
  const sendMessage = useCallback(
    async (text: string) => {
      if (!text || isRunning || !agent) return;

      setError(null);
      onSendMessage?.(text);

      const id = `user-${++messageIdCounter.current}`;
      agent.addMessage({
        id,
        role: "user",
        content: text,
      } as Message);

      try {
        await copilotkit.runAgent({ agent });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "An unexpected error occurred";
        console.error("[CopilotChat] runAgent failed:", err);
        setError(message);
      }
    },
    [isRunning, agent, copilotkit, onSendMessage],
  );

  // Send from the input field
  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text) return;
    setInputText("");
    await sendMessage(text);
  }, [inputText, sendMessage]);

  // Handle suggestion card / pill press
  const handleSuggestion = useCallback(
    (suggestion: Suggestion) => {
      void sendMessage(suggestion.message);
    },
    [sendMessage],
  );

  // Auto-scroll when content changes
  const handleContentSizeChange = useCallback(() => {
    flatListRef.current?.scrollToEnd({ animated: true });
  }, []);

  // Render a single list item
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ChatListItem>) => {
      if (item.type === "user") {
        return <UserMessage content={item.content ?? ""} />;
      }

      if (item.type === "assistant") {
        return (
          <AssistantMessage
            content={item.content ?? ""}
            isLoading={inlineCursor && isRunning && item.id === lastItemId}
            inlineCursor={inlineCursor}
          />
        );
      }

      if (item.type === "tool-call" && item.toolCalls) {
        const tc = item.toolCalls[0];
        // Partial-parses streaming args, resolves the renderer (exact name ->
        // agent-scoped -> wildcard "*") and derives status — all in react-core,
        // shared with web. Returns ReactElement | null, which is what
        // renderItem requires.
        const rendered = renderToolCall({
          toolCall: tc,
          toolMessage: toolMessages.get(tc.id),
        });
        if (rendered) return <>{rendered}</>;

        // Compact card for unregistered tool calls. Frontend tool handlers run
        // after the agent run ends, so an executing call is running even then.
        return (
          <ToolCallCard
            name={tc.function.name}
            running={
              executingToolCallIds.has(tc.id) ||
              (isRunning &&
                item.messageId === activeAssistantId &&
                !toolMessages.has(tc.id))
            }
          />
        );
      }

      if (item.type === "loading") {
        return <AssistantMessage content="" isLoading />;
      }

      return null;
    },
    [
      activeAssistantId,
      executingToolCallIds,
      inlineCursor,
      isRunning,
      lastItemId,
      renderToolCall,
      toolMessages,
    ],
  );

  const keyExtractor = useCallback((item: ChatListItem) => item.id, []);

  // With no messages yet, the welcome screen centers the greeting, the
  // suggestion cards (the `initialMessages` prompts plus the agent's own) and
  // the input. In a conversation the agent's suggestions become pills above
  // the input, hidden while it runs.
  const isWelcome = listItems.length === 0;
  const shownAgentSuggestions = showSuggestions ? agentSuggestions : [];
  const welcomeSuggestions: Suggestion[] = [
    ...initialMessages.map((text) => ({
      title: text,
      message: text,
      isLoading: false,
    })),
    ...shownAgentSuggestions,
  ];
  const conversationSuggestions = isRunning ? [] : shownAgentSuggestions;

  // Only the welcome screen eases in; it waits (hidden) for the reduced-motion
  // setting before choosing whether to. Without an intro to play, the setting
  // isn't read and nothing starts hidden.
  const introEnabled = introAnimation && isWelcome;
  const reducedMotion = useReducedMotion(introEnabled);
  const introMode: IntroMode = !introEnabled
    ? "off"
    : reducedMotion === undefined
      ? "pending"
      : reducedMotion
        ? "off"
        : "play";

  const sendDisabled = !inputText.trim() || isRunning;

  // The body keeps the input at the same position on the welcome screen and in
  // the conversation, so it stays mounted (and focused) through the first send.
  const content = (
    <>
      {showHeader && (
        <View
          style={[
            styles.header,
            {
              backgroundColor: theme.background,
              borderBottomColor: theme.border,
            },
          ]}
        >
          <Text
            numberOfLines={1}
            style={[styles.headerTitle, { color: theme.foreground }]}
          >
            {headerTitle}
          </Text>
        </View>
      )}

      <View style={[styles.body, isWelcome && styles.welcomeBody]}>
        {isWelcome ? (
          // Scrolls when the greeting and cards don't fit above the input (a
          // small screen, or the keyboard open).
          <ScrollViewComponent
            style={styles.welcomeScroll}
            contentContainerStyle={[styles.welcome, messageContainerStyle]}
            keyboardShouldPersistTaps="handled"
          >
            <IntroRise mode={introMode} delay={introDelay.greeting}>
              <Text style={[styles.welcomeTitle, { color: theme.foreground }]}>
                {emptyStateTitle}
              </Text>
              {emptyStateSubtitle ? (
                <Text
                  style={[
                    styles.welcomeSubtitle,
                    { color: theme.mutedForeground },
                  ]}
                >
                  {emptyStateSubtitle}
                </Text>
              ) : null}
            </IntroRise>
            {welcomeSuggestions.length > 0 && (
              <SuggestionGrid
                suggestions={welcomeSuggestions}
                onSelect={handleSuggestion}
                introMode={introMode}
              />
            )}
          </ScrollViewComponent>
        ) : (
          <FlatListComponent
            ref={flatListRef}
            data={listItems}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            extraData={extraData}
            contentContainerStyle={[styles.messageList, messageContainerStyle]}
            onContentSizeChange={handleContentSizeChange}
          />
        )}

        {error && (
          <View
            style={[
              styles.errorContainer,
              { backgroundColor: withOpacity(theme.destructive, 0.1) },
            ]}
            testID="error-message"
          >
            <Text style={[styles.errorText, { color: theme.destructive }]}>
              {error}
            </Text>
          </View>
        )}

        {!isWelcome && conversationSuggestions.length > 0 && (
          <SuggestionBar
            suggestions={conversationSuggestions}
            onSelect={handleSuggestion}
          />
        )}

        <IntroRise
          mode={introMode}
          delay={introDelay.input}
          style={styles.inputContainer}
        >
          <View
            style={[
              styles.composer,
              {
                backgroundColor: theme.card,
                borderColor: inputFocused
                  ? withOpacity(theme.foreground, 0.2)
                  : theme.input,
              },
              inputContainerStyle,
            ]}
          >
            <TextInput
              style={[styles.input, { color: theme.foreground }]}
              value={inputText}
              onChangeText={setInputText}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              placeholder={placeholder}
              placeholderTextColor={theme.mutedForeground}
              multiline
              returnKeyType="send"
              onSubmitEditing={handleSend}
            />
            <TouchableOpacity
              style={[
                styles.sendButton,
                {
                  backgroundColor: sendDisabled
                    ? withOpacity(theme.foreground, 0.1)
                    : theme.primary,
                },
              ]}
              onPress={handleSend}
              disabled={sendDisabled}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Send message"
              testID="send-button"
            >
              <Text
                style={[
                  styles.sendButtonIcon,
                  {
                    color: sendDisabled
                      ? withOpacity(theme.foreground, 0.4)
                      : theme.primaryForeground,
                  },
                ]}
              >
                {"↑"}
              </Text>
            </TouchableOpacity>
          </View>
        </IntroRise>
      </View>
    </>
  );

  const containerStyle = [
    styles.container,
    { backgroundColor: theme.background },
    style,
  ];

  return (
    <CopilotColorSchemeProvider colorScheme={colorScheme}>
      {disableKeyboardAvoiding ? (
        <View style={containerStyle}>{content}</View>
      ) : (
        <KeyboardAvoidingView
          style={containerStyle}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={0}
        >
          {content}
        </KeyboardAvoidingView>
      )}
    </CopilotColorSchemeProvider>
  );
}

/** Messages, welcome content and the input stay readable on tablets. */
const MAX_CONTENT_WIDTH = 768;
/** The input grows to this many lines of text, then scrolls. */
const MAX_VISIBLE_LINES = 8;
const INPUT_LINE_HEIGHT = 24;
const INPUT_PADDING_VERTICAL = 6;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    height: 56,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: "600",
  },
  body: {
    flex: 1,
  },
  welcomeBody: {
    justifyContent: "center",
  },
  welcomeScroll: {
    // Content height, shrinking to scroll when space runs out.
    flexGrow: 0,
  },
  messageList: {
    flexGrow: 1,
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  welcome: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
    gap: 20,
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  welcomeTitle: {
    fontSize: 24,
    fontWeight: "600",
    letterSpacing: -0.4,
    textAlign: "center",
  },
  welcomeSubtitle: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    marginTop: 6,
  },
  inputContainer: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 12,
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    minHeight: 56,
    borderWidth: 1,
    borderRadius: radius["3xl"],
    paddingLeft: 18,
    paddingRight: 9,
    paddingVertical: 9,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 2,
  },
  input: {
    flex: 1,
    fontSize: 16,
    lineHeight: INPUT_LINE_HEIGHT,
    paddingHorizontal: 0,
    paddingVertical: INPUT_PADDING_VERTICAL,
    maxHeight:
      INPUT_LINE_HEIGHT * MAX_VISIBLE_LINES + INPUT_PADDING_VERTICAL * 2,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },
  sendButtonIcon: {
    fontSize: 18,
    fontWeight: "700",
  },
  errorContainer: {
    marginHorizontal: 16,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.lg,
  },
  errorText: {
    fontSize: 13,
  },
});
