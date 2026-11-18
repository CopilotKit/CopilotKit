"use client";

import type { Lane } from "../data/types";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<Lane["status"], string> = {
  healthy: "text-positive",
  degraded: "text-ink-muted",
  blocked: "text-negative",
};

export function LaneTable({ lanes }: { lanes: Lane[] }) {
  if (!lanes.length) {
    return <p className="text-sm text-ink-muted">No lanes to show.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-hairline bg-surface shadow-soft">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-ink-muted">
            <th className="px-3 py-2 font-medium">Lane</th>
            <th className="px-3 py-2 font-medium">Mode</th>
            <th className="px-3 py-2 font-medium">Transit</th>
            <th className="px-3 py-2 font-medium">Reliability</th>
            <th className="px-3 py-2 font-medium">Cost/kg</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Note</th>
          </tr>
        </thead>
        <tbody>
          {lanes.map((l) => (
            <tr
              key={l.id}
              className="border-b border-hairline last:border-0 align-top"
            >
              <td className="px-3 py-2.5 font-medium text-ink">
                {l.origin} → {l.destination}
              </td>
              <td className="px-3 py-2.5 capitalize text-ink-muted">
                {l.mode}
              </td>
              <td className="px-3 py-2.5 tabular-nums text-ink">
                {l.transitDays}d
              </td>
              <td className="px-3 py-2.5 tabular-nums text-ink">
                {Math.round(l.reliability * 100)}%
              </td>
              <td className="px-3 py-2.5 tabular-nums text-ink">
                ${l.costPerKg.toFixed(2)}
              </td>
              <td
                className={cn(
                  "px-3 py-2.5 font-medium capitalize",
                  STATUS_TONE[l.status],
                )}
              >
                {l.status}
              </td>
              <td className="px-3 py-2.5 text-ink-muted">{l.note ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
