import React, { useCallback, useRef, useState } from "react";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useAgent,
  useCopilotKit,
  useFrontendTool,
} from "@copilotkit/react-native";
import { z } from "zod";
import { MeetingTimePicker } from "./MeetingTimePicker";
import type { MeetingTimePickerStatus } from "./MeetingTimePicker";
import { PieChart } from "./PieChart";
import { TaskManager } from "./TaskManager";

interface HitlState {
  status: MeetingTimePickerStatus;
  reason?: string;
  duration?: number;
  selectedSlot?: { date: string; time: string; duration: string } | null;
}

function generateThreadId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function ChatScreen() {
  const insets = useSafeAreaInsets();
  const [inputText, setInputText] = useState("");
  const [threadId, setThreadId] = useState(generateThreadId);
  const [isDark, setIsDark] = useState(false);
  const [appMode, setAppMode] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  const { copilotkit } = useCopilotKit();
  const { agent } = useAgent({ agentId: "default", threadId });

  const messages = agent?.messages ?? [];
  const isLoading = agent?.isRunning ?? false;

  const theme = isDark ? darkColors : lightColors;

  // ── Frontend Tool: Toggle Theme ────────────────────────────────────────
  useFrontendTool(
    {
      name: "toggleTheme",
      description: "Frontend tool for toggling the theme of the app.",
      parameters: z.object({}),
      handler: async () => {
        setIsDark((prev) => !prev);
      },
    },
    [isDark],
  );

  // ── Frontend Tool: Enable/Disable App Mode ──────────────────────────────
  useFrontendTool(
    {
      name: "enableAppMode",
      description:
        "Enable app mode, make sure its open when interacting with todos.",
      parameters: z.object({}),
      handler: async () => {
        setAppMode(true);
      },
    },
    [appMode],
  );

  useFrontendTool(
    {
      name: "enableChatMode",
      description: "Enable chat mode",
      parameters: z.object({}),
      handler: async () => {
        setAppMode(false);
      },
    },
    [appMode],
  );

  // ── Controlled Generative UI: Pie Chart ─────────────────────────────────
  const [charts, setCharts] = useState<
    Array<{
      id: string;
      title: string;
      description: string;
      data: Array<{ label: string; value: number }>;
    }>
  >([]);

  useFrontendTool({
    name: "pieChart",
    description:
      "Use this tool to display a pie chart in the chat. Pass a title, description, and data array with label/value pairs.",
    parameters: z.object({
      title: z.string().describe("Chart title"),
      description: z.string().describe("Brief description or subtitle"),
      data: z.array(
        z.object({
          label: z.string(),
          value: z.number(),
        }),
      ),
    }),
    handler: async (args) => {
      setCharts((prev) => [
        ...prev,
        { id: `chart-${Date.now()}`, ...args },
      ]);
      return "Pie chart rendered successfully.";
    },
  });

  // ── HITL: Schedule Meeting ──────────────────────────────────────────────
  const [hitl, setHitl] = useState<HitlState | null>(null);
  const respondRef = useRef<((result: string) => void) | null>(null);

  useFrontendTool({
    name: "scheduleTime",
    description: "Use human-in-the-loop to schedule a meeting with the user.",
    parameters: z.object({
      reasonForScheduling: z
        .string()
        .describe("Reason for scheduling, very brief - 5 words."),
      meetingDuration: z
        .number()
        .describe("Duration of the meeting in minutes"),
    }),
    handler: async (args) => {
      return new Promise<string>((resolve) => {
        respondRef.current = resolve;
        setHitl({
          status: "selecting",
          reason: args.reasonForScheduling,
          duration: args.meetingDuration,
        });
      });
    },
  });

  const handleHitlSelect = useCallback(
    (slot: { date: string; time: string; duration: string }) => {
      const result = `Meeting scheduled for ${slot.date} at ${slot.time} (${slot.duration}).`;
      respondRef.current?.(result);
      respondRef.current = null;
      setHitl((prev) =>
        prev ? { ...prev, status: "confirmed", selectedSlot: slot } : null,
      );
    },
    [],
  );

  const handleHitlDecline = useCallback(() => {
    respondRef.current?.(
      "The user declined all proposed meeting times. Please suggest alternative times or ask for their availability.",
    );
    respondRef.current = null;
    setHitl((prev) => (prev ? { ...prev, status: "declined" } : null));
  }, []);

  const handleNewThread = useCallback(() => {
    setThreadId(generateThreadId());
    setCharts([]);
    setHitl(null);
    setAppMode(false);
    respondRef.current = null;
    setInputText("");
  }, []);

  // ── Messages + inline cards as FlatList items ──────────────────────────
  const listItems = React.useMemo(() => {
    const filtered = messages.filter(
      (m: any) => m.role === "user" || (m.role === "assistant" && m.content),
    );
    const items: any[] = [
      ...filtered,
      ...charts.map((c) => ({ ...c, role: "chart" })),
    ];
    if (hitl) {
      items.push({ id: "__hitl__", role: "hitl" });
    }
    return items;
  }, [messages, charts, hitl]);

  // ── Send message ───────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || isLoading || !agent) {
      return;
    }
    setInputText("");
    agent.addMessage({
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
    });
    try {
      await copilotkit.runAgent({ agent });
    } catch (error) {
      console.error("CopilotKit runAgent failed:", error);
    }
  }, [inputText, isLoading, agent, copilotkit]);

  const sendSuggestion = useCallback(
    (text: string) => {
      if (isLoading || !agent) return;
      agent.addMessage({
        id: `user-${Date.now()}`,
        role: "user",
        content: text,
      });
      copilotkit.runAgent({ agent }).catch(console.error);
    },
    [isLoading, agent, copilotkit],
  );

  // ── Render items ───────────────────────────────────────────────────────
  const renderItem = useCallback(
    ({ item }: { item: any }) => {
      if (item.role === "chart") {
        return (
          <PieChart
            title={item.title}
            description={item.description}
            data={item.data}
            theme={theme}
          />
        );
      }

      if (item.role === "hitl" && hitl) {
        return (
          <MeetingTimePicker
            status={hitl.status}
            reason={hitl.reason}
            duration={hitl.duration}
            selectedSlot={hitl.selectedSlot}
            onSelect={handleHitlSelect}
            onDecline={handleHitlDecline}
          />
        );
      }

      const isUser = item.role === "user";
      const content = item.content ?? "";
      if (!content && item.role === "tool") return null;

      return (
        <View
          style={[
            styles.messageBubble,
            isUser
              ? [styles.userBubble, { backgroundColor: theme.primary }]
              : [styles.assistantBubble, { backgroundColor: theme.card }],
          ]}
        >
          <Text
            style={[
              styles.messageText,
              isUser ? styles.userText : { color: theme.text },
            ]}
          >
            {typeof content === "string" ? content : JSON.stringify(content)}
          </Text>
        </View>
      );
    },
    [hitl, handleHitlSelect, handleHitlDecline, theme],
  );

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.bg }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + 8, backgroundColor: theme.primary },
        ]}
      >
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.headerTitle}>CopilotKit Chat</Text>
            <Text style={styles.headerSubtitle}>
              React Native · Human in the Loop
            </Text>
          </View>
          <View style={styles.headerButtons}>
            {(agent?.state?.todos?.length > 0 || appMode) && (
              <TouchableOpacity
                style={styles.modeToggleButton}
                onPress={() => setAppMode((prev) => !prev)}
              >
                <Text style={styles.modeToggleText}>
                  {appMode ? "Chat" : "Tasks"}
                </Text>
              </TouchableOpacity>
            )}
            {messages.length > 0 && (
              <TouchableOpacity
                style={styles.newChatButton}
                onPress={handleNewThread}
              >
                <Text style={styles.newChatButtonText}>+ New Chat</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      {appMode && (
        <View
          style={[
            styles.taskManagerPanel,
            { borderBottomColor: theme.border },
          ]}
        >
          <TaskManager
            todos={agent?.state?.todos || []}
            onUpdate={(updatedTodos) => agent?.setState({ todos: updatedTodos })}
            isAgentRunning={isLoading}
            theme={theme}
          />
        </View>
      )}

      <FlatList
        ref={flatListRef}
        data={listItems}
        renderItem={renderItem}
        keyExtractor={(item: any, index: number) => item.id ?? String(index)}
        contentContainerStyle={styles.messageList}
        onContentSizeChange={() =>
          flatListRef.current?.scrollToEnd({ animated: true })
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={[styles.emptyText, { color: theme.muted }]}>
              Try one of the suggestions below
            </Text>
            <Pressable
              style={[styles.suggestionPill, { backgroundColor: theme.pillBg }]}
              onPress={() =>
                sendSuggestion(
                  "I'd like to schedule a 30-minute meeting to learn about CopilotKit. Please use the scheduleTime tool to let me pick a time.",
                )
              }
            >
              <Text style={[styles.suggestionText, { color: theme.primary }]}>
                Schedule Meeting (HITL)
              </Text>
            </Pressable>
            <Pressable
              style={[styles.suggestionPill, { backgroundColor: theme.pillBg }]}
              onPress={() =>
                sendSuggestion(
                  "Show me a pie chart of revenue distribution by category. Make up some realistic sample data, then render it with the pieChart component.",
                )
              }
            >
              <Text style={[styles.suggestionText, { color: theme.primary }]}>
                Pie Chart (Generative UI)
              </Text>
            </Pressable>
            <Pressable
              style={[styles.suggestionPill, { backgroundColor: theme.pillBg }]}
              onPress={() =>
                sendSuggestion(
                  "Toggle the app theme using the toggleTheme tool.",
                )
              }
            >
              <Text style={[styles.suggestionText, { color: theme.primary }]}>
                Toggle Theme (Frontend Tools)
              </Text>
            </Pressable>
            <Pressable
              style={[styles.suggestionPill, { backgroundColor: theme.pillBg }]}
              onPress={() =>
                sendSuggestion(
                  "Enable app mode and add three todos about learning CopilotKit: one about reading the docs, one about building a prototype, and one about exploring agent state.",
                )
              }
            >
              <Text style={[styles.suggestionText, { color: theme.primary }]}>
                Task Manager (Shared State)
              </Text>
            </Pressable>
          </View>
        }
      />

      {isLoading && (
        <View style={styles.loadingBar}>
          <Text style={[styles.loadingText, { color: theme.primary }]}>
            Thinking...
          </Text>
        </View>
      )}

      <View
        style={[
          styles.inputRow,
          {
            paddingBottom: insets.bottom + 8,
            backgroundColor: theme.inputBar,
            borderTopColor: theme.border,
          },
        ]}
      >
        <TextInput
          style={[
            styles.input,
            { backgroundColor: theme.inputBg, color: theme.text },
          ]}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Type a message..."
          placeholderTextColor={theme.muted}
          multiline
          returnKeyType="send"
          onSubmitEditing={handleSend}
        />
        <TouchableOpacity
          style={[
            styles.sendButton,
            { backgroundColor: theme.primary },
            isLoading && styles.sendButtonDisabled,
          ]}
          onPress={handleSend}
          disabled={isLoading || !inputText.trim()}
        >
          <Text style={styles.sendButtonText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ── Theme colors ──────────────────────────────────────────────────────────
const lightColors = {
  bg: "#f5f5f5",
  primary: "#6366f1",
  card: "#fff",
  text: "#1a1a1a",
  muted: "#999",
  border: "#e0e0e0",
  inputBar: "#fff",
  inputBg: "#f0f0f0",
  pillBg: "#e0e1ff",
};

const darkColors = {
  bg: "#121212",
  primary: "#818cf8",
  card: "#1e1e1e",
  text: "#e5e5e5",
  muted: "#777",
  border: "#2a2a2a",
  inputBar: "#1a1a1a",
  inputBg: "#2a2a2a",
  pillBg: "#2d2b4e",
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerTitle: { color: "#fff", fontSize: 20, fontWeight: "700" },
  headerSubtitle: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    marginTop: 2,
  },
  newChatButton: {
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  newChatButtonText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  messageList: { padding: 16, flexGrow: 1 },
  messageBubble: {
    maxWidth: "80%",
    padding: 12,
    borderRadius: 16,
    marginBottom: 8,
  },
  userBubble: {
    alignSelf: "flex-end",
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    alignSelf: "flex-start",
    borderBottomLeftRadius: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  messageText: { fontSize: 15, lineHeight: 21 },
  userText: { color: "#fff" },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingTop: 100,
    gap: 16,
  },
  emptyText: { fontSize: 16 },
  suggestionPill: {
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  suggestionText: { fontWeight: "600", fontSize: 14 },
  loadingBar: { paddingHorizontal: 16, paddingVertical: 6 },
  loadingText: { fontSize: 13, fontStyle: "italic" },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    maxHeight: 100,
  },
  sendButton: {
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginLeft: 8,
  },
  sendButtonDisabled: { opacity: 0.5 },
  sendButtonText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  headerButtons: { flexDirection: "row", alignItems: "center", gap: 8 },
  modeToggleButton: {
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  modeToggleText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  taskManagerPanel: {
    flex: 1,
    maxHeight: "55%",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
