import { z } from "zod";
import { createGenerativeUI } from "@copilotkit/angular/generative-ui";
import { shopUI } from "../generative-ui/shop-ui";
import {
  BarChartComponent,
  DashboardCardComponent,
  InfoRowComponent,
  MetricComponent,
  StatusBadgeComponent,
} from "./dashboard-components";

/**
 * The UI of the app: the shop UI (the standard catalog plus the shop
 * components) and the dashboard components. The app gives one UI to
 * `provideGenerativeUI`, so this UI extends `shopUI` and both demos use it.
 * Every prop takes a literal or a binding such as `{ "@path": "/revenue" }`.
 */
export const dashboardUI = createGenerativeUI({
  id: "copilotkit/demo-dashboard@1",
  extends: [shopUI],
  components: {
    DashboardCard: {
      component: DashboardCardComponent,
      description: "A titled card with an optional subtitle and one child.",
      props: z.object({
        title: z.string(),
        subtitle: z.string().optional(),
      }),
      slots: { child: "single" },
    },
    Metric: {
      component: MetricComponent,
      description:
        "A KPI tile with an optional trend, e.g. 'Revenue • $4.2M • up 12%'.",
      props: z.object({
        label: z.string(),
        value: z.string(),
        trend: z.enum(["up", "down", "neutral"]).optional(),
        trendValue: z.string().optional(),
      }),
    },
    StatusBadge: {
      component: StatusBadgeComponent,
      description: "A coloured pill for the state of something.",
      props: z.object({
        text: z.string(),
        variant: z.enum(["success", "warning", "error", "info"]).optional(),
      }),
    },
    InfoRow: {
      component: InfoRowComponent,
      description: "A compact 'label: value' row for facts inside a card.",
      props: z.object({ label: z.string(), value: z.string() }),
    },
    BarChart: {
      component: BarChartComponent,
      description: "A horizontal bar chart of { label, value } pairs.",
      props: z.object({
        title: z.string(),
        data: z.array(z.object({ label: z.string(), value: z.number() })),
      }),
    },
  },
});
