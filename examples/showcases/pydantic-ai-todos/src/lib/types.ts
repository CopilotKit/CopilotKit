// 🪁 Frontend State Types
// These types must match the Pydantic models in agent.py
// TypeScript `optional?` maps to Python `Field(default=None)`
// This ensures seamless state synchronization between frontend and backend

export type TodoStatus = "todo" | "in-progress" | "done";

export type TodoItem = {
  id: string;
  title: string;
  description?: string; // Optional field - matches Python's `str | None = Field(default=None)`
  status: TodoStatus;
};

export type AgentState = {
  todos: TodoItem[];
}