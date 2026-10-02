"use client";

import { CHART_COLORS } from "./chart-config";

export interface PieChartDatum {
  label: string;
  value: number;
}

export interface PieChartComponentProps {
  title: string;
  description?: string | null;
  data: PieChartDatum[];
}

function DonutChart({
  data,
  size = 240,
  strokeWidth = 40,
}: {
  data: PieChartDatum[];
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;
  const total = data.reduce((sum, d) => sum + (Number(d.value) || 0), 0);

  let accumulated = 0;
  const slices = data.map((item, i) => {
    const arc =
      (total > 0 ? (Number(item.value) || 0) / total : 0) * circumference;
    const dashoffset = -accumulated;
    accumulated += arc;
    return {
      arc,
      gap: circumference - arc,
      dashoffset,
      color: CHART_COLORS[i % CHART_COLORS.length],
    };
  });

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${size} ${size}`}
      className="block mx-auto"
      style={{ maxWidth: size, transform: "scaleX(-1)" }}
    >
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="var(--secondary)"
        strokeWidth={strokeWidth}
      />
      {slices.map((s, i) => (
        <circle
          key={i}
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={s.color}
          strokeWidth={strokeWidth}
          strokeDasharray={`${s.arc} ${s.gap}`}
          strokeDashoffset={s.dashoffset}
          strokeLinecap="butt"
          transform={`rotate(-90 ${center} ${center})`}
        />
      ))}
    </svg>
  );
}

export function PieChart({ title, description, data }: PieChartComponentProps) {
  const hasData = Array.isArray(data) && data.length > 0;
  const total = hasData
    ? data.reduce((sum, d) => sum + (Number(d.value) || 0), 0)
    : 0;

  return (
    <div
      data-testid="pie-chart"
      className="max-w-lg mx-auto my-4 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)]"
    >
      <div className="p-6 pb-0">
        <h3 className="text-lg font-semibold leading-none tracking-tight text-[var(--foreground)]">
          {title}
        </h3>
        {description ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            {description}
          </p>
        ) : null}
      </div>
      <div className="p-6 pt-4">
        {hasData ? (
          <>
            <DonutChart data={data} />
            <div className="space-y-2 pt-4">
              {data.map((item, i) => {
                const val = Number(item.value) || 0;
                const pct = total > 0 ? ((val / total) * 100).toFixed(0) : 0;
                return (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <span
                      className="inline-block h-3 w-3 rounded-full shrink-0"
                      style={{
                        backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
                      }}
                    />
                    <span className="flex-1 text-[var(--foreground)] truncate">
                      {item.label}
                    </span>
                    <span className="text-[var(--muted-foreground)] tabular-nums">
                      {val.toLocaleString()}
                    </span>
                    <span className="text-[var(--muted-foreground)] text-sm w-10 text-right tabular-nums">
                      {pct}%
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <p className="text-[var(--muted-foreground)] text-center py-8 text-sm">
            No data available
          </p>
        )}
      </div>
    </div>
  );
}
