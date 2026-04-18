"use client";

import React from "react";

// Shape of the payload the agent passes to `interrupt(...)` on the backend.
// We keep these optional so the card stays defensive for unknown shapes.
export type InterruptPayload = {
  message?: string;
  details?: Record<string, unknown>;
};

export type InterruptCardProps = {
  payload: InterruptPayload;
  onApprove: () => void;
  onCancel: () => void;
};

/**
 * In-chat confirmation card rendered by `useInterrupt` when the backend
 * `ask_confirmation` tool pauses the graph via `interrupt(...)`.
 *
 * Clicking Approve/Cancel calls the `resolve(...)` function forwarded from
 * the hook, which resumes the graph with `{ approved: bool }`.
 */
export function InterruptCard({
  payload,
  onApprove,
  onCancel,
}: InterruptCardProps) {
  const message =
    typeof payload.message === "string"
      ? payload.message
      : "The agent is waiting for your confirmation to continue.";

  return (
    <div
      className="rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm max-w-md"
      data-testid="interrupt-card"
    >
      <p className="text-sm font-semibold text-amber-900 mb-1">
        Confirmation required
      </p>
      <p className="text-sm text-amber-800 mb-3">{message}</p>

      {payload.details && (
        <pre className="text-xs bg-white/70 rounded-md p-2 mb-3 overflow-x-auto text-amber-900">
          {JSON.stringify(payload.details, null, 2)}
        </pre>
      )}

      <div className="flex gap-2">
        <button
          onClick={onApprove}
          className="flex-1 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
          data-testid="interrupt-approve"
        >
          Approve
        </button>
        <button
          onClick={onCancel}
          className="flex-1 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100"
          data-testid="interrupt-reject"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
