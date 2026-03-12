import { AgentState } from "@/lib/types";

export interface ProverbsCardProps {
  state: AgentState;
  setState: (state: AgentState) => void;
}

export function ProverbsCard({ state, setState }: ProverbsCardProps) {
  return (
    <div className="bg-white/20 backdrop-blur-md p-8 rounded-2xl shadow-xl max-w-2xl w-full">
      <h1 className="text-4xl font-bold text-white mb-2 text-center">Proverbs</h1>
      <p className="text-gray-200 text-center italic mb-6">This is a demonstrative page, but it could be anything you want! 🪁</p>
      <hr className="border-white/20 my-6" />
      <div className="flex flex-col gap-3">
        {state.proverbs?.map((proverb, index) => (
          <div 
            key={index} 
            className="bg-white/15 p-4 rounded-xl text-white relative group hover:bg-white/20 transition-all"
          >
            <p className="pr-8">{proverb}</p>
            <button 
              onClick={() => setState({
                ...state,
                proverbs: state.proverbs?.filter((_, i) => i !== index),
              })}
              className="absolute right-3 top-3 opacity-0 group-hover:opacity-100 transition-opacity 
                bg-red-500 hover:bg-red-600 text-white rounded-full h-6 w-6 flex items-center justify-center"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      {state.proverbs?.length === 0 && <p className="text-center text-white/80 italic my-8">
        No proverbs yet. Ask the assistant to add some!
      </p>}
    </div>
  );
}