// Docs-only snippet — not imported or rendered. The dashboard demo at
// `page.tsx` for this framework runs a haiku-generator showcase via
// `useFrontendTool`, but the canonical `/generative-ui/tool-based` page
// teaches the simpler `useComponent` bar-chart pattern. This file shows
// what the bar-chart renderer would look like in the same framework's
// shape, so the docs render real teaching code rather than a missing-
// snippet box.
//
// Mirrors the convention from `tool-rendering/render-flight-tool.snippet.tsx`.

import { useComponent } from "@copilotkit/react-core/v2";
import { z } from "zod";

// Stand-ins for the locally-authored bar chart component + its prop
// schema. In a real page, these live in the demo directory (e.g.
// `./bar-chart.tsx` exporting `BarChart` and `barChartPropsSchema`).
declare const BarChart: React.ComponentType<{
  title: string;
  data: { label: string; value: number }[];
}>;
declare const barChartPropsSchema: z.ZodSchema;

export function BarChartRenderer() {
  // @region[bar-chart-renderer]
  useComponent({
    name: "render_bar_chart",
    description: "Display a bar chart with labeled numeric values.",
    parameters: barChartPropsSchema,
    render: BarChart,
  });
  // @endregion[bar-chart-renderer]
}
