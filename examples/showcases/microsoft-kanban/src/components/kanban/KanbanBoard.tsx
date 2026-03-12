import type { Board, KanbanTask } from "@/lib/kanban/types";
import TaskCard from "./TaskCard";

interface KanbanBoardProps {
  boards: Board[];
  activeBoardId: string;
  onUpdateTaskTitle?: (taskId: string, title: string) => void;
  onUpdateTaskSubtitle?: (taskId: string, subtitle: string) => void;
  onAddTaskTag?: (taskId: string, tag: string) => void;
  onRemoveTaskTag?: (taskId: string, tag: string) => void;
}

export default function KanbanBoard({
  boards,
  activeBoardId,
  onUpdateTaskTitle,
  onUpdateTaskSubtitle,
  onAddTaskTag,
  onRemoveTaskTag
}: KanbanBoardProps) {
  const activeBoard = boards.find(b => b.id === activeBoardId);

  if (!activeBoard) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">No active board</p>
      </div>
    );
  }

  const columns = [
    { status: "new" as const, label: "New" },
    { status: "in_progress" as const, label: "In Progress" },
    { status: "review" as const, label: "Review" },
    { status: "completed" as const, label: "Completed" }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 h-full">
      {columns.map(col => {
        const tasks = activeBoard.tasks.filter((t: KanbanTask) => t.status === col.status);

        return (
          <div key={col.status} className="flex flex-col space-y-3">
            <h3 className="font-semibold text-base px-2">
              {col.label} <span className="text-muted-foreground">({tasks.length})</span>
            </h3>

            <div className="flex flex-col space-y-2 overflow-auto">
              {tasks.length === 0 ? (
                <p className="text-muted-foreground text-sm px-2 py-4">No tasks</p>
              ) : (
                tasks.map((task: KanbanTask) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onUpdateTitle={onUpdateTaskTitle ? (title) => onUpdateTaskTitle(task.id, title) : undefined}
                    onUpdateSubtitle={onUpdateTaskSubtitle ? (subtitle) => onUpdateTaskSubtitle(task.id, subtitle) : undefined}
                    onAddTag={onAddTaskTag ? (tag) => onAddTaskTag(task.id, tag) : undefined}
                    onRemoveTag={onRemoveTaskTag ? (tag) => onRemoveTaskTag(task.id, tag) : undefined}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
