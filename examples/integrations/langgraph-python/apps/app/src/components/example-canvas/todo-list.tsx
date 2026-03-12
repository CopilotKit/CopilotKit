"use client";

import { TodoColumn } from "./todo-column";

interface Todo {
  id: string;
  title: string;
  description: string;
  emoji: string;
  status: "pending" | "completed";
}

interface TodoListProps {
  todos: Todo[];
  onUpdate: (todos: Todo[]) => void;
  isAgentRunning: boolean;
}

export function TodoList({ todos, onUpdate, isAgentRunning }: TodoListProps) {
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
        : t
    );
    onUpdate(updated);
  };

  const deleteTodo = (todo: Todo) => {
    onUpdate(todos.filter((t) => t.id !== todo.id));
  };

  const updateTitle = (todoId: string, title: string) => {
    const updated = todos.map((t) =>
      t.id === todoId ? { ...t, title } : t
    );
    onUpdate(updated);
  };

  const updateDescription = (todoId: string, description: string) => {
    const updated = todos.map((t) =>
      t.id === todoId ? { ...t, description } : t
    );
    onUpdate(updated);
  };

  const updateEmoji = (todoId: string, emoji: string) => {
    const updated = todos.map((t) =>
      t.id === todoId ? { ...t, emoji } : t
    );
    onUpdate(updated);
  };

  const addTodo = () => {
    const newTodo: Todo = {
      id: crypto.randomUUID(),
      title: "New Todo",
      description: "Add a description",
      emoji: "🎯",
      status: "pending",
    };
    onUpdate([...todos, newTodo]);
  };

  if (!todos || todos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="text-5xl">✏️</div>
        <p className="text-[16px] font-semibold text-neutral-900 dark:text-neutral-100">
          No tasks yet
        </p>
        <p className="text-[14px] text-neutral-500 dark:text-neutral-400">
          Create your first task to get started
        </p>
        <button
          onClick={addTodo}
          className="mt-2 px-5 py-2.5 text-[14px] font-semibold rounded-full cursor-pointer transition-colors text-white bg-neutral-900 hover:bg-neutral-700 dark:text-neutral-900 dark:bg-neutral-100 dark:hover:bg-neutral-300"
          aria-label="Add your first todo task"
          disabled={isAgentRunning}
        >
          Add a task
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-8 h-full">
      <TodoColumn
        title="To Do"
        todos={pendingTodos}
        emptyMessage="No pending tasks"
        showAddButton
        onAddTodo={addTodo}
        onToggleStatus={toggleStatus}
        onDelete={deleteTodo}
        onUpdateTitle={updateTitle}
        onUpdateDescription={updateDescription}
        onUpdateEmoji={updateEmoji}
        isAgentRunning={isAgentRunning}
      />
      <TodoColumn
        title="Done"
        todos={completedTodos}
        emptyMessage="No completed tasks yet"
        onToggleStatus={toggleStatus}
        onDelete={deleteTodo}
        onUpdateTitle={updateTitle}
        onUpdateDescription={updateDescription}
        onUpdateEmoji={updateEmoji}
        isAgentRunning={isAgentRunning}
      />
    </div>
  );
}
