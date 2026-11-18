export interface KanbanTask {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  tags: string[];
  status: "new" | "in_progress" | "review" | "completed";
}

export interface Board {
  id: string;
  name: string;
  tasks: KanbanTask[];
}

export interface AgentState {
  boards: Board[];
  activeBoardId: string;
  lastAction?: string;
}
