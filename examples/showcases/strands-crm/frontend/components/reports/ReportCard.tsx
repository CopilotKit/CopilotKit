"use client";
import { Card } from "@/components/ui/card";
import { formatCurrency, relativeTime } from "@/lib/crm";
import type { Report } from "@/lib/crm";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";

/** Date range label like "May 25 – 31" (compact, same-month aware). */
function periodLabel(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const sameMonth =
    start.getUTCMonth() === end.getUTCMonth() &&
    start.getUTCFullYear() === end.getUTCFullYear();
  const startStr = start.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const endStr = end.toLocaleDateString(
    "en-US",
    sameMonth
      ? { day: "numeric", timeZone: "UTC" }
      : { month: "short", day: "numeric", timeZone: "UTC" },
  );
  return `${startStr} – ${endStr}`;
}

/**
 * A single weekly report summary row for the reports list. Shows the title,
 * its period + generated-at relative time, and two headline metrics
 * (bookings, weighted forecast). Highlights when selected; subtle hover.
 */
export function ReportCard({
  report,
  selected,
  onSelect,
}: {
  report: Report;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const { metrics } = report;
  return (
    <Card
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect?.();
        }
      }}
      className={cn(
        "cursor-pointer gap-3 py-4 transition hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected && "border-primary ring-2 ring-primary/30",
      )}
    >
      <div className="flex items-start justify-between gap-3 px-6">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{report.title}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {periodLabel(report.periodStart, report.periodEnd)} · generated{" "}
            {relativeTime(report.generatedAt)}
          </div>
        </div>
        <ChevronRight
          className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
      </div>
      <div className="grid grid-cols-2 gap-3 px-6">
        <div>
          <div className="text-xs text-muted-foreground">Bookings</div>
          <div className="text-base font-semibold tabular-nums">
            {formatCurrency(metrics.bookings)}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Weighted forecast</div>
          <div className="text-base font-semibold tabular-nums">
            {formatCurrency(metrics.weightedForecast)}
          </div>
        </div>
      </div>
    </Card>
  );
}
