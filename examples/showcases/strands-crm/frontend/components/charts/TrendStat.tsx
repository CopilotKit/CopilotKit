import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Sparkline } from "./Sparkline";

/**
 * KPI card: a label, a big tabular value, an optional ▲/▼ delta chip (colored
 * by sign) and an optional inline sparkline. Built on the shadcn Card with a
 * subtle hover lift. `delta` is a signed percentage-style number (e.g. 12, -4).
 */
export function TrendStat({
  label,
  value,
  delta,
  data,
  hint,
  className,
}: {
  label: string;
  value: string;
  delta?: number;
  data?: number[];
  hint?: string;
  className?: string;
}) {
  const hasDelta = typeof delta === "number" && Number.isFinite(delta);
  const up = hasDelta && delta! >= 0;

  return (
    <Card
      className={cn(
        "gap-0 p-4 transition hover:-translate-y-0.5 hover:shadow-md",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
        {hasDelta && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums",
              up
                ? "bg-emerald-100 text-emerald-700"
                : "bg-rose-100 text-rose-700",
            )}
          >
            <span aria-hidden>{up ? "▲" : "▼"}</span>
            {Math.abs(delta!)}%
          </span>
        )}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint ? (
        <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>
      ) : null}
      {data && data.length > 0 ? (
        <div className="mt-3">
          <Sparkline
            data={data}
            stroke={up ? "var(--chart-1)" : "var(--chart-5)"}
          />
        </div>
      ) : null}
    </Card>
  );
}
