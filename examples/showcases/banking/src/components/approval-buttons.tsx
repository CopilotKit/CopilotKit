"use client";

import { useState } from "react";

export function ApprovalButtons({
  onApprove,
  onDeny,
  approveLabel = "Approve",
  denyLabel = "Deny",
}: {
  onApprove: () => Promise<void> | void;
  onDeny: () => void;
  approveLabel?: string;
  denyLabel?: string;
}) {
  const [responded, setResponded] = useState(false);

  if (responded) {
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
