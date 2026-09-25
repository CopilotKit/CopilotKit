import { z } from "zod";
import {
  DynamicStringSchema,
  createAngularCatalog,
} from "@copilotkit/angular/a2ui";
import type { A2UICatalogDefinitions } from "@copilotkit/angular/a2ui";
import {
  BarChartComponent,
  DashboardCardComponent,
  InfoRowComponent,
  MetricComponent,
  StatusBadgeComponent,
} from "./dashboard-components";

/**
 * What the agent may render, beyond the basic catalog. The descriptions and
 * zod schemas are advertised to the agent; `Dynamic*` props accept data
 * bindings such as `{ path: "/revenue" }`.
 */
export const dashboardDefinitions = {
  Card: {
    description:
      "A titled card with an optional subtitle and a single child. Replaces the basic Card.",
    props: z.object({
      title: z.string(),
      subtitle: z.string().optional(),
      child: z.string().optional(),
    }),
  },
  Metric: {
    description:
      "A KPI tile with an optional trend, e.g. 'Revenue • $4.2M • up 12%'.",
    props: z.object({
      label: z.string(),
      value: DynamicStringSchema,
      trend: z.enum(["up", "down", "neutral"]).optional(),
      trendValue: DynamicStringSchema.optional(),
    }),
  },
  StatusBadge: {
    description: "A coloured pill for the state of something.",
    props: z.object({
      text: z.string(),
      variant: z.enum(["success", "warning", "error", "info"]).optional(),
    }),
  },
  InfoRow: {
    description: "A compact 'label: value' row for facts inside a Card.",
    props: z.object({ label: z.string(), value: z.string() }),
  },
  BarChart: {
    description: "A horizontal bar chart of { label, value } pairs.",
    props: z.object({
      title: z.string(),
      data: z.array(z.object({ label: z.string(), value: z.number() })),
    }),
  },
} satisfies A2UICatalogDefinitions;

/** The basic catalog plus the dashboard components above. */
export const dashboardCatalog = createAngularCatalog(
  dashboardDefinitions,
  {
    Card: DashboardCardComponent,
    Metric: MetricComponent,
    StatusBadge: StatusBadgeComponent,
    InfoRow: InfoRowComponent,
    BarChart: BarChartComponent,
  },
  {
    catalogId: "copilotkit://angular-dashboard-catalog",
    includeBasicCatalog: true,
  },
);
