import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { z } from "zod";
import { CHART_COLORS, CHART_CONFIG } from "./config";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";

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
      <Card className="max-w-2xl mx-auto my-6">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-[var(--muted-foreground)] text-center py-8">
            No data available
          </p>
        </CardContent>
      </Card>
    );
  }

  const coloredData = data.map((entry, index) => ({
    ...entry,
    fill: CHART_COLORS[index % CHART_COLORS.length],
  }));

  return (
    <Card className="max-w-2xl mx-auto my-6">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <RechartsBarChart
            data={coloredData}
            margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
          >
            <XAxis
              dataKey="label"
              tick={{ fontSize: 12 }}
              stroke="var(--chart-axis)"
            />
            <YAxis tick={{ fontSize: 12 }} stroke="var(--chart-axis)" />
            <Tooltip contentStyle={CHART_CONFIG.tooltipStyle} />
            <Bar
              isAnimationActive={false}
              dataKey="value"
              radius={[4, 4, 0, 0]}
            />
          </RechartsBarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
