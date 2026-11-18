import React, { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

interface Todo {
  id: string;
  title: string;
  description: string;
  emoji: string;
  status: "pending" | "completed";
}

interface Theme {
  bg: string;
  primary: string;
  card: string;
  text: string;
  muted: string;
  border: string;
}

interface TaskManagerProps {
  todos: Todo[];
  onUpdate: (todos: Todo[]) => void;
  isAgentRunning: boolean;
  theme: Theme;
}

const EMOJI_OPTIONS = ["✅", "🔥", "🎯", "💡", "🚀"];

function generateId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function TodoCard({
  todo,
  onToggleStatus,
  onDelete,
  onUpdateTitle,
  onUpdateDescription,
  onUpdateEmoji,
  theme,
}: {
  todo: Todo;
  onToggleStatus: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onUpdateDescription: (id: string, desc: string) => void;
  onUpdateEmoji: (id: string, emoji: string) => void;
  theme: Theme;
}) {
  const [editingField, setEditingField] = useState<
    "title" | "description" | null
  >(null);
  const [editValue, setEditValue] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const isCompleted = todo.status === "completed";

  const startEdit = (field: "title" | "description") => {
    setEditingField(field);
    setEditValue(field === "title" ? todo.title : todo.description);
  };

  const saveEdit = (field: "title" | "description") => {
    if (editValue.trim()) {
      if (field === "title") onUpdateTitle(todo.id, editValue.trim());
      else onUpdateDescription(todo.id, editValue.trim());
    }
    setEditingField(null);
  };

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.card,
          borderColor: theme.border,
          opacity: isCompleted ? 0.6 : 1,
        },
      ]}
    >
      <View style={styles.cardHeader}>
        <Pressable
          onPress={() => setShowEmojiPicker(!showEmojiPicker)}
          style={[styles.emojiButton, { backgroundColor: theme.bg }]}
        >
          <Text style={styles.emoji}>{todo.emoji}</Text>
        </Pressable>

        <View style={styles.cardActions}>
          <Pressable
            onPress={() => onToggleStatus(todo)}
            style={[
              styles.checkbox,
              {
                borderColor: theme.primary,
                backgroundColor: isCompleted ? theme.primary : "transparent",
              },
            ]}
          >
            {isCompleted && <Text style={styles.checkmark}>✓</Text>}
          </Pressable>
          <Pressable onPress={() => onDelete(todo)} style={styles.deleteButton}>
            <Text style={[styles.deleteText, { color: theme.muted }]}>✕</Text>
          </Pressable>
        </View>
      </View>

      {showEmojiPicker && (
        <View style={[styles.emojiPicker, { backgroundColor: theme.bg }]}>
          {EMOJI_OPTIONS.map((e) => (
            <Pressable
              key={e}
              onPress={() => {
                onUpdateEmoji(todo.id, e);
                setShowEmojiPicker(false);
              }}
              style={styles.emojiOption}
            >
              <Text style={styles.emojiOptionText}>{e}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {editingField === "title" ? (
        <TextInput
          style={[
            styles.titleInput,
            { color: theme.text, borderBottomColor: theme.primary },
          ]}
          value={editValue}
          onChangeText={setEditValue}
          onBlur={() => saveEdit("title")}
          onSubmitEditing={() => saveEdit("title")}
          autoFocus
        />
      ) : (
        <Pressable onPress={() => startEdit("title")}>
          <Text
            style={[
              styles.title,
              {
                color: theme.text,
                textDecorationLine: isCompleted ? "line-through" : "none",
              },
            ]}
          >
            {todo.title}
          </Text>
        </Pressable>
      )}

      {editingField === "description" ? (
        <TextInput
          style={[
            styles.descInput,
            { color: theme.muted, borderBottomColor: theme.primary },
          ]}
          value={editValue}
          onChangeText={setEditValue}
          onBlur={() => saveEdit("description")}
          multiline
          autoFocus
        />
      ) : (
        <Pressable onPress={() => startEdit("description")}>
          <Text
            style={[
              styles.description,
              {
                color: theme.muted,
                textDecorationLine: isCompleted ? "line-through" : "none",
              },
            ]}
          >
            {todo.description.length > 120
              ? todo.description.slice(0, 120) + "..."
              : todo.description}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function TodoSection({
  title,
  todos,
  showAddButton,
  onAddTodo,
  onToggleStatus,
  onDelete,
  onUpdateTitle,
  onUpdateDescription,
  onUpdateEmoji,
  isAgentRunning,
  theme,
}: {
  title: string;
  todos: Todo[];
  showAddButton?: boolean;
  onAddTodo?: () => void;
  onToggleStatus: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onUpdateDescription: (id: string, desc: string) => void;
  onUpdateEmoji: (id: string, emoji: string) => void;
  isAgentRunning: boolean;
  theme: Theme;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleRow}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>
            {title}
          </Text>
          <View style={[styles.badge, { backgroundColor: theme.primary }]}>
            <Text style={styles.badgeText}>{todos.length}</Text>
          </View>
        </View>
        {showAddButton && (
          <Pressable
            onPress={onAddTodo}
            disabled={isAgentRunning}
            style={[
              styles.addButton,
              {
                backgroundColor: theme.primary,
                opacity: isAgentRunning ? 0.5 : 1,
              },
            ]}
          >
            <Text style={styles.addButtonText}>+ Add</Text>
          </Pressable>
        )}
      </View>
      {todos.length === 0 ? (
        <Text style={[styles.emptySection, { color: theme.muted }]}>
          {title === "To Do" ? "No pending tasks" : "No completed tasks yet"}
        </Text>
      ) : (
        todos.map((todo) => (
          <TodoCard
            key={todo.id}
            todo={todo}
            onToggleStatus={onToggleStatus}
            onDelete={onDelete}
            onUpdateTitle={onUpdateTitle}
            onUpdateDescription={onUpdateDescription}
            onUpdateEmoji={onUpdateEmoji}
            theme={theme}
          />
        ))
      )}
    </View>
  );
}

export function TaskManager({
  todos,
  onUpdate,
  isAgentRunning,
  theme,
}: TaskManagerProps) {
  const pendingTodos = todos.filter((t) => t.status === "pending");
  const completedTodos = todos.filter((t) => t.status === "completed");

  const toggleStatus = (todo: Todo) => {
    const updated = todos.map((t) =>
      t.id === todo.id
        ? {
            ...t,
            status: (t.status === "completed" ? "pending" : "completed") as
              | "pending"
              | "completed",
          }
        : t,
    );
    onUpdate(updated);
  };

  const deleteTodo = (todo: Todo) => {
    onUpdate(todos.filter((t) => t.id !== todo.id));
  };

  const updateTitle = (id: string, title: string) => {
    onUpdate(todos.map((t) => (t.id === id ? { ...t, title } : t)));
  };

  const updateDescription = (id: string, description: string) => {
    onUpdate(todos.map((t) => (t.id === id ? { ...t, description } : t)));
  };

  const updateEmoji = (id: string, emoji: string) => {
    onUpdate(todos.map((t) => (t.id === id ? { ...t, emoji } : t)));
  };

  const addTodo = () => {
    onUpdate([
      ...todos,
      {
        id: generateId(),
        title: "New Todo",
        description: "Add a description",
        emoji: "🎯",
        status: "pending" as const,
      },
    ]);
  };

  if (todos.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyEmoji}>✏️</Text>
        <Text style={[styles.emptyTitle, { color: theme.text }]}>
          No todos yet
        </Text>
        <Text style={[styles.emptySubtitle, { color: theme.muted }]}>
          Create your first task to get started
        </Text>
        <Pressable
          onPress={addTodo}
          disabled={isAgentRunning}
          style={[
            styles.emptyAddButton,
            {
              backgroundColor: theme.primary,
              opacity: isAgentRunning ? 0.5 : 1,
            },
          ]}
        >
          <Text style={styles.emptyAddButtonText}>Add a task</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
    >
      <TodoSection
        title="To Do"
        todos={pendingTodos}
        showAddButton
        onAddTodo={addTodo}
        onToggleStatus={toggleStatus}
        onDelete={deleteTodo}
        onUpdateTitle={updateTitle}
        onUpdateDescription={updateDescription}
        onUpdateEmoji={updateEmoji}
        isAgentRunning={isAgentRunning}
        theme={theme}
      />
      <TodoSection
        title="Done"
        todos={completedTodos}
        onToggleStatus={toggleStatus}
        onDelete={deleteTodo}
        onUpdateTitle={updateTitle}
        onUpdateDescription={updateDescription}
        onUpdateEmoji={updateEmoji}
        isAgentRunning={isAgentRunning}
        theme={theme}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 16, gap: 24 },
  section: { gap: 10 },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionTitle: { fontSize: 16, fontWeight: "700" },
  badge: {
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    minWidth: 22,
    alignItems: "center",
  },
  badgeText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  addButton: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 },
  addButtonText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  emptySection: { fontSize: 13, fontStyle: "italic", paddingVertical: 8 },
  card: {
    borderRadius: 14,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  emojiButton: { borderRadius: 10, padding: 6 },
  emoji: { fontSize: 24 },
  cardActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  checkmark: { color: "#fff", fontSize: 13, fontWeight: "700" },
  deleteButton: { padding: 4 },
  deleteText: { fontSize: 16, fontWeight: "600" },
  emojiPicker: {
    flexDirection: "row",
    borderRadius: 20,
    padding: 6,
    gap: 4,
    marginBottom: 8,
    alignSelf: "flex-start",
  },
  emojiOption: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  emojiOptionText: { fontSize: 18 },
  title: { fontSize: 15, fontWeight: "600", marginBottom: 4 },
  titleInput: {
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 4,
    borderBottomWidth: 2,
    paddingBottom: 2,
  },
  description: { fontSize: 13, lineHeight: 18 },
  descInput: {
    fontSize: 13,
    lineHeight: 18,
    borderBottomWidth: 2,
    paddingBottom: 2,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 24,
  },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: { fontSize: 16, fontWeight: "600" },
  emptySubtitle: { fontSize: 14 },
  emptyAddButton: {
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginTop: 8,
  },
  emptyAddButtonText: { color: "#fff", fontSize: 14, fontWeight: "600" },
});
