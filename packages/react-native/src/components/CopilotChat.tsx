import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
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
} from "@copilotkit/react-core/v2/headless";
import { useCopilotKit } from "@copilotkit/react-core/v2/context";
import { AssistantMessage } from "./messages/AssistantMessage";
import { UserMessage } from "./messages/UserMessage";
import type { Message } from "@copilotkit/shared";
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
  /** Suggestion pills shown in the empty state. */
  initialMessages?: string[];
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
  /** Style override for the message list container. */
  messageContainerStyle?: ViewStyle;
  /** Style override for the input bar container. */
  inputContainerStyle?: ViewStyle;
  /** Callback fired when the user sends a message. */
  onSendMessage?: (text: string) => void;
  /** Custom FlatList component (e.g. BottomSheetFlatList for use inside a bottom sheet). */
  FlatListComponent?: React.ComponentType<any>;
  /** When true, skip the KeyboardAvoidingView wrapper (useful when a parent already handles keyboard). */
  disableKeyboardAvoiding?: boolean;
}

interface ChatListItem {
  id: string;
  type: "user" | "assistant" | "tool-call" | "loading";
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
 * `agent.messages` is mutated IN PLACE and its identity is NOT a change signal:
 * core inserts tool results with `agent.messages.splice(...)`, `addMessage()`
 * pushes, the AG-UI apply pipeline reuses one array for a whole run, and
 * `useAgent` re-renders with a bare `forceUpdate()`. So anything derived from
 * messages must depend on their CONTENT, not on the array reference.
 *
 * Captures exactly what the derivations below read — id, role, content size,
 * `toolCallId` (so an inserted tool result is visible), and each tool call's id
 * plus argument length (so streaming args advance). Content LENGTH rather than
 * value, mirroring react-core's web `messagesMemoKey`, so large text or base64
 * attachment payloads are never re-serialized on every render.
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
 * that case too (`normalizeToolResultContent` in run-handler accepts `unknown`
 * and handles arrays of text parts), so this must not answer it with `""`:
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
  emptyStateTitle = "How can I help?",
  emptyStateSubtitle = "Ask me anything or try a suggestion below.",
  headerTitle = "Chat",
  showHeader = true,
  style,
  messageContainerStyle,
  inputContainerStyle,
  onSendMessage,
  FlatListComponent = FlatList,
  disableKeyboardAvoiding = false,
}: CopilotChatProps) {
  const [inputText, setInputText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const messageIdCounter = useRef(0);

  const { copilotkit } = useCopilotKit();
  const { agent } = useAgent({ agentId: agentName });

  const messages = agent.messages ?? [];
  const isRunning = agent.isRunning;

  const renderToolCall = useRenderToolCall();

  // Recomputed every render — cheap, and the only honest dependency for the
  // message-derived memos below. See `messagesFingerprint` for why the array
  // reference cannot be used.
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

  // Stable extraData for FlatList: the exact inputs renderItem reads, so a
  // change forces a row re-render. Must describe what renderItem actually uses.
  const extraData = useMemo(
    () => ({ isRunning, renderToolCall, toolMessages }),
    [isRunning, renderToolCall, toolMessages],
  );

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
              toolCalls: [tc],
            });
          }
        }
      }
    }

    // Show loading indicator when agent is running and the last message
    // is not already the assistant streaming
    if (isRunning) {
      const lastItem = items[items.length - 1];
      if (!lastItem || lastItem.type !== "assistant") {
        items.push({ id: "__loading__", type: "loading" });
      }
    }

    return items;
    // Same reasoning as `toolMessages`: keyed on message CONTENT, because the
    // array reference is stable across in-place mutation. Without this, an
    // assistant message or tool call appended mid-run never reaches the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messagesKey, isRunning]);

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

  // Handle suggestion pill press
  const handleSuggestion = useCallback(
    (text: string) => {
      void sendMessage(text);
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
            isLoading={
              isRunning && item.id === listItems[listItems.length - 1]?.id
            }
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

        // Subtle indicator for unregistered tool calls
        return (
          <View style={styles.toolCallIndicator}>
            <Text style={styles.toolCallText}>Called: {tc.function.name}</Text>
          </View>
        );
      }

      if (item.type === "loading") {
        return <AssistantMessage content="" isLoading />;
      }

      return null;
    },
    [isRunning, listItems, renderToolCall, toolMessages],
  );

  const keyExtractor = useCallback((item: ChatListItem) => item.id, []);

  // Empty state component
  const emptyComponent = useMemo(
    () => (
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>{emptyStateTitle}</Text>
        <Text style={styles.emptySubtitle}>{emptyStateSubtitle}</Text>
        {initialMessages.map((suggestion, i) => (
          <Pressable
            key={`suggestion-${i}`}
            style={styles.suggestionPill}
            onPress={() => handleSuggestion(suggestion)}
          >
            <Text style={styles.suggestionText}>{suggestion}</Text>
          </Pressable>
        ))}
      </View>
    ),
    [emptyStateTitle, emptyStateSubtitle, initialMessages, handleSuggestion],
  );

  const sendDisabled = !inputText.trim() || isRunning;

  const content = (
    <>
      {showHeader && (
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{headerTitle}</Text>
        </View>
      )}

      <FlatListComponent
        ref={flatListRef}
        data={listItems}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        extraData={extraData}
        contentContainerStyle={[styles.messageList, messageContainerStyle]}
        onContentSizeChange={handleContentSizeChange}
        ListEmptyComponent={emptyComponent}
      />

      {error && (
        <View style={styles.errorContainer} testID="error-message">
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <View style={[styles.inputContainer, inputContainerStyle]}>
        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder={placeholder}
          placeholderTextColor="#999"
          multiline
          numberOfLines={4}
          returnKeyType="send"
          onSubmitEditing={handleSend}
        />
        <TouchableOpacity
          style={[styles.sendButton, sendDisabled && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={sendDisabled}
          testID="send-button"
        >
          <Text style={styles.sendButtonIcon}>{"↑"}</Text>
        </TouchableOpacity>
      </View>
    </>
  );

  if (disableKeyboardAvoiding) {
    return <View style={[styles.container, style]}>{content}</View>;
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, style]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      {content}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  header: {
    height: 56,
    justifyContent: "center",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E0E0E0",
    backgroundColor: "#FFFFFF",
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#1A1A1A",
  },
  messageList: {
    paddingHorizontal: 16,
    flexGrow: 1,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#E0E0E0",
    backgroundColor: "#FFFFFF",
  },
  input: {
    flex: 1,
    backgroundColor: "#F5F5F5",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    maxHeight: 100,
    color: "#1A1A1A",
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#0066CC",
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  sendButtonIcon: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 100,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1A1A1A",
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 15,
    color: "#666666",
    marginBottom: 16,
  },
  suggestionPill: {
    backgroundColor: "#E8F0FE",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  suggestionText: {
    color: "#0066CC",
    fontWeight: "600",
    fontSize: 14,
  },
  toolCallIndicator: {
    alignSelf: "flex-start",
    backgroundColor: "#F0F0F0",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 8,
  },
  toolCallText: {
    fontSize: 12,
    color: "#999999",
    fontStyle: "italic",
  },
  errorContainer: {
    backgroundColor: "#FEE2E2",
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginHorizontal: 8,
    borderRadius: 8,
  },
  errorText: {
    color: "#DC2626",
    fontSize: 13,
  },
});
