import { defineRegistry } from "@json-render/react";
import { catalog } from "./catalog";
import { MetricCard } from "./metric-card";
import type { MetricCardComponentProps } from "./metric-card";
import { BarChart } from "./charts/bar-chart";
import type { BarChartComponentProps } from "./charts/bar-chart";
import { PieChart } from "./charts/pie-chart";
import type { PieChartComponentProps } from "./charts/pie-chart";

export const { registry } = defineRegistry(catalog, {
  components: {
    // The agent may nest components under any renderer root — forward children.
    MetricCard: ({ props, children }) => (
      <div className="flex w-full flex-col items-stretch gap-3">
        <MetricCard {...(props as MetricCardComponentProps)} />
        {children}
      </div>
    ),
    BarChart: ({ props, children }) => (
      <div className="flex w-full flex-col items-stretch gap-3">
        <BarChart {...(props as BarChartComponentProps)} />
        {children}
      </div>
    ),
    PieChart: ({ props, children }) => (
      <div className="flex w-full flex-col items-stretch gap-3">
        <PieChart {...(props as PieChartComponentProps)} />
        {children}
      </div>
    ),
  },
  actions: {},
});
