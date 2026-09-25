import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ToolCallStatus } from "@copilotkit/core";
import { CopilotChatApproval } from "./CopilotChatApproval";
import { useCopilotApproval } from "../../hooks/use-copilot-approval";
import type { CopilotApprovalStore } from "../../hooks/use-copilot-approval";

export type CopilotToolApprovalCardProps = {
  toolCallId: string;
  status: ToolCallStatus;
  result?: string;
  controller: CopilotApprovalStore;
};

/** Generative tool UI backed by the exact same trusted approval controller as chat/headless. */
export function CopilotToolApprovalCard({
  toolCallId,
  status,
  result,
  controller,
}: CopilotToolApprovalCardProps) {
  const approval = useCopilotApproval(controller);
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const request = approval?.request;
    if (!request || request.presentation !== "tool") return;
    const hosts = document.querySelectorAll<HTMLElement>(
      "[data-copilot-tool-approval-host]",
    );
    setPortalHost(
      [...hosts].find(
        (host) =>
          host.dataset.agentId === request.agentId &&
          host.dataset.threadId === request.threadId,
      ) ?? null,
    );
  }, [approval?.request]);
  const isThisApproval =
    approval?.request.presentation === "tool" &&
    approval.request.toolCallId === toolCallId;
  if (isThisApproval && approval)
    return (
      <>
        <div
          data-testid="copilot-tool-proposal"
          className="cpk:mx-4 cpk:my-2 cpk:text-sm"
        >
          Proposed change ready for review.
        </div>
        {portalHost ? (
          createPortal(
            <CopilotChatApproval
              request={approval.request}
              onApprove={(event) => approval.respond(event, true)}
              onReject={(event) => approval.respond(event, false)}
            />,
            portalHost,
          )
        ) : (
          <CopilotChatApproval
            request={approval.request}
            onApprove={(event) => approval.respond(event, true)}
            onReject={(event) => approval.respond(event, false)}
          />
        )}
      </>
    );
  if (status === ToolCallStatus.Executing)
    return (
      <div role="status" className="cpk:mx-4 cpk:my-2 cpk:text-sm">
        Working on the reviewed action…
      </div>
    );
  if (status === ToolCallStatus.Complete) {
    let outcome = "Finished";
    try {
      const parsed = JSON.parse(result ?? "") as { status?: string };
      if (parsed.status) outcome = parsed.status;
    } catch {
      // Keep the generic outcome for a plain-text result.
    }
    return (
      <div role="status" className="cpk:mx-4 cpk:my-2 cpk:text-sm">
        Action {outcome}
      </div>
    );
  }
  return null;
}
