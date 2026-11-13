/** Canonical Beautiful Chat board state; mirrors Python tools/todos.py. */
export interface BoardTodo extends Record<string, unknown> {
  id: string;
  title: string;
  description: string;
  emoji: string;
  status: "pending" | "completed";
}

/** Preserve metadata and convert legacy sales fields without storing two statuses. */
export function manageTodosImpl(todos: Record<string, unknown>[]): BoardTodo[] {
  return todos.map((todo) => {
    const status = todo.status ?? (todo.completed ? "completed" : "pending");
    if (status !== "pending" && status !== "completed") {
      throw new Error(`Unsupported todo status: ${String(status)}`);
    }
    const { completed: _completed, ...item } = todo;
    return {
      ...item,
      id: String(todo.id || crypto.randomUUID()),
      title: String(todo.title ?? todo.name ?? ""),
      description: String(todo.description ?? todo.notes ?? ""),
      emoji: String(todo.emoji ?? "🎯"),
      status,
    };
  });
}
