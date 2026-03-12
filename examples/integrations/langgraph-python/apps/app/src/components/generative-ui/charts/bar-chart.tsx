import { BarChart as RechartsBarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { z } from 'zod';
import { CHART_COLORS, CHART_CONFIG } from './config';

export const BarChartProps = z.object({
  title: z.string().describe("Chart title"),
  description: z.string().describe("Brief description or subtitle"),
  data: z.array(
    z.object({
      label: z.string(),
      value: z.number(),
    }),
  ),
});

type BarChartProps = z.infer<typeof BarChartProps>;

export function BarChart({ title, description, data }: BarChartProps) {
  if (!data || !Array.isArray(data) || data.length === 0) {
    return (
      <div className="rounded-xl border dark:border-zinc-700 shadow-sm p-6 max-w-2xl mx-auto my-6 bg-[var(--background)]">
        <div className="mb-4">
          <h3 className="text-xl font-bold dark:text-white">{title}</h3>
          <p className="text-sm text-gray-600 dark:text-zinc-400">{description}</p>
        </div>
        <p className="text-gray-500 dark:text-zinc-400 text-center py-8">No data available</p>
      </div>
    );
  }

  // Add colors to data
  const coloredData = data.map((entry, index) => ({
    ...entry,
    fill: CHART_COLORS[index % CHART_COLORS.length]
  }));

  return (
    <div className="rounded-xl border dark:border-zinc-700 shadow-sm p-6 max-w-2xl mx-auto my-6 bg-[var(--background)]">
      <div className="mb-4">
        <h3 className="text-xl font-bold dark:text-white">{title}</h3>
        <p className="text-sm text-gray-600 dark:text-zinc-400">{description}</p>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <RechartsBarChart data={coloredData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <XAxis
            dataKey="label"
            tick={{ fontSize: 12 }}
            stroke="var(--chart-axis)"
          />
          <YAxis
            tick={{ fontSize: 12 }}
            stroke="var(--chart-axis)"
          />
          <Tooltip contentStyle={CHART_CONFIG.tooltipStyle} />
          <Bar isAnimationActive={false} dataKey="value" radius={[4, 4, 0, 0]} />
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>
  );
}
