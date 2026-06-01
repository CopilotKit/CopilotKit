import type { SalesTodo } from "../../types";

const STAGE_COLORS: Record<SalesTodo["stage"], string> = {
  prospect: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  qualified:
    "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  proposal: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  negotiation:
    "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  "closed-won":
    "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  "closed-lost": "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

export interface DealCardProps {
  deal: SalesTodo;
}

export function DealCard({ deal }: DealCardProps) {
  return (
    <div
      data-testid="deal-card"
      className={`rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 transition-all duration-150 ${
        deal.completed ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        {/* Title */}
        <h3
          className={`text-sm font-semibold leading-snug break-words ${
            deal.completed
              ? "text-[var(--muted-foreground)] line-through"
              : "text-[var(--foreground)]"
          }`}
        >
          {deal.title}
        </h3>

        {/* Completion indicator */}
        <span
          data-testid="completion-indicator"
          className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${
            deal.completed ? "bg-[var(--muted-foreground)]" : "bg-green-500"
          }`}
        />
      </div>

      {/* Stage badge + value */}
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        <span
          data-testid="stage-badge"
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_COLORS[deal.stage]}`}
        >
          {deal.stage}
        </span>
        <span className="text-sm font-semibold text-[var(--foreground)]">
          ${deal.value.toLocaleString()}
        </span>
      </div>

      {/* Meta: assignee + due date */}
      <div className="mt-2 flex items-center gap-3 text-xs text-[var(--muted-foreground)]">
        {deal.assignee && <span>{deal.assignee}</span>}
        {deal.dueDate && <span>Due {deal.dueDate}</span>}
      </div>
    </div>
  );
}
