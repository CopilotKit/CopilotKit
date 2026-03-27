import type { Todo } from "./types"
import { TodoCard } from "./TodoCard"

interface TodoListProps {
  todos: Todo[]
}

export function TodoList({ todos }: TodoListProps) {
  if (todos.length === 0) {
    return (
      <p className="text-xs text-gray-400 dark:text-gray-600 italic text-center py-4">
        Nothing here yet
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {todos.map((todo) => (
        <TodoCard key={todo.id} todo={todo} />
      ))}
    </div>
  )
}
