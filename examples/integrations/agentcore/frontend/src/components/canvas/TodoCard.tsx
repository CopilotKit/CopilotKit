import type { Todo } from "./types"

const priorityColors: Record<string, string> = {
  high: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  medium: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300",
  low: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
}

interface TodoCardProps {
  todo: Todo
}

export function TodoCard({ todo }: TodoCardProps) {
  return (
    <div className="rounded-lg border bg-white dark:bg-zinc-900 p-3 shadow-sm space-y-1">
      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 leading-snug">
        {todo.title}
      </p>
      {todo.description && (
        <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug">
          {todo.description}
        </p>
      )}
      {todo.priority && (
        <span className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded ${priorityColors[todo.priority] ?? ""}`}>
          {todo.priority}
        </span>
      )}
    </div>
  )
}
