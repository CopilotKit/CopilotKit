"use client";

import { TodoCard } from "./todo-card";

interface Todo {
  id: string;
  title: string;
  description: string;
  emoji: string;
  status: "pending" | "completed";
}

interface TodoColumnProps {
  title: string;
  todos: Todo[];
  emptyMessage: string;
  showAddButton?: boolean;
  onAddTodo?: () => void;
  onToggleStatus: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
  onUpdateTitle: (todoId: string, title: string) => void;
  onUpdateDescription: (todoId: string, description: string) => void;
  onUpdateEmoji: (todoId: string, emoji: string) => void;
  isAgentRunning: boolean;
}

export function TodoColumn({
  title,
  todos,
  emptyMessage,
  showAddButton = false,
  onAddTodo,
  onToggleStatus,
  onDelete,
  onUpdateTitle,
  onUpdateDescription,
  onUpdateEmoji,
  isAgentRunning,
}: TodoColumnProps) {
  return (
    <section aria-label={`${title} column`} className="flex-1 min-w-0">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <h2 className="text-[18px] font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
            {title}
          </h2>
          <span className="text-[12px] font-semibold rounded-full px-2 py-0.5 text-neutral-500 bg-neutral-200 dark:text-neutral-400 dark:bg-neutral-700">
            {todos.length}
          </span>
        </div>
        {showAddButton && onAddTodo && (
          <button
            onClick={onAddTodo}
            className="rounded-full cursor-pointer transition-colors p-1.5 text-neutral-500 bg-neutral-200 hover:bg-neutral-300 hover:text-neutral-900 dark:text-neutral-400 dark:bg-neutral-700 dark:hover:bg-neutral-600 dark:hover:text-neutral-100"
            aria-label="Add new todo"
            disabled={isAgentRunning}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        )}
      </div>

      {/* Cards */}
      <div className="space-y-4">
        {todos.length === 0 ? (
          <div className="text-center text-[14px] rounded-2xl border-2 border-dashed p-5 min-h-[151px] flex items-center justify-center text-neutral-400 border-neutral-300 dark:text-neutral-500 dark:border-neutral-700">
            {emptyMessage}
          </div>
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
            />
          ))
        )}
      </div>
    </section>
  );
}
