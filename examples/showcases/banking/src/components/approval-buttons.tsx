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
    return <p className="text-sm text-gray-500 italic">Response submitted.</p>;
  }

  return (
    <div className="flex gap-2">
      <button
        className="flex-1 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
        onClick={async () => {
          setResponded(true);
          await onApprove();
        }}
      >
        {approveLabel}
      </button>
      <button
        className="flex-1 rounded-md bg-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-300"
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
