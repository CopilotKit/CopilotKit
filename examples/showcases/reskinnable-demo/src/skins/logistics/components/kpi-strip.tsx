"use client";

import type { Shipment } from "../data/types";

/**
 * The four headline KPIs, derived from the live shipment list. Exported so the
 * a2ui StatCard renderer (Task 10) and the OGUI snapshot (Task 13) compute the
 * SAME figures — one definition, three surfaces.
 */
export function deriveKpis(shipments: Shipment[]) {
  const active = shipments.filter((s) => s.status !== "resolved");
  const onTime = shipments.filter((s) => s.etaCurrent <= s.slaDate).length;
  const delays = shipments
    .map((s) => daysBetween(s.etaPlanned, s.etaCurrent))
    .filter((d) => d > 0);
  return {
    onTimeRate: shipments.length ? onTime / shipments.length : 1,
    atRiskCount: active.filter(
      (s) => s.status === "at_risk" || s.status === "delayed",
    ).length,
    exposureUsd: active
      .filter((s) => s.etaCurrent > s.slaDate)
      .reduce((sum, s) => sum + s.valueUsd, 0),
    avgDelayDays: delays.length
      ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length)
      : 0,
  };
}

function daysBetween(fromIso: string, toIso: string): number {
  const ms =
    Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

const fmtUsd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export function KpiStrip({ shipments }: { shipments: Shipment[] }) {
  const k = deriveKpis(shipments);
  const tiles = [
    { label: "On-time rate", value: `${Math.round(k.onTimeRate * 100)}%` },
    { label: "At risk", value: String(k.atRiskCount) },
    { label: "Exposure", value: fmtUsd(k.exposureUsd) },
    { label: "Avg delay", value: `${k.avgDelayDays}d` },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="rounded-lg border border-hairline bg-surface p-4 shadow-soft"
        >
          <div className="text-xs font-medium uppercase tracking-wide text-ink-muted">
            {t.label}
          </div>
          <div className="mt-1 text-2xl font-semibold tracking-tight text-ink">
            {t.value}
          </div>
        </div>
      ))}
    </div>
  );
}
