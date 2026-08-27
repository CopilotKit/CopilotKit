"use client";

import type { Decision } from "../data/types";
import { cn } from "@/lib/utils";

const fmtUsd = (n: number) =>
  n === 0 ? "—" : `$${Math.round(n).toLocaleString("en-US")}`;

const STATUS_TONE: Record<Decision["status"], string> = {
  committed: "bg-positive-soft text-positive",
  escalated: "bg-negative-soft text-negative",
};

/**
 * Newest first. Exported so the Decision Log page's beat-3b readable and this
 * list share ONE ordering rather than each carrying a copy of the comparator —
 * see `orderExceptionRows`.
 */
export function orderDecisionRows(decisions: Decision[]): Decision[] {
  return [...decisions].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function DecisionLog({ decisions }: { decisions: Decision[] }) {
  if (!decisions.length) {
    return <p className="text-sm text-ink-muted">No decisions filed yet.</p>;
  }

  const rows = orderDecisionRows(decisions);

  return (
    <ul className="space-y-2">
      {rows.map((d) => (
        <li
          key={d.id}
          className="rounded-lg border border-hairline bg-surface p-3 shadow-soft"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-surface-muted px-1.5 py-0.5 text-xs font-medium capitalize text-ink-muted">
                {d.kind}
              </span>
              <span className="font-medium text-ink">{d.shipmentId}</span>
              <span className="text-sm tabular-nums text-ink-muted">
                {fmtUsd(d.costUsd)}
              </span>
            </div>
            <span
              className={cn(
                "rounded-md px-2 py-0.5 text-xs font-medium capitalize",
                STATUS_TONE[d.status],
              )}
            >
              {d.status}
            </span>
          </div>
          <p className="mt-2 text-sm text-ink">{d.rationale}</p>
          <div className="mt-1 text-xs text-ink-muted">
            {d.decidedBy} · {d.role}
          </div>
        </li>
      ))}
    </ul>
  );
}
