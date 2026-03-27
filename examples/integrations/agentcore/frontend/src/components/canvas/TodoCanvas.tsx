import { useCoAgent } from "@copilotkit/react-core/v2"
import type { Todo, TodoStatus } from "./types"
import { TodoColumn } from "./TodoColumn"

interface AgentState {
  todos: Todo[]
}

const COLUMNS: TodoStatus[] = ["todo", "in_progress", "done"]

export function TodoCanvas() {
  const { state } = useCoAgent<AgentState>({
    name: "agent",
    initialState: { todos: [] },
  })

  const todos = state.todos ?? []
  const byStatus = (status: TodoStatus) => todos.filter((t) => t.status === status)

  if (todos.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-gray-400 dark:text-gray-600">
        Ask the agent to manage tasks — they'll appear here.
      </div>
    )
  }

  return (
    <div className="flex gap-3 h-full p-4 overflow-x-auto">
      {COLUMNS.map((status) => (
        <TodoColumn key={status} status={status} todos={byStatus(status)} />
      ))}
    </div>
  )
}
