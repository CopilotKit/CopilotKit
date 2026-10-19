import type { A2UICatalogDefinitions } from "@copilotkit/angular/a2ui";
import { ChildListSchema } from "@copilotkit/angular/a2ui";
import { z } from "zod";

const dynamicString = z.union([z.string(), z.object({ path: z.string() })]);
const chartDatum = z.object({ label: z.string(), value: z.number() });
const align = z.enum(["start", "center", "end", "stretch", "baseline"]);
const cardProps = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  child: z.string().optional(),
});
const metricProps = z.object({
  label: z.string(),
  value: z.string(),
  trend: z.enum(["up", "down", "neutral"]).optional(),
  trendValue: z.string().optional(),
});
const tableColumns = z.array(z.object({ key: z.string(), label: z.string() }));
const titledChartProps = z.object({
  title: z.string(),
  description: z.string(),
  data: z.array(chartDatum),
});

export const declarativeDefinitions = {
  Row: {
    props: z.object({
      gap: z.number().optional(),
      align: align.optional(),
      justify: z.enum(["start", "center", "end", "spaceBetween"]).optional(),
      children: z.array(z.string()),
    }),
  },
  Column: {
    props: z.object({
      gap: z.number().optional(),
      align: align.optional(),
      children: z.array(z.string()),
    }),
  },
  Text: { props: z.object({ text: z.string() }) },
  Card: { props: cardProps },
  StatusBadge: {
    props: z.object({
      text: z.string(),
      variant: z.enum(["success", "warning", "error", "info"]).optional(),
    }),
  },
  Metric: { props: metricProps },
  InfoRow: { props: z.object({ label: z.string(), value: z.string() }) },
  DataTable: {
    props: z.object({
      columns: tableColumns,
      rows: z.array(z.record(z.union([z.string(), z.number()]))),
    }),
  },
  PrimaryButton: {
    props: z.object({ label: z.string(), action: z.unknown().optional() }),
  },
  PieChart: { props: titledChartProps },
  BarChart: { props: titledChartProps },
} satisfies A2UICatalogDefinitions;

// @region[a2ui-fixed-schema]
export const fixedDefinitions = {
  Card: { props: z.object({ child: z.string() }) },
  Title: { props: z.object({ text: dynamicString }) },
  Airport: { props: z.object({ code: dynamicString }) },
  Arrow: { props: z.object({}) },
  AirlineBadge: { props: z.object({ name: dynamicString }) },
  PriceTag: { props: z.object({ amount: dynamicString }) },
  Button: {
    props: z.object({
      child: z.string(),
      variant: z.enum(["primary", "secondary", "ghost"]).optional(),
      action: z.unknown().optional(),
    }),
  },
} satisfies A2UICatalogDefinitions;
// @endregion[a2ui-fixed-schema]

export const beautifulDefinitions = {
  Title: {
    props: z.object({ text: z.string(), level: z.string().optional() }),
  },
  Row: {
    props: z.object({
      gap: z.number().optional(),
      align: z.string().optional(),
      justify: z.string().optional(),
      children: ChildListSchema,
    }),
  },
  Column: {
    props: z.object({
      gap: z.number().optional(),
      align: z.string().optional(),
      children: ChildListSchema,
    }),
  },
  DashboardCard: { props: cardProps },
  Metric: { props: metricProps },
  PieChart: {
    props: z.object({
      data: z.array(chartDatum.extend({ color: z.string().optional() })),
      innerRadius: z.number().optional(),
    }),
  },
  BarChart: {
    props: z.object({
      data: z.array(chartDatum),
      color: z.string().optional(),
    }),
  },
  Badge: {
    props: z.object({
      text: z.string(),
      variant: z
        .enum(["success", "warning", "error", "info", "neutral"])
        .optional(),
    }),
  },
  DataTable: {
    props: z.object({
      columns: tableColumns,
      rows: z.array(z.record(z.string(), z.unknown())),
    }),
  },
  Button: fixedDefinitions.Button,
  FlightCard: {
    props: z.object({
      airline: dynamicString,
      airlineLogo: dynamicString,
      flightNumber: dynamicString,
      origin: dynamicString,
      destination: dynamicString,
      date: dynamicString,
      departureTime: dynamicString,
      arrivalTime: dynamicString,
      duration: dynamicString,
      status: dynamicString,
      statusColor: dynamicString.optional(),
      price: dynamicString,
      action: z.unknown().optional(),
    }),
  },
} satisfies A2UICatalogDefinitions;
