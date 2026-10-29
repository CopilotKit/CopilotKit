import { z } from "zod";

// ---- Schema ----

export const chartSeries = z.union([
  z.string(),
  z.object({
    key: z.string(),
    label: z.string().optional(),
    color: z.string().optional().describe("A text color token or a CSS color"),
  }),
]);
export type ChartSeries = z.output<typeof chartSeries>;

export const chartSchema = z.object({
  chartType: z
    .enum(["bar", "line", "area", "scatter", "pie", "donut"])
    .optional()
    .describe('Default "bar"'),
  data: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .describe('A list of objects, or { "@path": "/x" }'),
  xKey: z.string().optional().describe("The field of the category axis"),
  series: z
    .array(chartSeries)
    .optional()
    .describe(
      'The value fields: strings or { "key", "label"?, "color"? }. Default: every number field except xKey',
    ),
  stacked: z.boolean().optional(),
  layout: z
    .enum(["vertical", "horizontal"])
    .optional()
    .describe(
      '"horizontal" draws the bars from left to right. Default "vertical"',
    ),
  yAxis: z
    .object({
      label: z.string().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      width: z.number().optional().describe("Pixels"),
    })
    .optional()
    .describe(
      'The value axis configuration object: {label?: string, min?: number, max?: number, width?: number}. Example: {label: "Revenue (USD)", min: 0, max: 100}. In horizontal charts, label, min and max apply to the horizontal value axis, and width sets the width of the category axis on the left.',
    ),
  showDots: z.boolean().optional().describe("Point markers on a line or area"),
  barRadius: z
    .number()
    .optional()
    .describe("The corner radius of a bar, in pixels"),
  innerRadius: z
    .union([z.number(), z.string()])
    .optional()
    .describe("Pie and donut"),
  outerRadius: z
    .union([z.number(), z.string()])
    .optional()
    .describe("Pie and donut"),
  startAngle: z.number().optional().describe("Pie and donut. Default 90"),
  endAngle: z.number().optional().describe("Pie and donut. Default -270"),
  cornerRadius: z.number().optional().describe("The corners of a slice"),
  paddingAngle: z.number().optional().describe("The gap between slices"),
  showLabelLines: z
    .boolean()
    .optional()
    .describe("Leader lines of the slice labels. Default true"),
  height: z.number().optional().describe("Pixels. Default 240"),
  showLegend: z.boolean().optional().describe("Default true"),
  showGrid: z.boolean().optional().describe("Default true"),
  showTooltip: z.boolean().optional().describe("Default true"),
  showValueLabels: z.boolean().optional(),
  format: z
    .enum(["number", "currency", "percent"])
    .optional()
    .describe(
      'Number formatting. With "percent", data values and axis min/max are fractions: 0.4 displays as 40%. For 0% to 10%, use min: 0 and max: 0.1.',
    ),
  currency: z.string().optional().describe('ISO code. Default "USD"'),
  title: z.string().optional(),
});
export type ChartProps = z.output<typeof chartSchema>;
