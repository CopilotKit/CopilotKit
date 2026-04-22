"use client";

import React from "react";
// v1 CopilotKit provider enables the v1 `useCoAgentStateRender` hook.
// Under the hood it also wraps the v2 provider, so v2 components such as
// `<CopilotChat />` and `useConfigureSuggestions` still work inside it.
import { CopilotKit, useCoAgentStateRender } from "@copilotkit/react-core";
import {
  CopilotChat,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { InlineAgentStateCard, type Step } from "./InlineAgentStateCard";

/**
 * Agentic Generative UI — v1 In-Chat State Rendering
 *
 * A minimal deep agent defines its OWN state schema (`steps: list[Step]`) on
 * the backend and exposes a custom `set_steps` tool that the model calls to
 * mutate that state. Every `set_steps` call streams the updated `steps` to
 * the client. The v1 `useCoAgentStateRender` hook subscribes to that state
 * and renders an inline progress tracker inside the chat transcript — no
 * `messageView` plumbing, no manual `useAgent` subscription.
 *
 * Reference: https://docs.copilotkit.ai/reference/v1/hooks/useCoAgentStateRender
 */
export default function GenUiAgentDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="gen-ui-agent">
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

// State shape mirrors the deep agent's explicit `steps` field, declared in
// `GenUiAgentState` on the backend and mutated by the custom `set_steps` tool.
type AgentState = {
  steps?: Step[];
};

function Chat() {
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Plan a product launch",
        message: "Plan a product launch for a new mobile app.",
      },
      {
        title: "Organize a team offsite",
        message: "Organize a three-day engineering team offsite.",
      },
      {
        title: "Research a competitor",
        message:
          "Research our top competitor and summarize their strengths and weaknesses.",
      },
    ],
    available: "always",
  });

  // @region[use-coagent-state-render]
  // Subscribe to the deep agent's `steps` state. The custom `set_steps` tool
  // updates it every time the model advances a step, streaming each
  // transition to the UI where this `render` callback re-runs with the
  // fresh state and an updated `status` ("inProgress" while the agent is
  // running, "complete" when done).
  useCoAgentStateRender<AgentState>({
    name: "gen-ui-agent",
    render: ({ state, status }) => {
      const steps = state?.steps ?? [];
      if (steps.length === 0) return null;
      return <InlineAgentStateCard steps={steps} status={status} />;
    },
  });
  // @endregion[use-coagent-state-render]

  return <CopilotChat agentId="gen-ui-agent" className="h-full rounded-2xl" />;
}
