"use client";

import FormattedContent from "@/components/FormattedContent";
import { AgentState, RunStatus } from "@/types/agent";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { useState, useRef, useEffect, useMemo } from "react";

// Helper to safely handle result content
const formatContent = (result: unknown): string => {
  if (result === null || result === undefined) return "";
  return typeof result === "string" ? result : JSON.stringify(result, null, 2);
};

// Simple skeleton item for loading state
const SkeletonItem = () => (
  <div className="py-0.5 animate-pulse">
    <div className="flex justify-between">
      <div className="h-2.5 bg-gray-200 dark:bg-gray-700 rounded w-16"></div>
      <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-8"></div>
    </div>
    <div className="mt-0.5 h-6 bg-gray-200 dark:bg-gray-700 rounded"></div>
  </div>
);

export function AgenticUI({
  state,
  status,
}: {
  state?: AgentState;
  status: RunStatus;
}) {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);
  const prevItemsLengthRef = useRef<number>(0);
  const [newestItemId, setNewestItemId] = useState<string | null>(null);

  // Safely compute derived values using useMemo
  const items = useMemo(() => {
    return state
      ? [
          ...(state.steps?.filter((s) => s.tool) || []),
          ...(state.tasks || []),
        ].sort(
          (a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        )
      : [];
  }, [state]);

  // Determine if we should show skeleton UI (thinking but no items yet)
  const isThinking = status === "inProgress" && items.length === 0;

  // Track newest item and auto-scroll - must be before any conditional returns
  useEffect(() => {
    if (!state) return; // Skip effect if no state

    // If new items were added
    if (items.length > prevItemsLengthRef.current) {
      // Get the newest item
      if (items.length > 0) {
        const newest = items[items.length - 1];
        setNewestItemId(newest.id);

        // Clear the animation after 1.5 seconds
        setTimeout(() => {
          setNewestItemId(null);
        }, 1500);
      }

      // Auto-scroll to bottom
      if (contentRef.current && !isCollapsed) {
        contentRef.current.scrollTop = contentRef.current.scrollHeight;
      }
    }

    prevItemsLengthRef.current = items.length;
  }, [items, isCollapsed, state]);

  // Early return for loading state
  if (!state) {
    return (
      <div className="p-2">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  // Don't render anything if collapsed and empty and not thinking
  if (isCollapsed && items.length === 0 && !isThinking) return null;

  return (
    <div className="text-sm">
      {/* Header - designed to look like <summary> */}
      <div
        className="flex items-center gap-1 cursor-pointer select-none"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        {isCollapsed ? (
          <ChevronDown className="h-4 w-4 flex-shrink-0" />
        ) : (
          <ChevronUp className="h-4 w-4 flex-shrink-0" />
        )}
        <div className="text-gray-600 dark:text-gray-300">
          {status === "inProgress" ? (
            <span className="animate-pulse flex items-center">Analyzing</span>
          ) : (
            "Analyzed"
          )}
        </div>
      </div>

      {/* Content */}
      {!isCollapsed && (
        <div
          ref={contentRef}
          className="pl-4 max-h-[250px] overflow-auto pt-1.5 border-l border-gray-200 dark:border-gray-700 ml-[6px]"
        >
          {/* Actual items */}
          {items.length > 0 ? (
            items.map((item) => (
              <div
                key={item.id}
                className={`py-1 mb-1 transition-all ${
                  item.id === newestItemId ? "animate-appear" : ""
                }`}
              >
                <div className="text-xs">
                  <div className="opacity-70">
                    {"tool" in item ? item.tool : item.name}
                  </div>
                </div>

                {"thought" in item && item.thought && (
                  <div className="mt-0.5 text-xs opacity-80">
                    {item.thought}
                  </div>
                )}
                {"result" in item &&
                  item.result !== undefined &&
                  item.result !== null && (
                    <div className="mt-0.5 text-xs">
                      <FormattedContent
                        content={formatContent(item.result)}
                        showJsonLabel={false}
                        isCollapsed={true}
                      />
                    </div>
                  )}
                {"description" in item && item.description && (
                  <div className="mt-0.5 text-xs opacity-80">
                    {item.description}
                  </div>
                )}
              </div>
            ))
          ) : isThinking ? (
            // Show skeleton UI while thinking
            <>
              <SkeletonItem />
              <SkeletonItem />
            </>
          ) : (
            <div className="py-1 text-xs opacity-70">No activity</div>
          )}
        </div>
      )}

      {/* Animation styles */}
      <style jsx global>{`
        @keyframes appear {
          0% {
            opacity: 0;
            transform: translateY(8px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .animate-appear {
          animation: appear 0.5s ease-out;
        }

        .animate-pulse {
          animation: pulse 1.5s infinite;
        }

        .animate-delay-100 {
          animation-delay: 0.15s;
        }

        .animate-delay-200 {
          animation-delay: 0.3s;
        }

        @keyframes pulse {
          0%,
          100% {
            opacity: 0.4;
          }
          50% {
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
