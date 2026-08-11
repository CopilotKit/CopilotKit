/**
 * Custom (headless) chat UI for the Personal Finance Copilot.
 *
 * Keeps the `useAgent` + `useCopilotKit` send loop, but renders the tool /
 * human-in-the-loop output INLINE in the message list and adds a receipt 📎
 * attach button to the input row.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * How tool & HITL render output surfaces in a custom chat (SDK mechanism)
 * ─────────────────────────────────────────────────────────────────────────
 * `useHumanInTheLoop` and `useFrontendTool({ render })` (both from
 * `@copilotkit/react-native`, re-exported from `@copilotkit/react-core/v2`)
 * register their render component on the `CopilotKitCoreReact` instance via
 * `copilotkit.addHookRenderToolCall({ name, args, agentId, render })`. The
 * merged list is exposed as `copilotkit.renderToolCalls` — an array of
 * `{ name, render, agentId? }` — and changes are broadcast through the
 * `onRenderToolCallsChanged` subscription.
 *
 * NOTE: this is a DIFFERENT registry from the RN-local `useRenderToolRegistry`
 * (which only the prebuilt `<CopilotChat>` UI consumes, and which is only
 * populated by the RN-local `useRenderTool`, NOT by `useHumanInTheLoop`). Our
 * HITL approval cards therefore live in `copilotkit.renderToolCalls`, so a
 * custom chat must read from THERE to surface them.
 *
 * For each assistant message tool call (`assistant.toolCalls[]`, each
 * `{ id, function: { name, arguments } }`) we:
 *   1. look up the renderer by `tc.function.name` in `copilotkit.renderToolCalls`;
 *   2. parse `tc.function.arguments` (JSON) into `args`;
 *   3. derive the `ToolCallStatus`:
 *        • Complete   → a `role: "tool"` message exists with
 *                       `toolCallId === tc.id` (the result is back). We pass its
 *                       `content` as `result`.
 *        • Executing  → `executingToolCallIds.has(tc.id)` (handler running /
 *                       HITL awaiting the user). The HITL wrapper injects the
 *                       bound `respond` in this state, so the <ApprovalCard>
 *                       Approve / Cancel / Edit buttons resume the agent.
 *        • InProgress → otherwise (args still streaming in).
 *   4. render `<render name toolCallId args status result />`.
 * The HITL render wrapper (in react-core's `useHumanInTheLoop`) reads exactly
 * these props and supplies `respond` itself, so we never construct `respond`.
 *
 * `executingToolCallIds` (from `useCopilotKit()`) is provider-level state that
 * updates on `onToolExecutionStart` / `onToolExecutionEnd`, so the message list
 * re-renders into/out of the Executing (approval) state automatically. We also
 * subscribe to `onRenderToolCallsChanged` so newly-registered renderers (e.g.
 * after a hot-reload) trigger a re-render.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { launchCamera, launchImageLibrary } from "react-native-image-picker";
import type { Asset, ImagePickerResponse } from "react-native-image-picker";
import { useAgent, useCopilotKit } from "@copilotkit/react-native";
import type { NativeFileInput } from "@copilotkit/react-native";
import { ToolCallStatus } from "@copilotkit/core";
import type { Message, ToolCall } from "@ag-ui/client";

import { useReceiptCapture } from "./copilot/receipt";
import { colors, radius, spacing } from "./components/theme";

const AGENT_ID = "default";

/** Soft green hairline for chips/the "New chat" button — sits between the
 * `accentSoft` fill and the `accent` text (Tailwind green-200). */
const CHIP_BORDER = "#BBF7D0";

/**
 * Tappable prompt chips. Static (hand-rolled) rather than driven by the SDK's
 * `useConfigureSuggestions`/`useSuggestions` engine: that engine's *dynamic*
 * mode spends an extra provider-agent LLM call per turn (flaky for a recorded
 * demo / Maestro run) and its *static* mode only re-evaluates availability on
 * config change, not on message change — awkward for "after first message"
 * follow-ups. Static chips wired into our own send loop are deterministic and
 * give us full control over the two placements below. (The SDK's own prebuilt
 * `<CopilotChat>` likewise hand-rolls its starter pills.)
 */
