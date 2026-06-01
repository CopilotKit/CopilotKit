import { TodoColumn } from "./todo-column";
import type { SalesTodo } from "../../types";

interface TodoListProps {
  todos: SalesTodo[];
  onUpdate: (todos: SalesTodo[]) => void;
  isAgentRunning: boolean;
}

export function TodoList({ todos, onUpdate, isAgentRunning }: TodoListProps) {
  const activeTodos = todos.filter((t) => !t.completed);
  const completedTodos = todos.filter((t) => t.completed);

  const toggleCompleted = (todo: SalesTodo) => {
    const updated = todos.map((t) =>
      t.id === todo.id ? { ...t, completed: !t.completed } : t,
    );
    onUpdate(updated);
  };

  const deleteTodo = (todo: SalesTodo) => {
    onUpdate(todos.filter((t) => t.id !== todo.id));
  };

  const updateTitle = (todoId: string, title: string) => {
    const updated = todos.map((t) => (t.id === todoId ? { ...t, title } : t));
    onUpdate(updated);
  };

  const updateStage = (todoId: string, stage: SalesTodo["stage"]) => {
    const updated = todos.map((t) => (t.id === todoId ? { ...t, stage } : t));
    onUpdate(updated);
  };

  const updateValue = (todoId: string, value: number) => {
    const updated = todos.map((t) => (t.id === todoId ? { ...t, value } : t));
    onUpdate(updated);
  };

  const addTodo = () => {
    const newTodo: SalesTodo = {
      id: crypto.randomUUID(),
      title: "New Deal",
      stage: "prospect",
      value: 0,
      dueDate: new Date().toISOString().split("T")[0],
      assignee: "",
      completed: false,
    };
    onUpdate([...todos, newTodo]);
  };

  if (!todos || todos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="text-5xl">{"\uD83D\uDCBC"}</div>
        <p className="text-base font-semibold text-[var(--foreground)]">
          No deals yet
        </p>
        <p className="text-sm text-[var(--muted-foreground)]">
          Create your first deal to get started
        </p>
        <button
          onClick={addTodo}
          disabled={isAgentRunning}
          className="mt-2 px-4 py-2 rounded-md bg-[var(--primary)] text-[var(--primary-foreground)] text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          Add a deal
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-8 h-full">
      <TodoColumn
        title="Active Deals"
        todos={activeTodos}
        emptyMessage="No active deals"
        showAddButton
        onAddTodo={addTodo}
        onToggleCompleted={toggleCompleted}
        onDelete={deleteTodo}
        onUpdateTitle={updateTitle}
        onUpdateStage={updateStage}
        onUpdateValue={updateValue}
        isAgentRunning={isAgentRunning}
      />
      <TodoColumn
        title="Closed"
        todos={completedTodos}
        emptyMessage="No closed deals yet"
        onToggleCompleted={toggleCompleted}
        onDelete={deleteTodo}
        onUpdateTitle={updateTitle}
        onUpdateStage={updateStage}
        onUpdateValue={updateValue}
        isAgentRunning={isAgentRunning}
      />
    </div>
  );
}
