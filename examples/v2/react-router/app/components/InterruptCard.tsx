import { useState } from "react";
import type { Interrupt } from "@copilotkit/react-core/v2";

export interface InterruptCardProps {
  interrupt: Interrupt;
  index?: number;
  total?: number;
  onResolve: (payload: unknown) => void;
  onCancel: () => void;
}

type Addressed = "approved" | "rejected" | "cancelled";

/**
 * Default reusable interrupt UI for one AG-UI Interrupt.
 *
 * With multiple interrupts open, `useInterrupt` accumulates responses and only
 * resumes once EVERY interrupt is addressed — so a single card's click won't
 * re-render the set. This component therefore tracks its own "addressed" state
 * to give immediate per-card feedback (and disable its buttons) while the rest
 * are still pending. When the run resumes, the whole set unmounts.
 */
export function InterruptCard({
  interrupt,
  index,
  total,
  onResolve,
  onCancel,
}: InterruptCardProps) {
  const [addressed, setAddressed] = useState<Addressed | null>(null);
  const multi = typeof total === "number" && total > 1;

  const act = (kind: Addressed, fn: () => void) => {
    if (addressed) return;
    setAddressed(kind);
    fn();
  };

  if (addressed) {
    const label =
      addressed === "approved"
        ? "✓ Approved"
        : addressed === "rejected"
          ? "✗ Rejected"
          : "Cancelled";
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-500">
        <span className="font-medium text-gray-700">{label}</span>
        {" — "}
        {interrupt.message ?? interrupt.reason}
        {multi && (
          <span className="ml-1 text-xs text-gray-400">
            (waiting for the others…)
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-yellow-700">
          {interrupt.reason}
        </span>
        {multi && typeof index === "number" && (
          <span className="text-xs text-yellow-600">
            {index + 1} / {total}
          </span>
        )}
      </div>
      <p className="mb-3 text-sm text-yellow-900">
        {interrupt.message ?? "Action requires your confirmation."}
      </p>
      <div className="flex gap-2">
        <button
          onClick={() => act("approved", () => onResolve({ approved: true }))}
          className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
        >
          Approve
        </button>
        <button
          onClick={() => act("rejected", () => onResolve({ approved: false }))}
          className="rounded-md bg-red-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-600"
        >
          Reject
        </button>
        <button
          onClick={() => act("cancelled", onCancel)}
          className="rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
