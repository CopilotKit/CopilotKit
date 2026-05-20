import { useState } from "react";
import type { SalesTodo } from "../../types";

const STAGE_COLORS: Record<SalesTodo["stage"], string> = {
  prospect: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  qualified:
    "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  proposal: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  negotiation:
    "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  "closed-won":
    "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  "closed-lost": "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

interface TodoCardProps {
  todo: SalesTodo;
  onToggleCompleted: (todo: SalesTodo) => void;
  onDelete: (todo: SalesTodo) => void;
  onUpdateTitle: (todoId: string, title: string) => void;
  onUpdateStage: (todoId: string, stage: SalesTodo["stage"]) => void;
  onUpdateValue: (todoId: string, value: number) => void;
}

export function TodoCard({
  todo,
  onToggleCompleted,
  onDelete,
  onUpdateTitle,
  onUpdateStage,
  onUpdateValue,
}: TodoCardProps) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(todo.title);

  const saveTitle = () => {
    if (titleValue.trim()) {
      onUpdateTitle(todo.id, titleValue.trim());
    }
    setEditingTitle(false);
  };

  return (
    <div
      data-testid="todo-card"
      className={`group relative rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 transition-all duration-150 ${
        todo.completed ? "opacity-60" : ""
      }`}
    >
      {/* Delete button - hover reveal */}
      <button
        onClick={() => onDelete(todo)}
        className="absolute top-3 right-3 h-7 w-7 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[var(--secondary)]"
        aria-label="Delete deal"
      >
        <svg
          className="h-3.5 w-3.5 text-[var(--muted-foreground)]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      <div className="flex items-start gap-3">
        {/* Completion checkbox */}
        <button
          data-testid="toggle-completed"
          onClick={() => onToggleCompleted(todo)}
          className={`mt-0.5 h-5 w-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
            todo.completed
              ? "bg-[var(--primary)] border-[var(--primary)]"
              : "border-[var(--border)] hover:border-[var(--primary)]"
          }`}
        >
          {todo.completed && (
            <svg
              className="h-3 w-3 text-[var(--primary-foreground)]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </button>

        <div className="flex-1 min-w-0">
          {/* Title */}
          {editingTitle ? (
            <input
              type="text"
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveTitle();
                if (e.key === "Escape") {
                  setTitleValue(todo.title);
                  setEditingTitle(false);
                }
              }}
              className="w-full text-sm font-semibold focus:outline-none bg-transparent text-[var(--foreground)] border-b-2 border-[var(--primary)] pb-[2px]"
              autoFocus
            />
          ) : (
            <div
              onClick={() => {
                setTitleValue(todo.title);
                setEditingTitle(true);
              }}
              className={`text-sm font-semibold cursor-text break-words leading-snug ${
                todo.completed
                  ? "text-[var(--muted-foreground)] line-through"
                  : "text-[var(--foreground)]"
              }`}
            >
              {todo.title}
            </div>
          )}

          {/* Stage badge */}
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_COLORS[todo.stage]}`}
            >
              {todo.stage}
            </span>
            <span className="text-sm font-semibold text-[var(--foreground)]">
              ${todo.value.toLocaleString()}
            </span>
          </div>

          {/* Meta: assignee + due date */}
          <div className="mt-2 flex items-center gap-3 text-xs text-[var(--muted-foreground)]">
            {todo.assignee && <span>{todo.assignee}</span>}
            {todo.dueDate && <span>Due {todo.dueDate}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
