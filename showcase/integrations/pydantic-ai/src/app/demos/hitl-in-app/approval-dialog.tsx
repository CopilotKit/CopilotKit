"use client";

// Modal dialog rendered at the APP level — positioned with `fixed inset-0`
// and portal'd to <body> so it overlays the whole page cleanly regardless
// of the parent component's CSS context (transforms, overflow, stacking).

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export type PendingApproval = {
  message: string;
  context?: string;
};

type Props = {
  pending: PendingApproval;
  onResolve: (result: { approved: boolean; reason?: string }) => void;
};

export function ApprovalDialog({ pending, onResolve }: Props) {
  const [reason, setReason] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const content = (
    <div
      data-testid="approval-dialog-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#010507]/40 backdrop-blur-sm"
    >
      <div
        data-testid="approval-dialog"
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-2xl border border-[#DBDBE5] bg-white p-6 shadow-sm"
      >
        <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[#57575B]">
          Action requires your approval
        </div>
        <h2 className="mb-3 text-lg font-semibold text-[#010507]">
          {pending.message}
        </h2>
        {pending.context && (
          <p className="mb-4 rounded-xl border border-[#E9E9EF] bg-[#FAFAFC] p-3 text-sm text-[#57575B]">
            {pending.context}
          </p>
        )}
        <label className="mb-1 block text-xs font-medium text-[#57575B]">
          Note (optional)
        </label>
        <textarea
          data-testid="approval-dialog-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Add a short note the assistant will see…"
          className="mb-4 w-full resize-none rounded-xl border border-[#DBDBE5] px-3 py-2 text-sm text-[#010507] focus:border-[#BEC2FF] focus:outline-none focus:ring-2 focus:ring-[#BEC2FF33]"
          rows={2}
        />
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            data-testid="approval-dialog-reject"
            onClick={() =>
              onResolve({
                approved: false,
                reason: reason.trim() || undefined,
              })
            }
            className="rounded-xl border border-[#DBDBE5] bg-white px-4 py-2 text-sm font-medium text-[#57575B] hover:bg-[#FAFAFC] transition-colors"
          >
            Reject
          </button>
          <button
            type="button"
            data-testid="approval-dialog-approve"
            onClick={() =>
              onResolve({
                approved: true,
                reason: reason.trim() || undefined,
              })
            }
            className="rounded-xl bg-[#010507] px-4 py-2 text-sm font-medium text-white hover:bg-[#2B2B2B] transition-colors"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
