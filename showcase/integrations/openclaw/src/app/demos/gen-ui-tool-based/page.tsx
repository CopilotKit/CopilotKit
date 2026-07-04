"use client";

// Tool-Based Generative UI demo (OpenClaw).
//
// Shows generative UI driven by a FRONTEND tool with a `render` function. The
// tool `render_chart` is DEFINED in the React tree via `useFrontendTool` and
// its schema is forwarded over AG-UI in RunAgentInput.tools; the clawg-ui
// adapter hands it to OpenClaw as a caller-provided client tool. When the agent
// decides to call `render_chart`, CopilotChat drives the tool's `render`
// function through its inProgress -> executing -> complete lifecycle, and the
// render function draws the chart from the tool arguments — no plain-text reply
// needed. There is no `handler`: this tool exists purely to paint UI.

// @region[frontend-tool-render]
import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useFrontendTool,
} from "@copilotkit/react-core/v2";
import { ChartCard, chartPropsSchema } from "./chart-card";
import { useSuggestions } from "./suggestions";

function Chat() {
  useFrontendTool({
    name: "render_chart",
    description:
      "Render a chart (bar or pie) with labeled numeric values. Use this to " +
      "visualize any tabular data the user asks about instead of replying " +
      "with plain text.",
    parameters: chartPropsSchema,
    // No handler: this frontend tool only renders UI. The render function is
    // invoked with the tool-call args and its live status.
    render: ({ args, status }) => (
      <ChartCard
        chartType={args.chartType}
        title={args.title}
        description={args.description}
        data={args.data}
        status={status}
      />
    ),
  });
  // @endregion[frontend-tool-render]

  useSuggestions();

  return (
    <div className="flex h-screen w-full items-center justify-center">
      <div className="h-full w-full max-w-4xl">
        <CopilotChat
          agentId="gen-ui-tool-based"
          className="h-full rounded-2xl"
        />
      </div>
    </div>
  );
}

export default function GenUiToolBasedDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="gen-ui-tool-based">
      <Chat />
    </CopilotKit>
  );
}
