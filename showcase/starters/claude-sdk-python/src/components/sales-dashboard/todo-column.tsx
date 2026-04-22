import { TodoCard } from "./todo-card";
import type { SalesTodo } from "../../types";

interface TodoColumnProps {
  title: string;
  todos: SalesTodo[];
  emptyMessage: string;
  showAddButton?: boolean;
  onAddTodo?: () => void;
  onToggleCompleted: (todo: SalesTodo) => void;
  onDelete: (todo: SalesTodo) => void;
  onUpdateTitle: (todoId: string, title: string) => void;
  onUpdateStage: (todoId: string, stage: SalesTodo["stage"]) => void;
  onUpdateValue: (todoId: string, value: number) => void;
  isAgentRunning: boolean;
}

export function TodoColumn({
  title,
  todos,
  emptyMessage,
  showAddButton = false,
  onAddTodo,
  onToggleCompleted,
  onDelete,
  onUpdateTitle,
  onUpdateStage,
  onUpdateValue,
  isAgentRunning,
}: TodoColumnProps) {
  return (
    <section aria-label={`${title} column`} className="flex-1 min-w-0">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold tracking-tight text-[var(--foreground)]">
            {title}
          </h2>
          <span className="inline-flex items-center rounded-full border border-[var(--border)] bg-[var(--secondary)] px-2.5 py-0.5 text-xs font-semibold text-[var(--secondary-foreground)]">
            {todos.length}
          </span>
        </div>
        {showAddButton && onAddTodo && (
          <button
            onClick={onAddTodo}
            disabled={isAgentRunning}
            aria-label="Add new deal"
            className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-[var(--secondary)] transition-colors disabled:opacity-50"
          >
            <svg
              className="h-4 w-4 text-[var(--foreground)]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        )}
      </div>

      {/* Cards */}
      <div className="space-y-3">
        {todos.length === 0 ? (
          <div className="text-center text-sm rounded-lg border-2 border-dashed border-[var(--border)] p-5 min-h-[151px] flex items-center justify-center text-[var(--muted-foreground)]">
            {emptyMessage}
          </div>
        ) : (
          todos.map((todo) => (
            <TodoCard
              key={todo.id}
              todo={todo}
              onToggleCompleted={onToggleCompleted}
              onDelete={onDelete}
              onUpdateTitle={onUpdateTitle}
              onUpdateStage={onUpdateStage}
              onUpdateValue={onUpdateValue}
            />
          ))
        )}
      </div>
    </section>
  );
}
