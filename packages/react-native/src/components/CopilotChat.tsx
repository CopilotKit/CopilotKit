import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { useAgent, useRenderToolCall } from "@copilotkit/react-core/headless";
import { useCopilotKit } from "@copilotkit/react-core/context";
import {
  ɵcreateChatSubmitter,
  ɵgetToolResults,
  ɵmessagesFingerprint,
} from "@copilotkit/core";
import type { CopilotKitCore } from "@copilotkit/core";
import { AssistantMessage } from "./messages/AssistantMessage";
import { UserMessage } from "./messages/UserMessage";
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
 * The core as the chat's submitter takes it, with a failed run also passed to
 * `onRunError` so the chat can show it. The submitter logs the failure itself.
 */
function withRunErrorReporting(
  core: CopilotKitCore,
  onRunError: (message: string) => void,
): Parameters<typeof ɵcreateChatSubmitter>[0]["core"] {
  return {
    runAgent: async (params) => {
      try {
        return await core.runAgent(params);
      } catch (err) {
        onRunError(
          err instanceof Error ? err.message : "An unexpected error occurred",
        );
        throw err;
      }
    },
    stopAgent: (params) => core.stopAgent(params),
    // This chat does not transcribe, but the submitter's core type covers it.
    get runtimeUrl() {
      return core.runtimeUrl;
    },
    get runtimeTransport() {
      return core.runtimeTransport;
    },
    get credentials() {
      return core.credentials;
    },
    resolveHeaders: () => core.resolveHeaders(),
  };
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

  const { copilotkit } = useCopilotKit();
  const { agent } = useAgent({ agentId: agentName });

  const messages = agent.messages ?? [];
  const isRunning = agent.isRunning;

  const renderToolCall = useRenderToolCall();

  // useInterrupt publishes its element to core unless renderInChat is false.
  // Draw it after the last message, as the web message view does.
  const [interruptElement, setInterruptElement] =
    useState<React.ReactElement | null>(null);
  useEffect(() => {
    setInterruptElement(copilotkit.interruptElement);
    const subscription = copilotkit.subscribe({
      onInterruptElementChanged: ({ interruptElement: element }) => {
        setInterruptElement(element);
      },
    });
    return () => subscription.unsubscribe();
  }, [copilotkit]);

  // Recomputed every render: cheap, and the only honest dependency for the
  // message-derived memos below. The array reference does not track content
  // in either direction: core inserts tool results with an in-place `splice`,
  // `addMessage` pushes, and the AG-UI apply pipeline replaces the array on
  // every streamed delta.
  const messagesKey = ɵmessagesFingerprint(messages);

  // toolCallId -> tool result message, so a renderer reports "complete" with
  // its `result`.
  const toolMessages = useMemo(() => {
    const byId = new Map<string, ToolMessage>();
    for (const [toolCallId, message] of ɵgetToolResults(messages)) {
      // A copy, so the tool-call renderer's memo sees content that was
      // replaced in place on the same message. Core turns the content into
      // the renderer's `result` string.
      byId.set(toolCallId, { ...message });
    }
    return byId;
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- keyed on message content, see messagesKey
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
    // array reference does not track content in either direction — core's
    // in-place `splice` and `addMessage`'s push leave it untouched, while the
    // AG-UI apply pipeline replaces it on every delta. Without this, an
    // assistant message or tool call appended mid-run never reaches the list.
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- keyed on message content, see messagesKey
  }, [messagesKey, isRunning]);

  // Id of the trailing row. renderItem needs "is this the last row?" to place
  // the streaming indicator; deriving it here keeps that a named scalar instead
  // of renderItem closing over `listItems` and index-reading its tail.
  const lastItemId = useMemo(
    () => listItems[listItems.length - 1]?.id,
    [listItems],
  );

  // extraData defeats FlatList's PureComponent shallow-compare for the values
  // renderItem CLOSES OVER, as opposed to the ones it receives per row. Those
  // are exactly the four below, and they mirror renderItem's dependency array —
  // keep the two in sync. `listItems` is deliberately absent: renderItem's only
  // read of it is the tail id, now passed as `lastItemId`, and the array itself
  // is already the `data` prop, which invalidates cells on its own (every
  // rebuild allocates fresh item objects, so each cell's `item` prop differs).
  const extraData = useMemo(
    () => ({ isRunning, lastItemId, renderToolCall, toolMessages }),
    [isRunning, lastItemId, renderToolCall, toolMessages],
  );

  // The send side lives in core: it builds the message, waits for the run in
  // flight, and runs the agent. A failed run also shows under the list.
  const agentRef = useRef(agent);
  const inputTextRef = useRef(inputText);
  useLayoutEffect(() => {
    agentRef.current = agent;
    inputTextRef.current = inputText;
  });
  const [submitter] = useState(() =>
    ɵcreateChatSubmitter({
      core: withRunErrorReporting(copilotkit, setError),
      getAgent: () => agentRef.current,
      input: {
        get: () => inputTextRef.current,
        set: (value) => {
          inputTextRef.current = value;
          setInputText(value);
        },
      },
    }),
  );
  useEffect(() => () => submitter.showNotice(null), [submitter]);

  // Send from the input field
  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text) return;
    setError(null);
    onSendMessage?.(text);
    void submitter.submit(text);
  }, [inputText, onSendMessage, submitter]);

  // Handle suggestion pill press. Leaves the typed text alone.
  const handleSuggestion = useCallback(
    (text: string) => {
      setError(null);
      onSendMessage?.(text);
      void submitter.selectSuggestion({ message: text, isLoading: false });
    },
    [onSendMessage, submitter],
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
            isLoading={isRunning && item.id === lastItemId}
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
    [isRunning, lastItemId, renderToolCall, toolMessages],
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
        ListFooterComponent={interruptElement}
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
