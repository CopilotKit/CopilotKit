import React from "react";
import type { Message } from "@ag-ui/client";

type Snapshot =
  | {
      version: 1;
      decisions: {
        requestId: string;
        toolCallId: string;
        approved: boolean;
        status: "waiting";
      }[];
    }
  | { error: true };
/** Read-only saved approvals, separate from unanswered interrupt controls. */
export function CopilotChatApprovalDecisions({
  snapshot,
  messages,
}: {
  snapshot?: Snapshot;
  messages: Message[];
}): React.ReactElement | null {
  if (!snapshot) return null;
  if ("error" in snapshot)
    return <p role="alert">Saved approval decisions could not be displayed.</p>;
  if (!snapshot.decisions.length) return null;
  const completed = new Set(
    messages
      .filter((message) => message.role === "tool")
      .map((message) => message.toolCallId),
  );
  return (
    <section
      aria-label="Saved approval decisions"
      className="cpk:my-3 cpk:rounded-lg cpk:border cpk:p-3 cpk:text-sm"
    >
      {snapshot.decisions.map((decision) => (
        <div key={decision.requestId} className="cpk:py-1">
          <strong>
            {decision.approved ? "Approved" : "Declined"} ·{" "}
            {completed.has(decision.toolCallId)
              ? "Result recorded"
              : "Waiting for remaining decisions"}
          </strong>
          <p>
            Request: {decision.requestId} · Tool call: {decision.toolCallId}
          </p>
        </div>
      ))}
    </section>
  );
}
