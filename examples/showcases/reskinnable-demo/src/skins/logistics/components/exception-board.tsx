"use client";

import type { Lane, Shipment } from "../data/types";
import { cn } from "@/lib/utils";

const fmtUsd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

// Worst-first: delayed outranks at_risk, which outranks everything else.
const STATUS_RANK: Record<Shipment["status"], number> = {
  delayed: 0,
  at_risk: 1,
  on_track: 2,
  resolved: 3,
};

/**
 * The board's row order, worst first. Exported because the Control Tower's
 * beat-3b readable must describe the rows IN THE ORDER SHOWN, and the only way
 * that stays true is for the page and the board to share one function rather
 * than each carrying a copy of this comparator. The board still calls it on
 * whatever it is handed, so every other caller (the gen-UI `showExceptions`
 * card) keeps the ordering for free, and re-ordering an already-ordered array
 * is a no-op.
 */
export function orderExceptionRows(shipments: Shipment[]): Shipment[] {
  return [...shipments].sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.valueUsd - a.valueUsd,
  );
}

export function ExceptionBoard({
  shipments,
  lanes,
  onSelect,
}: {
  shipments: Shipment[];
  lanes: Lane[];
  onSelect?: (id: string) => void;
}) {
  if (!shipments.length) {
    return (
      <p className="text-sm text-ink-muted">No exceptions on the board.</p>
    );
  }

  const laneById = new Map(lanes.map((l) => [l.id, l]));
  const rows = orderExceptionRows(shipments);

  return (
    <div className="overflow-x-auto rounded-lg border border-hairline bg-surface shadow-soft">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-ink-muted">
            <th className="px-3 py-2 font-medium">Reference</th>
            <th className="px-3 py-2 font-medium">Lane</th>
            <th className="px-3 py-2 font-medium">Carrier</th>
            <th className="px-3 py-2 font-medium">Exception</th>
            <th className="px-3 py-2 font-medium">ETA / SLA</th>
            <th className="px-3 py-2 font-medium">Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const lane = laneById.get(s.laneId);
            const missed = s.etaCurrent > s.slaDate;
            return (
              <tr
                key={s.id}
                onClick={onSelect ? () => onSelect(s.id) : undefined}
                className={cn(
                  "border-b border-hairline last:border-0 align-top",
                  onSelect && "cursor-pointer hover:bg-surface-muted",
                )}
              >
                <td className="px-3 py-2.5 font-medium text-ink">
                  {s.reference}
                </td>
                <td className="px-3 py-2.5 text-ink-muted">
                  {lane ? `${lane.origin} → ${lane.destination}` : s.laneId}
                </td>
                <td className="px-3 py-2.5 text-ink-muted">{s.carrier}</td>
                <td className="px-3 py-2.5">
                  {s.exception ? (
                    <span className="rounded-md bg-surface-muted px-1.5 py-0.5 text-xs font-medium text-ink-muted">
                      {s.exception.code}
                    </span>
                  ) : (
                    <span className="text-xs text-ink-muted">—</span>
                  )}
                </td>
                <td
                  className={cn(
                    "px-3 py-2.5 tabular-nums",
                    missed ? "text-negative" : "text-ink",
                  )}
                >
                  {s.etaCurrent}
                  <span className="text-ink-muted"> / {s.slaDate}</span>
                </td>
                <td className="px-3 py-2.5 tabular-nums text-ink">
                  {fmtUsd(s.valueUsd)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
