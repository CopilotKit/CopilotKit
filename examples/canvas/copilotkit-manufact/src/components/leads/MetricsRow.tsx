"use client";

import type { Lead } from "@/lib/leads/types";
import { optInRate, topWorkshop, toolUsage, workshopClass } from "@/lib/leads/derive";
import { useCountUp } from "@/lib/leads/hooks";

interface MetricsRowProps {
  leads: Lead[];
}

export function MetricsRow({ leads }: MetricsRowProps) {
  const opt = optInRate(leads);
  const top = topWorkshop(leads);
  const tools = toolUsage(leads);
  const topTool = tools[0]?.label ?? "—";
  const topToolCount = tools[0]?.count ?? 0;

  const total = useCountUp(leads.length);
  const optPct = useCountUp(opt.pct);
  const optYes = useCountUp(opt.yes);
  const topToolCountAnim = useCountUp(topToolCount);

  return (
    <div className="grid grid-cols-2 gap-3 pb-4 md:grid-cols-4">
      <Metric label="Total leads" value={total.toString()} />
      <Metric
        label="Opt-in rate"
        value={`${optPct}%`}
        sub={`${optYes} of ${total}`}
        accent="bg-emerald-500"
        accentWidth={`${optPct}%`}
      />
      <Metric
        label="Top workshop demand"
        value={top ?? "—"}
        valueClass={
          top
            ? `inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${workshopClass(top)}`
            : ""
        }
      />
      <Metric
        label="Most-used tool"
        value={topTool}
        sub={topToolCountAnim ? `${topToolCountAnim} signups` : undefined}
      />
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  valueClass,
  accent,
  accentWidth,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
  accent?: string;
  accentWidth?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 truncate">
        {valueClass ? (
          <span className={valueClass}>{value}</span>
        ) : (
          <span className="text-lg font-semibold tabular-nums text-foreground">
            {value}
          </span>
        )}
      </div>
      {sub ? (
        <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
          {sub}
        </div>
      ) : null}
      {accent ? (
        <div className="mt-2 h-1 overflow-hidden rounded bg-muted">
          <div
            className={`h-full transition-all duration-300 ease-out ${accent}`}
            style={{ width: accentWidth ?? "0%" }}
          />
        </div>
      ) : null}
    </div>
  );
}
