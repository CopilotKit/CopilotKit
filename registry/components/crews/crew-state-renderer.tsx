import {
  CrewsAgentState,
  CrewsResponseStatus,
  CrewsTaskStateItem,
  CrewsToolStateItem,
} from "@copilotkit/react-core";
import { useEffect } from "react";
import { useMemo, useRef, useState } from "react";

/**
 * Renders your Crew's steps & tasks in real-time.
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

  // Combine steps + tasks
  const items = useMemo(() => {
    if (!state) return [];
    return [...(state.steps || []), ...(state.tasks || [])].sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }, [state]);

  // Highlight newly added item & auto-scroll
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
    return <div>Loading crew state...</div>;
  }

  // Hide entirely if collapsed & empty & not in progress
  if (isCollapsed && items.length === 0 && status !== "inProgress") return null;

  return (
    <div style={{ marginTop: "8px", fontSize: "0.9rem" }}>
      <div
        style={{ cursor: "pointer", display: "flex", alignItems: "center" }}
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <span style={{ marginRight: 4 }}>{isCollapsed ? "▶" : "▼"}</span>
        {status === "inProgress" ? "Crew is analyzing..." : "Crew analysis"}
      </div>

      {!isCollapsed && (
        <div
          ref={contentRef}
          style={{
            maxHeight: "200px",
            overflow: "auto",
            borderLeft: "1px solid #ccc",
            paddingLeft: "8px",
            marginLeft: "4px",
            marginTop: "4px",
          }}
        >
          {items.length > 0 ? (
            items.map((item) => {
              const isTool = (item as CrewsToolStateItem).tool !== undefined;
              const isHighlighted = item.id === highlightId;
              return (
                <div
                  key={item.id}
                  style={{
                    marginBottom: "8px",
                    animation: isHighlighted ? "fadeIn 0.5s" : undefined,
                  }}
                >
                  <div style={{ fontWeight: "bold" }}>
                    {isTool
                      ? (item as CrewsToolStateItem).tool
                      : (item as CrewsTaskStateItem).name}
                  </div>
                  {"thought" in item && item.thought && (
                    <div style={{ opacity: 0.8, marginTop: "4px" }}>
                      Thought: {item.thought}
                    </div>
                  )}
                  {"result" in item && item.result !== undefined && (
                    <pre style={{ fontSize: "0.85rem", marginTop: "4px" }}>
                      {JSON.stringify(item.result, null, 2)}
                    </pre>
                  )}
                  {"description" in item && item.description && (
                    <div style={{ marginTop: "4px" }}>{item.description}</div>
                  )}
                </div>
              );
            })
          ) : (
            <div style={{ opacity: 0.7 }}>No activity yet...</div>
          )}
        </div>
      )}

      {/* Simple fadeIn animation */}
      <style>{`
        @keyframes fadeIn {
          0% { opacity: 0; transform: translateY(4px); }
          100% { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

export default CrewStateRenderer;
