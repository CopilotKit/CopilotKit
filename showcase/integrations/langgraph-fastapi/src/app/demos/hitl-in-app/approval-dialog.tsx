"use client";

// @region[approval-dialog]
// Modal dialog rendered at the APP level (portal'd to <body>) — not
// inside the chat bubble tree. The caller supplies `pending` (the
// message/context the agent wants approval for) and an `onResolve`
// completion callback. The user's click on Approve / Reject fires the
// callback, which resolves the pending frontend-tool Promise back in
// the parent page.

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
        className="w-full max-w-md rounded-2xl border border-[#DBDBE5] bg-white p-6 shadow-sm dark:border-border dark:bg-card"
      >
        <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[#57575B] dark:text-muted-foreground">
          Action requires your approval
        </div>
        <h2 className="mb-3 text-lg font-semibold text-[#010507] dark:text-foreground">
          {pending.message}
        </h2>
        {pending.context && (
          <p className="mb-4 rounded-xl border border-[#E9E9EF] bg-[#FAFAFC] p-3 text-sm text-[#57575B] dark:border-border dark:bg-muted dark:text-muted-foreground">
            {pending.context}
          </p>
        )}
        <label className="mb-1 block text-xs font-medium text-[#57575B] dark:text-muted-foreground">
          Note (optional)
        </label>
        <textarea
          data-testid="approval-dialog-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Add a short note the assistant will see…"
          className="mb-4 w-full resize-none rounded-xl border border-[#DBDBE5] px-3 py-2 text-sm text-[#010507] focus:border-[#BEC2FF] focus:outline-none focus:ring-2 focus:ring-[#BEC2FF33] dark:border-border dark:bg-card dark:text-foreground"
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
            className="rounded-xl border border-[#DBDBE5] bg-white px-4 py-2 text-sm font-medium text-[#57575B] hover:bg-[#FAFAFC] transition-colors dark:border-border dark:bg-card dark:text-muted-foreground dark:hover:bg-muted"
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
            className="rounded-xl bg-[#010507] px-4 py-2 text-sm font-medium text-white hover:bg-[#2B2B2B] transition-colors dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
// @endregion[approval-dialog]
