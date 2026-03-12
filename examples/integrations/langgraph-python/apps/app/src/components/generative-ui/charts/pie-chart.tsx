import {
  PieChart as RechartsPieChart,
  Pie,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { z } from "zod";
import { CHART_COLORS, CHART_CONFIG } from "./config";

export const PieChartProps = z.object({
  title: z.string().describe("Chart title"),
  description: z.string().describe("Brief description or subtitle"),
  data: z.array(
    z.object({
      label: z.string(),
      value: z.number(),
    }),
  ),
});

type PieChartProps = z.infer<typeof PieChartProps>;

export function PieChart({ title, description, data }: PieChartProps) {
  if (!data || !Array.isArray(data) || data.length === 0) {
    return (
      <div className="rounded-xl border dark:border-zinc-700 shadow-sm p-6 max-w-lg mx-auto my-6 bg-[var(--background)]">
        <div className="mb-4">
          <h3 className="text-xl font-bold dark:text-white">{title}</h3>
          <p className="text-sm text-gray-600 dark:text-zinc-400">
            {description}
          </p>
        </div>
        <p className="text-gray-500 dark:text-zinc-400 text-center py-8">
          No data available
        </p>
      </div>
    );
  }

  // Add colors to data
  const coloredData = data.map((entry, index) => ({
    ...entry,
    fill: CHART_COLORS[index % CHART_COLORS.length],
  }));

  return (
    <div className="rounded-xl border dark:border-zinc-700 shadow-sm p-6 max-w-lg mx-auto my-6 bg-[var(--background)]">
      <div className="mb-4">
        <h3 className="text-xl font-bold dark:text-white">{title}</h3>
        <p className="text-sm text-gray-600 dark:text-zinc-400">
          {description}
        </p>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <RechartsPieChart>
          <Pie
            data={coloredData}
            dataKey="value"
            nameKey="label"
            cx="50%"
            cy="50%"
            outerRadius={100}
            isAnimationActive={false}
          />
          <Tooltip contentStyle={CHART_CONFIG.tooltipStyle} />
        </RechartsPieChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        {data.map((item, index) => (
          <div key={index} className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-sm"
              style={{
                backgroundColor: CHART_COLORS[index % CHART_COLORS.length],
              }}
            />
            <span className="text-sm dark:text-zinc-300">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
