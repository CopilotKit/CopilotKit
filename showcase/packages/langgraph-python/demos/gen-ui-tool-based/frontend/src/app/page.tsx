"use client";

import React from "react";
import {
  CopilotKit,
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
  useComponent({
    name: "render_bar_chart",
    description: "Display a bar chart with labeled numeric values.",
    parameters: barChartPropsSchema,
    render: BarChart,
  });

  useComponent({
    name: "render_pie_chart",
    description: "Display a pie chart with labeled numeric values.",
    parameters: pieChartPropsSchema,
    render: PieChart,
  });

  useConfigureSuggestions({
    suggestions: [
      {
        title: "Sales bar chart",
        message: "Show me a bar chart of quarterly sales for Q1, Q2, Q3, Q4.",
      },
      {
        title: "Traffic pie chart",
        message: "Show me a pie chart of website traffic by source.",
      },
      {
        title: "Market share",
        message: "Show a pie chart of smartphone market share by brand.",
      },
    ],
    available: "always",
  });

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
