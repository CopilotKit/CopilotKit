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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
    >
      <div
        data-testid="approval-dialog"
        role="dialog"
        aria-modal="true"
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
      >
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-amber-600">
          Action requires your approval
        </div>
        <h2 className="mb-3 text-lg font-semibold text-gray-900">
          {pending.message}
        </h2>
        {pending.context && (
          <p className="mb-4 rounded-md bg-gray-50 p-3 text-sm text-gray-700">
            {pending.context}
          </p>
        )}
        <label className="mb-1 block text-xs font-medium text-gray-600">
          Note (optional)
        </label>
        <textarea
          data-testid="approval-dialog-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Add a short note the assistant will see…"
          className="mb-4 w-full resize-none rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
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
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
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
