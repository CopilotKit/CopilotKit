import { AgentState } from "@/lib/types";

interface FullSendCardProps {
  themeColor: string;
  status: string;
  respond?: (response: string) => void;
  state: AgentState;
  setState: (state: AgentState) => void;
}

export function FullSendCard({ themeColor, status, respond, state, setState }: FullSendCardProps) {
  const handleConfirm = () => {
    setState({
      todos: state.todos.map(todo => ({ ...todo, status: "done" as const }))
    });
    respond?.("yes");
  };

  const isComplete = status === "complete";

  if (isComplete) {
    return (
      <div 
        style={{ backgroundColor: themeColor }} 
        className="backdrop-blur-sm rounded-lg p-4 mt-4 mb-4 max-w-md w-full border border-white/20"
      >
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-green-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-white/90 text-sm">All todos marked as complete</p>
        </div>
      </div>
    );
  }

  return (
    <div 
      style={{ backgroundColor: themeColor }} 
      className="backdrop-blur-sm rounded-lg p-4 mt-4 mb-4 w-full max-w-md border border-white/20"
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center mt-0.5">
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div className="flex-1 space-y-4">
          <p className="text-white text-sm leading-relaxed">
            Would you like to mark all todos as complete?
          </p>
          
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => respond?.("no")}
              className="px-4 py-2 text-white/80 hover:text-white hover:bg-white/10 rounded-lg text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              className="px-4 py-2 bg-white/20 hover:bg-white/30 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Confirm
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}