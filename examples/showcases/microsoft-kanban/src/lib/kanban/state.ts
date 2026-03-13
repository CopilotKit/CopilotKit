import type { AgentState, KanbanTask } from "./types";

const sampleTasks: KanbanTask[] = [
  // {
  //   id: "task001",
  //   title: "Setup project",
  //   subtitle: "Initial configuration",
  //   description: "Configure development environment and dependencies",
  //   tags: ["setup", "config"],
  //   status: "completed"
  // },
  // {
  //   id: "task002",
  //   title: "Build Kanban board",
  //   subtitle: "Create task management UI",
  //   description: "Design and implement Kanban board with drag-and-drop",
  //   tags: ["ui", "feature"],
  //   status: "in_progress"
  // }
];

export const initialState: AgentState = {
  boards: [
    {
      id: "board001",
      name: "My First Board",
      tasks: sampleTasks,
    },
  ],
  activeBoardId: "board001",
  lastAction: "",
};

export function isNonEmptyAgentState(state: unknown): boolean {
  return !!(state as AgentState)?.boards?.length;
}
