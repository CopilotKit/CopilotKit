"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type PortfolioRow = { ticker: string; value: number };

export function PortfolioBar({
  rows,
  height = 220,
  title,
}: {
  rows: PortfolioRow[];
  height?: number;
  title?: string;
}) {
  const data = rows.map((r) => ({ ...r }));

  return (
    <div className="surface p-5 flex flex-col gap-3 min-w-[320px]">
      {title && (
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--muted)]">
          {title}
        </span>
      )}
      <div style={{ width: "100%", height }}>
        <ResponsiveContainer>
          <BarChart
            data={data}
            margin={{ top: 16, right: 12, left: 0, bottom: 4 }}
          >
            <CartesianGrid
              stroke="var(--line)"
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis
              dataKey="ticker"
              tick={{ fill: "var(--ink-2)", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "var(--line)" }}
            />
            <YAxis
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={40}
            />
            <Tooltip
              contentStyle={{
                background: "var(--surface)",
                border: "1px solid var(--line)",
                borderRadius: 8,
                fontSize: 12,
                color: "var(--ink)",
              }}
              cursor={{ fill: "var(--accent-soft)" }}
            />
            <Bar dataKey="value" fill="var(--accent)" radius={[4, 4, 0, 0]}>
              <LabelList
                dataKey="value"
                position="top"
                style={{
                  fontSize: 10,
                  fill: "var(--muted)",
                  fontWeight: 500,
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
