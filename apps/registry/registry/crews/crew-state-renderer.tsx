import {
  CrewsAgentState,
  CrewsResponseStatus,
  CrewsTaskStateItem,
  CrewsToolStateItem,
} from "@copilotkit/react-core";
import { useEffect } from "react";
import { useMemo, useRef, useState } from "react";

/**
 * Component that renders the crew's execution state in real-time
 * 
 * This component visualizes:
 * - Steps being executed by the crew
 * - Tasks being performed
 * - Thoughts and results during execution
 * 
 * Features:
 * - Collapsible UI to save space
 * - Auto-scrolling to newest items
 * - Highlighting of newly added items
 * 
 * @param state - The current state of the crew agent
 * @param status - The response status of the crew
 */
function CrewStateRenderer({
  state,
  status,
}: {
  state: CrewsAgentState;
  status: CrewsResponseStatus;
}) {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);
  const prevItemsLengthRef = useRef<number>(0);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  // Combine and sort steps and tasks by timestamp
  const items = useMemo(() => {
    if (!state) return [];
    return [...(state.steps || []), ...(state.tasks || [])].sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }, [state]);

  // Handle highlighting of new items and auto-scrolling
  useEffect(() => {
    if (!state) return;
    if (items.length > prevItemsLengthRef.current) {
      const newestItem = items[items.length - 1];
      setHighlightId(newestItem.id);
      setTimeout(() => setHighlightId(null), 1500);

      if (contentRef.current && !isCollapsed) {
        contentRef.current.scrollTop = contentRef.current.scrollHeight;
      }
    }
    prevItemsLengthRef.current = items.length;
  }, [items, isCollapsed, state]);

  if (!state) {
    return <div className="text-sm text-zinc-500 dark:text-zinc-400 italic">Loading crew state...</div>;
  }

  // Hide entirely if collapsed & empty & not in progress
  if (isCollapsed && items.length === 0 && status !== "inProgress") return null;

  return (
    <div className="mt-3 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 shadow-sm">
      <div
        className="flex items-center gap-2 cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300 text-zinc-800 dark:text-zinc-200 select-none"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <span className="text-xs">{isCollapsed ? "▶" : "▼"}</span>
        <span className="font-medium">
          {status === "inProgress" ? 
            <span className="text-zinc-500 dark:text-zinc-400 animate-pulse">Crew is analyzing...</span> : 
            <span className="text-zinc-500 dark:text-zinc-400">Crew analysis</span>
          }
          {!isCollapsed && items.length > 0 && ` (${items.length} steps)`}
        </span>
      </div>

      {!isCollapsed && (
        <div
          ref={contentRef}
          className="max-h-60 overflow-auto border-l border-zinc-200 dark:border-zinc-700 pl-3 ml-1 mt-3 pr-2"
        >
          {items.length > 0 ? (
            items.map((item) => {
              const isTool = (item as CrewsToolStateItem).tool !== undefined;
              const isHighlighted = item.id === highlightId;
              return (
                <div
                  key={item.id}
                  className={`mb-3 pb-3 border-b border-zinc-100 dark:border-zinc-800 last:border-0 ${
                    isHighlighted ? "animate-fadeIn" : ""
                  }`}
                >
                  <div className="font-medium text-sm text-zinc-800 dark:text-zinc-200">
                    {isTool
                      ? (item as CrewsToolStateItem).tool
                      : (item as CrewsTaskStateItem).name}
                  </div>
                  {"thought" in item && item.thought && (
                    <div className="text-xs mt-1.5 text-zinc-600 dark:text-zinc-400">
                      <span className="font-medium text-zinc-700 dark:text-zinc-300">Thought:</span> {item.thought}
                    </div>
                  )}
                  {"result" in item && item.result !== undefined && (
                    <pre className="text-xs mt-1.5 p-2 bg-zinc-50 dark:bg-zinc-900 rounded border border-zinc-100 dark:border-zinc-800 overflow-x-auto text-zinc-700 dark:text-zinc-300">
                      {typeof item.result === 'object' 
                        ? JSON.stringify(item.result, null, 2)
                        : item.result}
                    </pre>
                  )}
                  {"description" in item && item.description && (
                    <div className="text-xs mt-1.5 text-zinc-600 dark:text-zinc-400">{item.description}</div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="text-xs italic text-zinc-500 dark:text-zinc-400 py-2">No activity yet...</div>
          )}
        </div>
      )}

      {/* Custom animation for highlighting new items */}
      <style jsx>{`
        @keyframes fadeIn {
          0% { background-color: rgba(59, 130, 246, 0.1); }
          100% { background-color: transparent; }
        }
        .animate-fadeIn {
          animation: fadeIn 1.5s ease-out;
        }
      `}</style>
    </div>
  );
}

export default CrewStateRenderer;
