"use client";
import { useState } from "react";
import { dealRisk, formatCurrency } from "@/lib/crm";
import type { CrmState, Deal, Salesperson } from "@/lib/crm";
import { OwnerAvatar, RiskDot, SectionCard } from "./primitives";

const isOpen = (d: Deal) =>
  d.stage !== "Closed Won" && d.stage !== "Closed Lost";

/** Whole days from now to an ISO close date (negative = overdue). */
function daysToClose(iso: string, now: number): number {
  return Math.ceil((new Date(iso).getTime() - now) / 86_400_000);
}

/** Compact "in 12d" / "today" / "5d ago" label for a days delta. */
function closeLabel(days: number): string {
  if (days === 0) return "today";
  if (days > 0) return `in ${days}d`;
  return `${Math.abs(days)}d ago`;
}

/**
 * Section 5 — the next ~5 open deals by close date (soonest first). Each row:
 * owner avatar, deal + account, amount, days-to-close and a risk dot. Clicking
 * a row selects the deal (drawer lives in the shell).
 */
export function UpcomingCloses({
  crm,
  onSelect,
}: {
  crm: CrmState;
  onSelect: (id: string) => void;
}) {
  // Capture "now" once on mount so the render stays pure (React Compiler) and
  // day counts don't drift between re-renders within a session.
  const [now] = useState(() => Date.now());
  const repById = new Map<string, Salesperson>(
    crm.salespeople.map((s) => [s.id, s]),
  );
  const deals = crm.deals
    .filter(isOpen)
    .sort(
      (a, b) =>
        new Date(a.closeDate).getTime() - new Date(b.closeDate).getTime(),
    )
    .slice(0, 5);

  return (
    <SectionCard title="Upcoming closes">
      {deals.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No open deals scheduled to close.
        </p>
      ) : (
        <ul className="-mx-1 divide-y divide-border/70">
          {deals.map((d) => {
            const account = crm.accounts.find((a) => a.id === d.accountId);
            const owner = repById.get(d.ownerId);
            const days = daysToClose(d.closeDate, now);
            const risk = dealRisk(d, now);
            return (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => onSelect(d.id)}
                  className="flex w-full items-center gap-3 rounded-md px-1 py-2 text-left transition hover:bg-secondary/60"
                >
                  <OwnerAvatar
                    src={owner?.avatarUrl}
                    name={owner?.name ?? d.ownerName}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{d.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {account?.name}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold tabular-nums">
                      {formatCurrency(d.amount)}
                    </div>
                    <div className="flex items-center justify-end gap-1 text-xs text-muted-foreground tabular-nums">
                      <RiskDot risk={risk} />
                      {closeLabel(days)}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
