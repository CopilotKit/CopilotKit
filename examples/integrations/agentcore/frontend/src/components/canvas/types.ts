export type TodoStatus = "todo" | "in_progress" | "done"

export interface Todo {
  id: string
  title: string
  description?: string
  status: TodoStatus
  priority?: "low" | "medium" | "high"
}
