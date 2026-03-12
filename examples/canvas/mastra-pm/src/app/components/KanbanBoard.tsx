import { AgentState } from "@/lib/state";

interface KanbanBoardProps {
  state: AgentState;
}

export function KanbanBoard({ state }: KanbanBoardProps) {
  const statuses = ["todo", "in-progress", "done"];

  return (
    <div className="flex-1 p-8 overflow-hidden">
      <div className="flex gap-8 h-full overflow-x-auto overflow-y-hidden">
        {statuses.map((status) => (
          <div key={status} className="bg-white/10 rounded-2xl p-6 border border-white/10 flex flex-col h-full min-w-[350px] w-[350px] flex-shrink-0">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-semibold text-white">{status === "todo" ? "To Do" : status === "in-progress" ? "In Progress" : "Done"}</h3>
              <span className="text-sm text-gray-300 bg-white/10 px-3 py-1 rounded-full">
                {state?.tasks?.filter((task) => task.status === status).length || 0}
              </span>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto">
              {state?.tasks
                ?.filter((task) => task.status === status)
                .map((task) => {
                  const assignedUser = state?.users?.find((u) => u.id === task.assignedTo);
                  return (
                    <TaskCard key={task.id} task={task} assignedUser={assignedUser} />
                  );
                })}
              {state?.tasks?.filter((task) => task.status === status).length === 0 && (
                <div className="text-center py-8 text-gray-300 text-sm">
                  No tasks in this column
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface TaskCardProps {
  task: AgentState['tasks'][0];
  assignedUser?: AgentState['users'][0];
}

function TaskCard({ task, assignedUser }: TaskCardProps) {
  return (
    <div className="bg-white/10 rounded-xl p-4 border border-white/10 hover:bg-white/20 transition-all duration-200 hover:shadow-lg cursor-pointer group">
      <div className="font-semibold text-white mb-2 group-hover:text-white/90 transition-colors">
        {task.name}
      </div>
      <div className="text-sm text-gray-200 mb-4 leading-relaxed">
        {task.description}
      </div>
      {assignedUser && (
        <div className="flex items-center gap-3 pt-3 border-t border-white/10">
          <div className="relative">
            <img
              src={assignedUser.image}
              alt={assignedUser.name}
              className="w-8 h-8 rounded-full object-cover border-2 border-white/20"
            />
            <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-400 rounded-full border-2 border-white"></div>
          </div>
          <div className="flex-1">
            <div className="text-xs font-medium text-white">{assignedUser.name}</div>
            <div className="text-xs text-gray-300">{assignedUser.role}</div>
          </div>
        </div>
      )}
    </div>
  );
} 