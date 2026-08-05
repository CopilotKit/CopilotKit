"use client";

import { useState } from "react";

/**
 * Approve/Deny for a human-in-the-loop card.
 *
 * `resolved` is the DURABLE signal that this tool call has already been
 * answered, and callers should pass it from the tool call itself (a present
 * `result`, or status "complete"). Local `responded` state alone is not enough:
 * it dies with the component, and these cards do get remounted — the earliest
 * card in a multi-step chain has its subtree replaced when the run syncs, which
 * resurrected live Approve/Deny buttons on an action the user had already
 * taken. Clicking them a second time would fire a duplicate write against an
 * already-settled call.
 *
 * Local state is still kept, because it collapses the buttons on click without
 * waiting for the round trip. The two are OR-ed: whichever knows first wins.
 */
export function ApprovalButtons({
  onApprove,
  onDeny,
  approveLabel = "Approve",
  denyLabel = "Deny",
  resolved = false,
}: {
  onApprove: () => Promise<void> | void;
  onDeny: () => void;
  approveLabel?: string;
  denyLabel?: string;
  resolved?: boolean;
}) {
  const [responded, setResponded] = useState(false);

  if (resolved || responded) {
    return <p className="text-sm italic text-ink-muted">Response submitted.</p>;
  }

  return (
    <div className="flex gap-2">
      <button
        className="brand-gradient flex-1 rounded-full px-4 py-2 text-sm font-medium text-white shadow-[0_6px_16px_hsl(252_83%_60%/0.3)] transition-all hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        onClick={async () => {
          setResponded(true);
          await onApprove();
        }}
      >
        {approveLabel}
      </button>
      <button
        className="flex-1 rounded-full bg-surface-muted px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-brand-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        onClick={() => {
          setResponded(true);
          onDeny();
        }}
      >
        {denyLabel}
      </button>
    </div>
  );
}

export default ApprovalButtons;
