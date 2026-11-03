import React, { useEffect, useState } from "react";
import { CopilotIcon } from "../icons/CopilotIcon";
import {
  CopilotChatDefaultLabels,
  ɵcountFailedToolCalls,
  ɵformatLabel,
  ɵformatWorkDuration,
  ɵformatCountLabel,
} from "@copilotkit/core";
import type { ToolCallEntry } from "@copilotkit/core";
import { cn } from "../../lib/utils";
import { useCopilotChatConfiguration } from "../../providers/CopilotChatConfigurationProvider";

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
 * agent works it reads "Working 4s". Once the reply is done it reads "Worked
 * for 9s" and "7 tools", and toggles the work it folded away. The text comes
 * from the `workSummary...` and `toolCall...` chat labels.
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
  const config = useCopilotChatConfiguration();
  const labels = config?.labels ?? CopilotChatDefaultLabels;
  const now = useNow(isWorking);
  const failed = ɵcountFailedToolCalls(calls);
  const toolCount = ɵformatCountLabel(calls.length, {
    one: labels.toolCallToolCountOne,
    other: labels.toolCallToolCountOther,
  });
  const liveMs =
    elapsedMs !== undefined && workingSince !== undefined
      ? elapsedMs + Math.max(0, now - workingSince)
      : undefined;
  // A finished reply worked for at least a second.
  const duration =
    elapsedMs !== undefined
      ? ɵformatWorkDuration(Math.max(1000, elapsedMs))
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
          <span className="cpk-work-summary-label cpk-shimmer">
            {labels.workSummaryWorkingLabel}
          </span>
          {liveMs !== undefined && (
            <span className="cpk-work-summary-detail cpk-work-summary-timer">
              {ɵformatWorkDuration(liveMs)}
            </span>
          )}
        </>
      ) : (
        <>
          <span className="cpk-work-summary-label">
            {duration
              ? ɵformatLabel(labels.workSummaryWorkedForLabel, { duration })
              : ɵformatCountLabel(calls.length, {
                  one: labels.toolCallUsedToolsOne,
                  other: labels.toolCallUsedToolsOther,
                })}
          </span>
          {duration && (
            <span className="cpk-work-summary-detail">{toolCount}</span>
          )}
          {failed > 0 && (
            <span className="cpk-work-summary-failed">
              {ɵformatLabel(labels.toolCallFailedCountLabel, { count: failed })}
            </span>
          )}
        </>
      )}
      <CopilotIcon
        name="ChevronRight"
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
