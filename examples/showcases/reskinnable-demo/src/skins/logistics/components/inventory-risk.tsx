"use client";

import type { InventoryRisk } from "../data/types";
import { cn } from "@/lib/utils";

/**
 * At-risk SKUs first, then the tightest cover next. Exported so the Inventory
 * page's beat-3b readable and this list share ONE ordering rather than each
 * carrying a copy of the comparator — see `orderExceptionRows`.
 */
export function orderInventoryRows(items: InventoryRisk[]): InventoryRisk[] {
  return [...items].sort(
    (a, b) =>
      Number(b.atRisk) - Number(a.atRisk) || a.daysOfCover - b.daysOfCover,
  );
}

export function InventoryRiskList({ items }: { items: InventoryRisk[] }) {
  if (!items.length) {
    return <p className="text-sm text-ink-muted">No inventory risk to show.</p>;
  }

  const rows = orderInventoryRows(items);

  return (
    <ul className="space-y-2">
      {rows.map((item) => {
        const belowFloor = item.daysOfCover < item.safetyStockDays;
        return (
          <li
            key={item.skuId}
            className="rounded-lg border border-hairline bg-surface p-3 shadow-soft"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium text-ink">{item.name}</div>
                <div className="text-xs text-ink-muted">{item.skuId}</div>
              </div>
              <div className="text-right text-sm">
                <div
                  className={cn(
                    "font-semibold tabular-nums",
                    belowFloor ? "text-negative" : "text-ink",
                  )}
                >
                  {item.daysOfCover}d cover
                </div>
                <div className="text-xs text-ink-muted tabular-nums">
                  floor {item.safetyStockDays}d
                </div>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted tabular-nums">
              <span>On hand {item.onHandUnits.toLocaleString("en-US")}</span>
              <span>Demand {item.dailyDemand.toLocaleString("en-US")}/day</span>
            </div>
            {item.inboundShipmentIds.length ? (
              <div className="mt-2 text-xs text-ink-muted">
                Inbound:{" "}
                <span className="text-ink">
                  {item.inboundShipmentIds.join(", ")}
                </span>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
