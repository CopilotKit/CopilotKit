"use client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Sparkline } from "@/components/charts";
import { cn } from "@/lib/utils";
import { formatCurrency, STAGE_STYLES } from "@/lib/crm";
import type { Deal, Salesperson } from "@/lib/crm";

export interface RepStatsResult {
  rep: Salesperson;
  bookings: number;
  openPipeline: number;
  attainment: number;
  winRate: number | null;
  dealCount: number;
  trend: number[];
  deals: Deal[];
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-foreground tabular-nums">
        {value}
      </div>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function RepStatsCard({
  result,
  status,
}: {
  result?: RepStatsResult;
  status: string;
}) {
  if (status !== "complete") {
    return (
      <div className="rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">
        Pulling up the rep’s numbers…
      </div>
    );
  }
  if (!result || !result.rep) {
    return (
      <div className="rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">
        Rep stats aren’t available right now.
      </div>
    );
  }

  const { rep } = result;
  const topDeals = [...result.deals]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 4);

  return (
    <div className="rounded-xl border border-border bg-card p-4 text-sm shadow-sm">
      <div className="flex items-center gap-3">
        <Avatar size="lg">
          <AvatarImage src={rep.avatarUrl} alt={rep.name} />
          <AvatarFallback>{initials(rep.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-foreground">
            {rep.name}
          </div>
          <div className="text-xs text-muted-foreground">
            {rep.role} · {rep.region}
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Bookings" value={formatCurrency(result.bookings)} />
        <Tile
          label="Open pipeline"
          value={formatCurrency(result.openPipeline)}
        />
        <Tile
          label="Attainment"
          value={`${Math.round(result.attainment * 100)}%`}
        />
        <Tile
          label="Win rate"
          value={
            result.winRate === null
              ? "—"
              : `${Math.round(result.winRate * 100)}%`
          }
        />
      </div>

      {result.trend && result.trend.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium text-muted-foreground">
            Bookings trend
          </div>
          <Sparkline className="mt-1" data={result.trend} />
        </div>
      )}

      {topDeals.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium text-muted-foreground">
            Top deals
          </div>
          <ul className="mt-1 divide-y divide-border">
            {topDeals.map((d) => (
              <li key={d.id} className="flex items-center gap-2 py-1.5">
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                  {d.name}
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                    STAGE_STYLES[d.stage],
                  )}
                >
                  {d.stage}
                </span>
                <span className="shrink-0 text-right font-medium text-foreground tabular-nums">
                  {formatCurrency(d.amount)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
