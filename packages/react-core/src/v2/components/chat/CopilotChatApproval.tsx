import React from "react";
import { Button } from "../../components/ui/button";
import type { CopilotApprovalRequest } from "../../hooks/use-copilot-approval";

export type CopilotChatApprovalProps = {
  request: CopilotApprovalRequest;
  onApprove: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onReject: (event: React.MouseEvent<HTMLButtonElement>) => void;
};

/** Default non-modal approval card; replace it with the chat's approval slot. */
export function CopilotChatApproval({
  request,
  onApprove,
  onReject,
}: CopilotChatApprovalProps) {
  return (
    <section
      aria-label="Approval required"
      data-testid="copilot-approval"
      className="cpk:mx-4 cpk:mb-2 cpk:rounded-xl cpk:border cpk:border-border cpk:bg-background cpk:p-4 cpk:shadow-md"
    >
      <p className="cpk:mb-1 cpk:text-sm cpk:font-semibold">
        Approval required
      </p>
      <p className="cpk:mb-3 cpk:whitespace-pre-wrap cpk:text-sm">
        {request.description}
      </p>
      <div className="cpk:flex cpk:justify-end cpk:gap-2">
        <Button type="button" variant="outline" onClick={onReject}>
          Decline
        </Button>
        <Button type="button" onClick={onApprove}>
          Approve
        </Button>
      </div>
    </section>
  );
}
