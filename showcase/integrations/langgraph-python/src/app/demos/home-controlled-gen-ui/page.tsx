"use client";

/**
 * Homepage: Controlled Gen UI — bare-minimum useComponent registration,
 * styled in the experimental "lavender glass" design language.
 *
 * Reuses the `gen-ui-tool-based` LangGraph backend. The PieChart
 * registered here is a co-located experimental-themed variant
 * (`./pie-chart.tsx`) — purple + lavender + mint + pink palette, hard
 * corners, Plus Jakarta Sans, mono number labels — so the chart that
 * shows up in the agent's reply visually matches the website's homepage
 * dojo around the iframe.
 *
 * Iframe target for the "Controlled Gen UI" chip on the homepage dojo.
 */

import {
  CopilotKit,
  CopilotChat,
  useComponent,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

import { PieChart, pieChartPropsSchema } from "./pie-chart";
import "../_experimental-theme/theme.css";

function Chat() {
  useComponent({
    name: "render_pie_chart",
    description: "Display a pie chart with labeled numeric values.",
    parameters: pieChartPropsSchema,
    render: PieChart,
  });

  useConfigureSuggestions({
    suggestions: [
      {
        title: "Q3 revenue by region",
        message:
          "Pie chart of Q3 revenue by region — Americas 42%, EMEA 28%, APAC 22%, LATAM 8%.",
      },
      {
        title: "Traffic by source",
        message:
          "Pie chart of website traffic — Organic 48%, Paid 21%, Direct 18%, Referral 13%.",
      },
      {
        title: "Market share",
        message:
          "Pie chart of market share — Acme 38%, Initech 27%, Hooli 19%, Other 16%.",
      },
    ],
    available: "always",
  });

  return <CopilotChat agentId="gen-ui-tool-based" className="h-full" />;
}

export default function HomeControlledGenUiDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      agent="gen-ui-tool-based"
      enableInspector={false}
    >
      <div className="hd-exp-scope h-screen w-screen overflow-hidden">
        <Chat />
      </div>
    </CopilotKit>
  );
}
