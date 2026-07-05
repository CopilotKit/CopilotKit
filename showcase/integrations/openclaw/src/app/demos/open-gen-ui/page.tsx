"use client";

// Open-Ended Generative UI demo (OpenClaw).
//
// OpenClaw's agent has no arbitrary backend tools, so the frontend must OWN the
// generative-UI tool. The tool `render_insight` is DEFINED in the React tree
// via `useFrontendTool` and its schema is FORWARDED over AG-UI in
// RunAgentInput.tools; the clawg-ui adapter hands it to OpenClaw as a
// caller-provided client tool. When the agent decides to call `render_insight`,
// CopilotChat drives the tool's `render` function through its
// inProgress -> executing -> complete lifecycle, and the render function paints
// an open-ended "insight" visualisation from the tool arguments — no plain-text
// reply needed.
//
// This is the OpenClaw analogue of the langgraph-python `open-gen-ui` demo: the
// agent turns a free-form request into a rich, self-contained visual. Because
// OpenClaw cannot host a backend tool, we use `useFrontendTool` (which forwards
// the tool) WITH a `render` function and NO `handler` — NOT `useRenderTool`
// (which would only render a tool the agent already has, and never fire here).
//
// Reference: https://docs.copilotkit.ai/generative-ui

// @region[frontend-tool-render]
import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useFrontendTool,
} from "@copilotkit/react-core/v2";
import { InsightCard, insightPropsSchema } from "./insight-card";
import { useOpenGenUiSuggestions } from "./suggestions";

function Chat() {
  useFrontendTool({
    name: "render_insight",
    description:
      "Render a rich 'insight' visualisation for any topic the user asks " +
      "about: a titled card with a one-line summary and a grid of labelled " +
      "numeric metrics drawn as comparison bars. Use this to VISUALISE data " +
      "instead of replying with plain text.",
    parameters: insightPropsSchema,
    // No handler: this frontend tool only paints UI. The render function is
    // invoked with the tool-call args and its live status.
    render: ({ args, status }) => (
      <InsightCard
        title={args.title}
        summary={args.summary}
        accent={args.accent}
        metrics={args.metrics}
        status={status}
      />
    ),
  });
  // @endregion[frontend-tool-render]

  useOpenGenUiSuggestions();

  return (
    <div className="flex h-screen w-full items-center justify-center">
      <div className="h-full w-full max-w-4xl">
        <CopilotChat agentId="open-gen-ui" className="h-full rounded-2xl" />
      </div>
    </div>
  );
}

export default function OpenGenUiDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="open-gen-ui">
      <Chat />
    </CopilotKit>
  );
}
