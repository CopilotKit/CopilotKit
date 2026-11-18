"use client";

import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

type ChartArgs = {
  title: string;
  type: "area" | "bar" | "line";
  data: { label: string; value: number; value2?: number }[];
  series: { key: string; color: string; label: string }[];
};

type Props = {
  args: ChartArgs | Partial<ChartArgs>;
  status: string;
};

export function InlineChatChart({ args, status }: Props) {
  const { title, type, data, series } = args as ChartArgs;

  if (status === "inProgress" || !data || !series) {
    return (
      <div className="my-2 animate-in fade-in slide-in-from-bottom-2 rounded-xl border border-border bg-card p-4 duration-300 ease-out">
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        <div className="mt-3 h-[180px] animate-pulse rounded bg-muted" />
      </div>
    );
  }

  const chartData = data.map((d) => ({ name: d.label, ...d }));

  const renderChart = () => {
    const commonProps = {
      data: chartData,
      margin: { top: 5, right: 10, left: -10, bottom: 5 },
    };

    switch (type) {
      case "bar":
        return (
          <BarChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            {series.map((s) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                fill={s.color}
                name={s.label}
                radius={[4, 4, 0, 0]}
              />
            ))}
          </BarChart>
        );
      case "line":
        return (
          <LineChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={s.color}
                name={s.label}
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            ))}
          </LineChart>
        );
      default:
        return (
          <AreaChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            {series.map((s) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={s.color}
                fill={s.color}
                fillOpacity={0.15}
                name={s.label}
                strokeWidth={2}
              />
            ))}
          </AreaChart>
        );
    }
  };

  return (
    <div className="my-2 animate-in fade-in slide-in-from-bottom-2 rounded-xl border border-border bg-card p-4 duration-300 ease-out">
      <p className="mb-3 text-sm font-semibold text-foreground">{title}</p>
      <ResponsiveContainer width="100%" height={200}>
        {renderChart()}
      </ResponsiveContainer>
    </div>
  );
}
