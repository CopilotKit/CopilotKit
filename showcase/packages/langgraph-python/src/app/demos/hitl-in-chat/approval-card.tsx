"use client";

import React, { useState } from "react";

export type ApprovalCardStatus = "inProgress" | "executing" | "complete";

export interface ApprovalCardProps {
  args: { action?: string; target?: string };
  status: ApprovalCardStatus;
  respond?: (result: unknown) => void;
}

export function ApprovalCard({ args, status, respond }: ApprovalCardProps) {
  const [decided, setDecided] = useState<"approved" | "rejected" | null>(null);
  const action = args?.action ?? "this action";
  const target = args?.target ?? "";
  const disabled = status !== "executing" || decided !== null;

  return (
    <div
      className="rounded-xl border border-gray-200 bg-white p-6 shadow-lg w-[460px]"
      data-testid="confirm-card"
    >
      <h3 className="text-lg font-bold text-gray-800 mb-1">Confirm action</h3>
      <p className="text-sm text-gray-600 mb-4">
        The agent wants to <span className="font-semibold">{action}</span>
        {target ? (
          <>
            {" "}
            on <span className="font-semibold">{target}</span>
          </>
        ) : null}
        . This cannot be undone.
      </p>

      {decided === null ? (
        <div className="flex gap-3">
          <button
            disabled={disabled}
            onClick={() => {
              setDecided("rejected");
              respond?.({ approved: false });
            }}
            className="flex-1 rounded-lg border border-gray-300 px-4 py-2 font-medium hover:bg-gray-50 disabled:opacity-50"
          >
            Reject
          </button>
          <button
            disabled={disabled}
            onClick={() => {
              setDecided("approved");
              respond?.({ approved: true });
            }}
            className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-white font-medium hover:bg-red-700 disabled:opacity-50"
          >
            Approve
          </button>
        </div>
      ) : (
        <div
          className={`text-center py-2 rounded-lg font-medium ${
            decided === "approved"
              ? "bg-red-50 text-red-700"
              : "bg-gray-50 text-gray-700"
          }`}
        >
          {decided === "approved" ? "Approved" : "Rejected"}
        </div>
      )}
    </div>
  );
}
