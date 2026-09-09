"use client";

import type { MitigationKind, MitigationOption } from "../data/types";
import { cn } from "@/lib/utils";

const RISK_TONE: Record<MitigationOption["riskLevel"], string> = {
  low: "text-positive",
  medium: "text-ink-muted",
  high: "text-negative",
};

const fmtUsd = (n: number) => (n === 0 ? "—" : `$${n.toLocaleString("en-US")}`);

export function TradeoffTable({
  options,
  authorityUsd,
  onChoose,
}: {
  options: MitigationOption[];
  authorityUsd: number | null;
  onChoose?: (kind: MitigationKind) => void;
}) {
  if (!options.length) {
    return (
      <div className="rounded-lg border border-dashed border-hairline p-4 text-sm text-ink-muted">
        No mitigation options are available for this shipment.
      </div>
    );
  }

  const overAuthority = (cost: number) =>
    authorityUsd !== null && cost > authorityUsd;

  return (
    <div className="overflow-x-auto rounded-lg border border-hairline bg-surface shadow-soft">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-hairline text-left text-xs uppercase tracking-wide text-ink-muted">
            <th className="px-3 py-2 font-medium">Option</th>
            <th className="px-3 py-2 font-medium">Cost</th>
            <th className="px-3 py-2 font-medium">ETA</th>
            <th className="px-3 py-2 font-medium">SLA</th>
            <th className="px-3 py-2 font-medium">Risk</th>
            {onChoose ? <th className="px-3 py-2" /> : null}
          </tr>
        </thead>
        <tbody>
          {options.map((o) => {
            const blocked = overAuthority(o.costUsd);
            return (
              <tr
                key={o.kind}
                className="border-b border-hairline last:border-0 align-top"
              >
                <td className="px-3 py-2.5">
                  <div className="font-medium text-ink">{o.label}</div>
                  <div className="text-xs text-ink-muted">{o.rationale}</div>
                  {blocked ? (
                    <div className="mt-1 text-xs font-medium text-negative">
                      Above your approval authority — needs an escalation.
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2.5 tabular-nums text-ink">
                  {fmtUsd(o.costUsd)}
                </td>
                <td className="px-3 py-2.5 tabular-nums text-ink">
                  {o.etaDate}
                </td>
                <td
                  className={cn(
                    "px-3 py-2.5 font-medium",
                    o.slaMet ? "text-positive" : "text-negative",
                  )}
                >
                  {o.slaMet ? "Met" : "Missed"}
                </td>
                <td
                  className={cn(
                    "px-3 py-2.5 capitalize",
                    RISK_TONE[o.riskLevel],
                  )}
                >
                  {o.riskLevel}
                </td>
                {onChoose ? (
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => onChoose(o.kind)}
                      className="rounded-md bg-brand px-2.5 py-1.5 text-xs font-medium text-brand-foreground hover:opacity-90"
                    >
                      Choose
                    </button>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
