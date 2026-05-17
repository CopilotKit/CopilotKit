"use client";

/**
 * Homepage: Controlled Gen UI — bare-minimum useComponent registration.
 *
 * Reuses the `gen-ui-tool-based` LangGraph backend and the canonical
 * PieChart renderer from the existing /demos/gen-ui-tool-based demo. No
 * bar-chart, no suggestions, no layout wrapper — just the minimum needed
 * to demonstrate Controlled Generative UI: register one typed component,
 * point the agent at it, let the agent decide when to render it.
 *
 * Iframe target for the "Controlled Gen UI" chip on the website
 * homepage dojo.
 */

import {
  CopilotKit,
  CopilotChat,
  useComponent,
} from "@copilotkit/react-core/v2";

import { PieChart, pieChartPropsSchema } from "../gen-ui-tool-based/pie-chart";

function Chat() {
  useComponent({
    name: "render_pie_chart",
    description: "Display a pie chart with labeled numeric values.",
    parameters: pieChartPropsSchema,
    render: PieChart,
  });

  return <CopilotChat agentId="gen-ui-tool-based" />;
}

export default function HomeControlledGenUiDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="gen-ui-tool-based">
      <Chat />
    </CopilotKit>
  );
}
