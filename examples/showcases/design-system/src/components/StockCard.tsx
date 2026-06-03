"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { TrendingDown, TrendingUp } from "lucide-react";
import type { Stock } from "@/lib/stocks";

const fmtCurrency = (n: number) =>
  n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });

const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

export function StockCard({ stock }: { stock: Stock }) {
  const up = stock.changePct >= 0;
  const sparkData = stock.sparkline.map((value, i) => ({ i, value }));

  const high = Math.max(...stock.sparkline);
  const low = Math.min(...stock.sparkline);
  const open = stock.sparkline[0];

  const lineColor = up ? "#189370" : "#fa5f67";
  const fillId = `${stock.ticker}-fill-${up ? "up" : "down"}`;

  return (
    <div className="surface p-5 flex flex-col gap-4 min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--ink)] font-semibold">
            {stock.ticker} · {stock.sector}
          </span>
          <span className="text-[14px] text-[var(--ink)] font-medium truncate">
            {stock.company}
          </span>
        </div>
        <span
          className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider px-2 py-1 rounded-full font-semibold"
          style={{
            background: up ? "var(--positive-soft)" : "var(--negative-soft)",
            color: up ? "#0a5d44" : "#7a1b22",
          }}
        >
          {up ? (
            <TrendingUp size={12} strokeWidth={2.4} />
          ) : (
            <TrendingDown size={12} strokeWidth={2.4} />
          )}
          {fmtPct(stock.changePct)}
        </span>
      </div>

      <div className="flex items-baseline justify-between gap-3">
        <span className="font-display text-[30px] font-semibold tracking-tight text-[var(--ink)] tabular-nums leading-none">
          {fmtCurrency(stock.price)}
        </span>
        <span className="font-mono text-[11px] text-[var(--ink)] tabular-nums font-medium">
          MCAP {stock.marketCap}
        </span>
      </div>

      <div className="h-[72px] -mx-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={sparkData}
            margin={{ top: 4, right: 4, left: 4, bottom: 0 }}
          >
            <defs>
              <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={lineColor} stopOpacity={0.28} />
                <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <YAxis hide domain={["dataMin", "dataMax"]} />
            <Area
              type="monotone"
              dataKey="value"
              stroke={lineColor}
              strokeWidth={2}
              fill={`url(#${fillId})`}
              dot={false}
              isAnimationActive={false}
            />
            <Tooltip
              contentStyle={{
                background: "var(--surface)",
                border: "1px solid var(--line)",
                borderRadius: 8,
                fontSize: 11,
                padding: "4px 8px",
                color: "var(--ink)",
              }}
              labelFormatter={() => ""}
              formatter={(v: unknown) => [fmtCurrency(Number(v)), stock.ticker]}
              separator=" "
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-3 gap-3 pt-3 border-t border-[var(--line)]">
        <Stat label="Open" value={fmtCurrency(open)} />
        <Stat label="High" value={fmtCurrency(high)} />
        <Stat label="Low" value={fmtCurrency(low)} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-[var(--ink)] font-semibold">
        {label}
      </span>
      <span className="font-mono text-[12px] tabular-nums text-[var(--ink)] font-medium">
        {value}
      </span>
    </div>
  );
}
