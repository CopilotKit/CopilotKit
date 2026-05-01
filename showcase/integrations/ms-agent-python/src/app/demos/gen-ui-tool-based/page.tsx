"use client";

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotChat,
  useComponent,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { BarChart, barChartPropsSchema } from "./bar-chart";
import { PieChart, pieChartPropsSchema } from "./pie-chart";

export default function ControlledGenUiDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="gen-ui-tool-based">
      <Chat />
    </CopilotKit>
  );
}

function Chat() {
  // @region[bar-chart-renderer]
  useComponent({
    name: "render_bar_chart",
    description: "Display a bar chart with labeled numeric values.",
    parameters: barChartPropsSchema,
    render: BarChart,
  });
  // @endregion[bar-chart-renderer]

  // @region[pie-chart-renderer]
  useComponent({
    name: "render_pie_chart",
    description: "Display a pie chart with labeled numeric values.",
    parameters: pieChartPropsSchema,
    render: PieChart,
  });
  // @endregion[pie-chart-renderer]

  // @region[canonical-e2e-suggestion]
  // Canonical e2e suggestion — single pill keyed to the aimock fixture in
  // showcase/aimock/d5-all.json (see showcase/aimock/_canonical-catalog.json).
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Quarterly bars",
        message: "render a tool-based bar chart for last quarter deliveries",
      },
    ],
    available: "always",
  });
  // @endregion[canonical-e2e-suggestion]

  return (
    <div className="flex justify-center items-center h-screen w-full">
      <div className="h-full w-full max-w-4xl">
        <CopilotChat
          agentId="gen-ui-tool-based"
          className="h-full rounded-2xl"
        />
      </div>
    </div>
  );
}
