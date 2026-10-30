import { z } from "zod";
import { def } from "./shared";

/** Long-format rows shared by cartesian charts: one row per point. */
export const seriesRows = z.array(z.object({ x: z.union([z.string(), z.number()]), y: z.number(), series: z.string().optional() }));
const fmt = z.enum(["number", "currency", "percent", "compact"]);
const base = { title: z.string().optional(), subtitle: z.string().optional(), height: z.number().optional(), format: fmt.optional(), unit: z.string().optional() };
/** Line, Area and Bar: one series name to draw in the accent while the others go grey. */
const highlight = z.string().optional();

export const chartDefinitions = {
  LineChart: def("Charts", "Trend over ordered x. data [{x,y,series?}]; one line per series.", z.object({ ...base, data: seriesRows, curve: z.boolean().optional(), highlight })),
  AreaChart: def("Charts", "Filled trend for volumes or cumulative totals (traffic, signups); series stack. data [{x,y,series?}].", z.object({ ...base, data: seriesRows, stacked: z.boolean().optional(), highlight })),
  BarChart: def("Charts", "Compare categories. data [{x,y,series?}]; series grouped side by side, or stacked:true. horizontal for long labels.", z.object({ ...base, data: seriesRows, stacked: z.boolean().optional(), horizontal: z.boolean().optional(), highlight })),
  PieChart: def("Charts", "Part-to-whole. data [{label,value}]; donut:true for a ring with center total.", z.object({ ...base, data: z.array(z.object({ label: z.string(), value: z.number() })), donut: z.boolean().optional(), centerLabel: z.string().optional() })),
  ScatterChart: def("Charts", "Relationship between two numbers (price vs rating, effort vs impact). data [{x,y,label?,size?,series?}].", z.object({ ...base, data: z.array(z.object({ x: z.number(), y: z.number(), label: z.string().optional(), size: z.number().optional(), series: z.string().optional() })), xLabel: z.string().optional(), yLabel: z.string().optional() })),
  Heatmap: def("Charts", "Matrix of values, e.g. day x hour. data [{x,y,value}] with x,y categories.", z.object({ ...base, data: z.array(z.object({ x: z.string(), y: z.string(), value: z.number() })) })),
  Sparkline: def("Charts", "Tiny trend with label and latest value; a compact KPI with history, fits in a Grid instead of Stat. values: numbers.", z.object({ label: z.string().optional(), values: z.array(z.number()), value: z.string().optional(), delta: z.string().optional(), tone: z.enum(["positive", "negative", "default"]).optional() })),
  RadarChart: def("Charts", "Multi-axis profile (scores per criterion for 2-3 options or people). data [{axis,value,series?}], values on a shared scale.", z.object({ ...base, data: z.array(z.object({ axis: z.string(), value: z.number(), series: z.string().optional() })), max: z.number().optional() })),
  CandlestickChart: def("Charts", "OHLC price candles. data [{date,open,high,low,close}].", z.object({ ...base, data: z.array(z.object({ date: z.string(), open: z.number(), high: z.number(), low: z.number(), close: z.number() })) })),
  Treemap: def("Charts", "Nested part-to-whole as rectangles. data [{name,value,group?}].", z.object({ ...base, data: z.array(z.object({ name: z.string(), value: z.number(), group: z.string().optional() })) })),
  SankeyChart: def("Charts", "Flows between stages, e.g. budget or funnel paths. links [{source,target,value}].", z.object({ ...base, links: z.array(z.object({ source: z.string(), target: z.string(), value: z.number() })) })),
  Gauge: def("Charts", "Half-ring gauge for a single value within min..max (score, utilization).", z.object({ title: z.string().optional(), value: z.number(), min: z.number().optional(), max: z.number().optional(), label: z.string().optional(), format: fmt.optional() })),
};
