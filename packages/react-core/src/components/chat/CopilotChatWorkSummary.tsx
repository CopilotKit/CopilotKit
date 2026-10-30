import React, { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "../../lib/utils";
import type { ToolCallEntry } from "./tool-call-layout";
import { pluralize } from "./CopilotChatToolCallGroup";

export interface CopilotChatWorkSummaryProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** The agent is still working on this reply. */
  isWorking: boolean;
  /** Whether the work (narration and tool calls) is showing. */
  isOpen: boolean;
  /** The tool calls the reply made. */
  calls: ToolCallEntry[];
  /**
   * How long the agent has worked on the reply, in ms, summed over its runs
   * so time spent waiting between them doesn't count. Only known for replies
   * this client watched start; without it the summary shows the tool count.
   */
  elapsedMs?: number;
  /** When the current run started (epoch ms), while the agent is working. */
  workingSince?: number;
}

/** "45s", "1m 5s", "2m". Used for the live timer and the final duration. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

/** Re-renders every second while `active`, returning the current time. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * The line at the top of a reply in the `"turn"` tool-call display. While the
 * agent works it reads "Working 4s"; once the reply is done it reads "Worked
 * for 9s · 7 tools" and toggles the work it folded away.
 */
export function CopilotChatWorkSummary({
  isWorking,
  isOpen,
  calls,
  elapsedMs,
  workingSince,
  className,
  ...props
}: CopilotChatWorkSummaryProps) {
  const now = useNow(isWorking);
  const failed = calls.filter((call) => call.toolMessage?.error).length;
  const liveMs =
    elapsedMs !== undefined && workingSince !== undefined
      ? elapsedMs + Math.max(0, now - workingSince)
      : undefined;
  // A finished reply worked for at least a second.
  const duration =
    elapsedMs !== undefined
      ? formatDuration(Math.max(1000, elapsedMs))
      : undefined;

  return (
    <button
      type="button"
      data-copilotkit
      data-testid="copilot-work-summary"
      data-state={isWorking ? "working" : "done"}
      aria-expanded={isOpen}
      className={cn("cpk-work-summary", className)}
      {...props}
    >
      {isWorking ? (
        <>
          <span className="cpk-work-summary-label cpk-shimmer">Working</span>
          {liveMs !== undefined && (
            <span className="cpk-work-summary-detail cpk-work-summary-timer">
              {formatDuration(liveMs)}
            </span>
          )}
        </>
      ) : (
        <>
          <span className="cpk-work-summary-label">
            {duration
              ? `Worked for ${duration}`
              : `Used ${pluralize(calls.length, "tool")}`}
          </span>
          {duration && (
            <span className="cpk-work-summary-detail">
              {pluralize(calls.length, "tool")}
            </span>
          )}
          {failed > 0 && (
            <span className="cpk-work-summary-failed">{failed} failed</span>
          )}
        </>
      )}
      <ChevronRight
        aria-hidden="true"
        className={cn(
          "cpk-work-summary-chevron",
          isOpen && "cpk-work-summary-chevron-open",
        )}
      />
    </button>
  );
}

export default CopilotChatWorkSummary;
