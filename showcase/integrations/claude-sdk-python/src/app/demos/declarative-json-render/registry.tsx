import { defineRegistry } from "@json-render/react";
import { catalog } from "./catalog";
import { MetricCard, type MetricCardComponentProps } from "./metric-card";
import { BarChart, type BarChartComponentProps } from "./charts/bar-chart";
import { PieChart, type PieChartComponentProps } from "./charts/pie-chart";

export const { registry } = defineRegistry(catalog, {
  components: {
    // The agent may nest charts inside a MetricCard root — forward children.
    MetricCard: ({ props, children }) => (
      <div className="flex w-full flex-col items-stretch gap-3">
        <MetricCard {...(props as MetricCardComponentProps)} />
        {children}
      </div>
    ),
    BarChart: ({ props }) => (
      <BarChart {...(props as BarChartComponentProps)} />
    ),
    PieChart: ({ props }) => (
      <PieChart {...(props as PieChartComponentProps)} />
    ),
  },
});
