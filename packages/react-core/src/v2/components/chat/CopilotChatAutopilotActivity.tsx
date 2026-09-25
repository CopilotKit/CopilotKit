import React, { useSyncExternalStore } from "react";
import { getAutopilotTrace, subscribeAutopilotTrace } from "@copilotkit/core";

export type CopilotChatAutopilotActivityProps = {
  agentId?: string;
  threadId?: string;
};

/** Optional local action timeline. The app can replace it through the chat slot. */
export function CopilotChatAutopilotActivity({
  agentId,
  threadId,
}: CopilotChatAutopilotActivityProps) {
  const records = useSyncExternalStore(
    subscribeAutopilotTrace,
    getAutopilotTrace,
    getAutopilotTrace,
  ).filter(
    (record) =>
      (!agentId || record.agentId === agentId) &&
      (!threadId || record.threadId === threadId),
  );
  if (!records.length) return null;
  return (
    <section
      aria-label="Autopilot activity"
      data-testid="copilot-autopilot-activity"
      className="cpk:mx-4 cpk:my-3 cpk:rounded-xl cpk:border cpk:border-border cpk:bg-background cpk:p-3 cpk:text-xs"
    >
      <h3 className="cpk:mb-2 cpk:font-semibold">Activity</h3>
      <ol className="cpk:space-y-1">
        {records.slice(-5).map((record) => (
          <li
            key={record.id}
            className="cpk:flex cpk:justify-between cpk:gap-2"
          >
            <span className="cpk:truncate">
              {record.toolName}
              {record.targetRef ? ` · ${record.targetRef}` : ""}
            </span>
            <span className="cpk:shrink-0 cpk:text-muted-foreground">
              {record.phase === "started"
                ? "Working…"
                : (record.error ?? record.status ?? "Done")}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
