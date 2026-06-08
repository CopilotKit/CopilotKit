import { formatCurrency } from "../lib/crm";
import type { Stage } from "../lib/crm";

export interface DealBrief {
  dealId: string;
  dealName: string;
  accountName: string;
  stage: Stage;
  amount: number;
  probability: number;
  keyContact?: { name: string; title: string; email: string };
  lastActivity?: { type: string; body: string; createdAt: string };
  risk: "low" | "medium" | "high";
  nextStep: string;
}

export function DealBriefCard({
  brief,
  status,
}: {
  brief?: DealBrief;
  status: string;
}) {
  if (status !== "complete" || !brief) {
    return (
      <div className="rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">
        Preparing the deal brief…
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-border bg-card p-4 text-sm shadow-sm">
      <div className="flex items-center justify-between">
        <span className="font-semibold">{brief.dealName}</span>
        <span className="text-xs text-muted-foreground">{brief.stage}</span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {brief.accountName}
      </div>
      <div className="mt-2 flex items-center gap-4">
        <span className="font-semibold tabular-nums">
          {formatCurrency(brief.amount)}
        </span>
        <span className="text-muted-foreground tabular-nums">
          {brief.probability}%
        </span>
        <span style={{ color: `var(--risk-${brief.risk})` }}>
          Risk: {brief.risk}
        </span>
      </div>
      {brief.keyContact && (
        <div className="mt-2 text-muted-foreground">
          Champion: {brief.keyContact.name} ({brief.keyContact.title})
        </div>
      )}
      {brief.lastActivity && (
        <div className="mt-1 text-muted-foreground">
          Last: [{brief.lastActivity.type}] {brief.lastActivity.body}
        </div>
      )}
      <div className="mt-2 rounded-lg bg-accent p-2 text-accent-foreground">
        Next: {brief.nextStep}
      </div>
    </div>
  );
}
