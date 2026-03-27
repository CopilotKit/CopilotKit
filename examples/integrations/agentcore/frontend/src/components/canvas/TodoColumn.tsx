import type { Todo, TodoStatus } from "./types"
import { TodoList } from "./TodoList"

const COLUMN_LABELS: Record<TodoStatus, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  done: "Done",
}

const COLUMN_STYLES: Record<TodoStatus, string> = {
  todo: "border-gray-200 dark:border-zinc-700",
  in_progress: "border-indigo-200 dark:border-indigo-800",
  done: "border-green-200 dark:border-green-900",
}

interface TodoColumnProps {
  status: TodoStatus
  todos: Todo[]
}

export function TodoColumn({ status, todos }: TodoColumnProps) {
  return (
    <div className={`flex flex-col gap-3 min-w-[200px] flex-1 rounded-xl border p-3 ${COLUMN_STYLES[status]}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide">
          {COLUMN_LABELS[status]}
        </h3>
        <span className="text-xs text-gray-400 bg-gray-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded-full">
          {todos.length}
        </span>
      </div>
      <TodoList todos={todos} />
    </div>
  )
}
