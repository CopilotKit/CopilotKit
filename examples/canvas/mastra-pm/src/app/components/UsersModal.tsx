import { AgentState } from "@/lib/state";

interface UsersModalProps {
  isOpen: boolean;
  onClose: () => void;
  state: AgentState;
}

export function UsersModal({ isOpen, onClose, state }: UsersModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-6">
      <div className="bg-white/20 backdrop-blur-md rounded-3xl shadow-2xl max-w-3xl w-full border border-white/20">
        <div className="flex justify-between items-center p-8 border-b border-white/10">
          <div>
            <h2 className="text-3xl font-bold text-white">Team Members</h2>
            <p className="text-gray-200 text-sm mt-1">Manage your project team</p>
          </div>
          <button
            onClick={onClose}
            className="text-white hover:text-gray-300 transition-colors p-2 hover:bg-white/10 rounded-lg"
          >
            X
          </button>
        </div>
        <div className="p-8 max-h-96 overflow-y-auto space-y-4">
          {state?.users?.map((user) => (
            <UserCard key={user.id} user={user} />
          ))}
        </div>
      </div>
    </div>
  );
}

interface UserCardProps {
  user: AgentState['users'][0];
}

function UserCard({ user }: UserCardProps) {
  return (
    <div className="flex items-center gap-4 bg-white/10 rounded-xl p-6 border border-white/10 hover:bg-white/20 transition-all duration-200">
      <div className="relative">
        <img
          src={user.image}
          alt={user.name}
          className="w-16 h-16 rounded-xl object-cover border-2 border-white/20"
        />
        <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-400 rounded-full border-2 border-white"></div>
      </div>
      <div className="flex-1">
        <div className="font-semibold text-xl text-white mb-1">{user.name}</div>
        <div className="text-sm text-gray-200 mb-2">{user.role}</div>
        <div className="text-sm text-gray-300 leading-relaxed">{user.summary}</div>
      </div>
      <div className="text-right">
        <div className="text-sm text-gray-400">{user.email}</div>
      </div>
    </div>
  );
} 