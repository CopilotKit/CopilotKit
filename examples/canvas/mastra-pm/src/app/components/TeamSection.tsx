import { AgentState } from "@/lib/state";

interface TeamSectionProps {
  state: AgentState;
}

export function TeamSection({ state }: TeamSectionProps) {
  return (
    <div className="p-8 border-b border-white/10">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white mb-2">Team Members</h2>
        <p className="text-gray-200 text-sm">Your project team</p>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {state?.users?.map((user) => (
          <div
            key={user.id}
            className="flex-shrink-0 bg-white/10 rounded-xl p-4 border border-white/10 hover:bg-white/20 transition-all duration-200 min-w-[200px]"
          >
            <div className="flex items-center gap-3">
              <div className="relative">
                <img
                  src={user.image}
                  alt={user.name}
                  className="w-12 h-12 rounded-full object-cover border-2 border-white/20"
                />
                <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-400 rounded-full border-2 border-white"></div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-white text-sm truncate">{user.name}</div>
                <div className="text-xs text-gray-300 truncate">{user.role}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
} 