const STARTER_SUGGESTIONS = [
  "Where did my money go this month?",
  "Show me my balances",
  "How are my budgets doing?",
  "Add a $12 lunch on Amex",
] as const;

/** Follow-up chips shown at the bottom of an in-progress conversation. */
const FOLLOWUP_SUGGESTIONS = [
  "Break it down by category",
  "How am I tracking against budget?",
  "What were my biggest expenses?",
  "Set my dining budget to $400",
] as const;

/**
 * A wrapped row of tappable prompt chips. Used both in the empty state (starter
 * prompts) and as the conversation footer (follow-ups). Selecting a chip sends
 * its text through the same path as the input box.
 */
function SuggestionChips({
  suggestions,
  onSelect,
  disabled,
  centered,
  testIDPrefix,
}: {
  suggestions: readonly string[];
  onSelect: (text: string) => void;
  disabled?: boolean;
  centered?: boolean;
  testIDPrefix?: string;
}) {
  return (
    <View style={[styles.chipsWrap, centered && styles.chipsWrapCentered]}>
      {suggestions.map((text, i) => (
        <TouchableOpacity
          key={text}
          onPress={() => onSelect(text)}
          disabled={disabled}
          style={[styles.chip, disabled && styles.buttonDisabled]}
          accessibilityRole="button"
          accessibilityLabel={text}
          testID={testIDPrefix ? `${testIDPrefix}-${i}` : undefined}
        >
          <Text style={styles.chipText} numberOfLines={2}>
            {text}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

/** One rendered row in the chat transcript. */
type ChatItem =
  | { kind: "message"; id: string; role: "user" | "assistant"; content: string }
  | { kind: "tool"; id: string; toolCall: ToolCall }
  | { kind: "loading"; id: "__loading__" };

/** Narrowing helpers for the loosely-typed `agent.messages` array. */
function isAssistantWithToolCalls(
  msg: Message,
): msg is Message & { toolCalls: ToolCall[] } {
  return (
    msg.role === "assistant" &&
    Array.isArray((msg as { toolCalls?: unknown }).toolCalls)
  );
}

export function ChatScreen() {
  const [inputText, setInputText] = useState("");
  const [attaching, setAttaching] = useState(false);
  const flatListRef = useRef<FlatList<ChatItem>>(null);

  const { copilotkit, executingToolCallIds } = useCopilotKit();
  const { agent } = useAgent({ agentId: AGENT_ID });
  const receipt = useReceiptCapture();

  // Re-render when the set of registered tool-call renderers changes (e.g. a
  // tool mounts after first paint, or on hot reload). `renderToolCalls` is a
  // getter on the core instance; bumping this forces us to re-read it.
  const [, forceRerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const sub = copilotkit.subscribe({
      onRenderToolCallsChanged: () => forceRerender(),
    });
    return () => sub.unsubscribe();
  }, [copilotkit]);

  // `agent?.messages ?? []` would mint a fresh `[]` on every render, churning
  // the memos below; memoize so a stable identity flows into their deps.
  const messages: Message[] = useMemo(
    () => agent?.messages ?? [],
    [agent?.messages],
  );
  const isLoading = agent?.isRunning ?? false;

  // Map tool-call id -> its result message content, so a completed call can
  // show its resolved state (and hand `result` to the renderer).
  const toolResultById = useMemo(() => {
    const map = new Map<string, string>();
    for (const msg of messages) {
      if (msg.role === "tool") {
        const tm = msg as { toolCallId: string; content: string };
        map.set(tm.toolCallId, tm.content);
      }
    }
    return map;
  }, [messages]);

  // Renderer lookup by tool name from the CopilotKitCoreReact registry.
  const rendererByName = useMemo(() => {
    const map = new Map<
      string,
      (typeof copilotkit.renderToolCalls)[number]["render"]
    >();
    for (const entry of copilotkit.renderToolCalls) {
      // Last registration wins (matches core's merge semantics); scope to this
      // agent or globally-registered tools.
      if (!entry.agentId || entry.agentId === AGENT_ID) {
        map.set(entry.name, entry.render);
      }
    }
    return map;
    // `executingToolCallIds`/`messages` aren't deps of the registry itself, but
    // `forceRerender` re-runs this when renderers change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copilotkit, copilotkit.renderToolCalls]);

  // Flatten messages into renderable transcript items (text bubbles + one item
  // per tool call), mirroring the SDK's own CopilotChat list construction.
  const items = useMemo<ChatItem[]>(() => {
    const out: ChatItem[] = [];
    for (const msg of messages) {
      if (msg.role === "user") {
        const content = typeof msg.content === "string" ? msg.content : "";
        if (content) {
          out.push({ kind: "message", id: msg.id, role: "user", content });
        }
      } else if (msg.role === "assistant") {
        const content = typeof msg.content === "string" ? msg.content : "";
        if (content) {
          out.push({ kind: "message", id: msg.id, role: "assistant", content });
        }
        if (isAssistantWithToolCalls(msg)) {
          for (const tc of msg.toolCalls) {
            out.push({
              kind: "tool",
              id: `${msg.id}-tc-${tc.id}`,
              toolCall: tc,
            });
          }
        }
      }
    }
    if (isLoading) {
      const last = out[out.length - 1];
      if (!last || last.kind !== "message" || last.role !== "assistant") {
        out.push({ kind: "loading", id: "__loading__" });
      }
    }
    return out;
  }, [messages, isLoading]);

  /**
   * Send the current message. Accepts an optional `textOverride` for cases
   * where the caller has access to the native text but our controlled
   * `inputText` state might not yet be in sync — specifically, on iOS under
   * the New Architecture, programmatic UI drivers (e.g. Maestro) set the
   * UITextField's text directly without dispatching React Native's
   * `onChangeText`, so `inputText` stays empty. The TextInput's
   * `onSubmitEditing` event below passes `e.nativeEvent.text` through, which
   * works regardless of whether React state has caught up.
   */
  const handleSend = useCallback(
    async (textOverride?: string) => {
      const text = (textOverride ?? inputText).trim();
      if (!text || isLoading || !agent) return;

      setInputText("");
      agent.addMessage({
        id: `user-${Date.now()}`,
        role: "user",
        content: text,
      });
      try {
        await copilotkit.runAgent({ agent });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Something went wrong.";
        Alert.alert("Chat error", message);
      }
    },
    [inputText, isLoading, agent, copilotkit],
  );

  /**
   * Start a fresh conversation: abort any in-flight run, then clear the
   * transcript. `setMessages([])` swaps the agent's message array for an empty
   * one; `useAgent` re-renders us (the same path that streams messages in), so
   * the list falls back to its empty state with the starter chips.
   */
  const handleNewConversation = useCallback(() => {
    if (!agent) return;
    if (isLoading) agent.abortRun();
    agent.setMessages([]);
    setInputText("");
  }, [agent, isLoading]);

  // Whether there's anything to reset (drives the header "New" button's enabled
  // state): a non-empty transcript or an in-flight run.
  const canReset = messages.length > 0 || isLoading;

  // Follow-up chips, rendered as the list footer so they sit at the bottom of
  // the conversation. Hidden while empty (the empty state shows its own starter
  // chips) and while the agent is streaming (don't suggest mid-answer).
  const listFooter = useMemo(() => {
    if (messages.length === 0 || isLoading) return null;
    return (
      <View style={styles.footerChips}>
        <Text style={styles.footerLabel}>Try asking</Text>
        <SuggestionChips
          suggestions={FOLLOWUP_SUGGESTIONS}
          onSelect={handleSend}
          disabled={isLoading}
          testIDPrefix="followup-chip"
        />
      </View>
    );
  }, [messages.length, isLoading, handleSend]);

  // ── Receipt attach: pick/capture an image and feed it into the receipt flow ──
  const submitAsset = useCallback(
    async (asset: Asset | undefined) => {
      if (!asset?.uri) {
        Alert.alert(
          "Could not read image",
          "The selected image had no file URI.",
        );
        return;
      }
      const file: NativeFileInput = {
        uri: asset.uri,
        name: asset.fileName ?? `receipt-${Date.now()}.jpg`,
        size: asset.fileSize ?? 0,
        mimeType: asset.type ?? "image/jpeg",
      };
      try {
        // Parses via the runtime and stashes a draft the agent reads through
        // the `parseReceipt` tool; nudge the agent so it proposes a transaction.
        await receipt.captureReceiptFile(file);
        if (agent && !isLoading) {
          agent.addMessage({
            id: `user-${Date.now()}`,
            role: "user",
            content:
              "I attached a receipt photo. Parse it and propose a transaction.",
          });
          await copilotkit.runAgent({ agent });
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to process the receipt.";
        Alert.alert("Receipt error", message);
      }
    },
    [receipt, agent, isLoading, copilotkit],
  );

  const handlePickerResult = useCallback(
    async (res: ImagePickerResponse) => {
      if (res.didCancel) return;
      if (res.errorCode) {
        Alert.alert(
          "Image picker",
          res.errorMessage ?? `Could not open the picker (${res.errorCode}).`,
        );
        return;
      }
      await submitAsset(res.assets?.[0]);
    },
    [submitAsset],
  );

  const handleAttach = useCallback(() => {
    if (attaching || isLoading) return;
    // Offer camera vs library; both yield an Asset we map to NativeFileInput.
    Alert.alert("Attach receipt", "Add a receipt photo", [
      {
        text: "Take photo",
        onPress: async () => {
          setAttaching(true);
          try {
            const res = await launchCamera({
              mediaType: "photo",
              quality: 0.7,
              includeBase64: false,
            });
            await handlePickerResult(res);
          } finally {
            setAttaching(false);
          }
        },
      },
      {
        text: "Choose from library",
        onPress: async () => {
          setAttaching(true);
          try {
            const res = await launchImageLibrary({
              mediaType: "photo",
              quality: 0.7,
              selectionLimit: 1,
              includeBase64: false,
            });
            await handlePickerResult(res);
          } finally {
            setAttaching(false);
          }
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }, [attaching, isLoading, handlePickerResult]);

  const receiptParsing = receipt.status === "parsing" || attaching;

  const renderItem = useCallback(
    ({ item }: { item: ChatItem }) => {
      if (item.kind === "loading") {
        return (
          <View style={[styles.bubble, styles.assistantBubble]}>
            <ActivityIndicator size="small" color={colors.textMuted} />
          </View>
        );
      }

      if (item.kind === "message") {
        const isUser = item.role === "user";
        return (
          <View
            style={[
              styles.bubble,
              isUser ? styles.userBubble : styles.assistantBubble,
            ]}
          >
            <Text style={isUser ? styles.userText : styles.assistantText}>
              {item.content}
            </Text>
          </View>
        );
      }

      // Tool call → render its registered HITL/tool component inline.
      const tc = item.toolCall;
      const Renderer = rendererByName.get(tc.function.name);
      if (!Renderer) {
        // No render registered (e.g. a pure read tool) — show a quiet chip.
        return (
          <View style={styles.toolChip}>
            <Text style={styles.toolChipText}>Used {tc.function.name}</Text>
          </View>
        );
      }

      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}");
      } catch {
        // Args still streaming / malformed — render with empty args (InProgress).
      }

      const resultContent = toolResultById.get(tc.id);
      const status: ToolCallStatus =
        resultContent !== undefined
          ? ToolCallStatus.Complete
          : executingToolCallIds.has(tc.id)
            ? ToolCallStatus.Executing
            : ToolCallStatus.InProgress;

      // The HITL wrapper reads { name, toolCallId, args, status, result } and
      // injects `respond` itself in the Executing arm. The discriminated-union
      // prop type can't be expressed without the per-status narrowing the
      // wrapper does internally, so we hand it the runtime-correct shape.
      const RendererAny = Renderer as React.ComponentType<{
        name: string;
        toolCallId: string;
        args: Record<string, unknown>;
        status: ToolCallStatus;
        result: string | undefined;
      }>;
      return (
        <RendererAny
          name={tc.function.name}
          toolCallId={tc.id}
          args={args}
          status={status}
          result={resultContent}
        />
      );
    },
    [rendererByName, toolResultById, executingToolCallIds],
  );

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Assistant</Text>
        <TouchableOpacity
          onPress={handleNewConversation}
          disabled={!canReset}
          style={[styles.newButton, !canReset && styles.buttonDisabled]}
          accessibilityRole="button"
          accessibilityLabel="Start a new conversation"
          testID="new-conversation"
        >
          <Text style={styles.newButtonIcon}>＋</Text>
          <Text style={styles.newButtonText}>New chat</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        ref={flatListRef}
        data={items}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Ask your money anything 💬</Text>
            <Text style={styles.emptySubtitle}>
              Try one of these, type your own, or attach a receipt with 📎.
            </Text>
            <SuggestionChips
              suggestions={STARTER_SUGGESTIONS}
              onSelect={handleSend}
              disabled={isLoading}
              centered
              testIDPrefix="starter-chip"
            />
          </View>
        }
        ListFooterComponent={listFooter}
        onContentSizeChange={() =>
          flatListRef.current?.scrollToEnd({ animated: true })
        }
      />

      {receiptParsing ? (
        <View style={styles.statusRow}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={styles.statusText}>
            {attaching ? "Opening picker…" : "Reading your receipt…"}
          </Text>
        </View>
      ) : null}

      <View style={styles.inputRow}>
        <TouchableOpacity
          onPress={handleAttach}
          disabled={attaching || isLoading}
          style={[
            styles.attachButton,
            (attaching || isLoading) && styles.buttonDisabled,
          ]}
          accessibilityLabel="Attach a receipt photo"
        >
          <Text style={styles.attachIcon}>📎</Text>
        </TouchableOpacity>

        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Message your finance assistant…"
          placeholderTextColor={colors.textFaint}
          multiline
          // Without `submitBehavior`, a multiline TextInput's Enter key
          // inserts a newline rather than firing `onSubmitEditing`. Setting
          // "blurAndSubmit" lets Enter submit the message, which makes the
          // chat keyboard-friendly for humans AND lets programmatic UI
          // drivers (Maestro) submit prompts via `pressKey: Enter`. The
          // tradeoff is that users can no longer manually insert a newline;
          // chat prompts are short by design, so this is the right call here.
          submitBehavior="blurAndSubmit"
          onSubmitEditing={(e) => handleSend(e.nativeEvent.text)}
          editable={!isLoading}
        />

        <TouchableOpacity
          onPress={() => handleSend()}
          disabled={!inputText.trim() || isLoading}
          style={[
            styles.sendButton,
            (!inputText.trim() || isLoading) && styles.buttonDisabled,
          ]}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.sendText}>Send</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
  },
  headerTitle: { fontSize: 17, fontWeight: "700", color: colors.textPrimary },
  newButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
  },
  newButtonIcon: {
    color: colors.accent,
    fontSize: 15,
    fontWeight: "800",
    marginRight: 4,
  },
  newButtonText: { color: colors.accent, fontSize: 13, fontWeight: "700" },
  chipsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  chipsWrapCentered: { justifyContent: "center" },
  chip: {
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    maxWidth: "100%",
  },
  chipText: { color: colors.accent, fontSize: 13, fontWeight: "600" },
  footerChips: { marginTop: spacing.md, marginBottom: spacing.sm },
  footerLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textFaint,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: spacing.xs,
  },
  listContent: {
    padding: spacing.screen,
    paddingBottom: spacing.md,
    flexGrow: 1,
  },
  bubble: {
    maxWidth: "82%",
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    marginVertical: spacing.xs + 1,
  },
  userBubble: {
    alignSelf: "flex-end",
    backgroundColor: colors.accent,
    borderBottomRightRadius: radius.sm,
  },
  assistantBubble: {
    alignSelf: "flex-start",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: radius.sm,
  },
  userText: { color: "#FFFFFF", fontSize: 15, lineHeight: 21 },
  assistantText: { color: colors.textPrimary, fontSize: 15, lineHeight: 21 },
  toolChip: {
    alignSelf: "flex-start",
    backgroundColor: colors.track,
    borderRadius: radius.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    marginVertical: spacing.xs,
  },
  toolChipText: { color: colors.textMuted, fontSize: 12, fontWeight: "600" },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 20,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.screen,
    paddingBottom: spacing.xs,
  },
  statusText: {
    marginLeft: spacing.sm,
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: "600",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
  },
  attachButton: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.track,
    marginRight: spacing.sm,
  },
  attachIcon: { fontSize: 18 },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 40,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === "ios" ? spacing.sm + 2 : spacing.sm,
    fontSize: 15,
    color: colors.textPrimary,
    backgroundColor: colors.bg,
  },
  sendButton: {
    marginLeft: spacing.sm,
    height: 40,
    minWidth: 64,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  sendText: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
  buttonDisabled: { opacity: 0.5 },
});
