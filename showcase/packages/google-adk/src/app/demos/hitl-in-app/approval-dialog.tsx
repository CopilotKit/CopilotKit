"use client";

import React from "react";

export interface ApprovalRequest {
  id: string;
  summary: string;
  reason: string;
  resolve: (decision: { accepted: boolean; reason?: string }) => void;
}

export function ApprovalDialog({ request }: { request: ApprovalRequest }) {
  return (
    <div
      data-testid="approval-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-slate-200">
        <header className="mb-3">
          <h3 className="text-lg font-semibold text-slate-900">
            Action requires approval
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            The agent has paused and is waiting on you.
          </p>
        </header>
        <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 mb-2">
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">
            Proposed action
          </div>
          <div className="text-sm font-medium text-slate-900">
            {request.summary}
          </div>
        </div>
        <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 mb-4">
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">
            Reason
          </div>
          <div className="text-sm text-slate-700">{request.reason}</div>
        </div>
        <div className="flex gap-2">
          <button
            data-testid="approval-reject"
            type="button"
            className="flex-1 rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
            onClick={() => request.resolve({ accepted: false })}
          >
            Reject
          </button>
          <button
            data-testid="approval-approve"
            type="button"
            className="flex-1 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"
            onClick={() => request.resolve({ accepted: true })}
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
