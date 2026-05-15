"use client";

import { useEffect } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat, useAgent } from "@copilotkit/react-core/v2";

import { ConfigCard } from "./config-card";
import { useAgentConfig } from "./use-agent-config";

const AGENT_ID = "agent-config-demo";

export default function AgentConfigDemoPage() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit-agent-config" agent={AGENT_ID}>
      <AgentConfigInner />
    </CopilotKit>
  );
}

function AgentConfigInner() {
  const { config, setTone, setExpertise, setResponseLength } = useAgentConfig();
  const { agent } = useAgent({ agentId: AGENT_ID });

  // Push the typed config into shared state so the .NET agent can read it on
  // every run (as `ag_ui_state`) and rebuild its system prompt accordingly.
  // The effect re-fires on any config field change; `agent.setState` is stable
  // within a given agent instance.
  useEffect(() => {
    agent.setState({
      tone: config.tone,
      expertise: config.expertise,
      responseLength: config.responseLength,
    });
  }, [agent, config.tone, config.expertise, config.responseLength]);

  return (
    <div className="flex h-screen flex-col gap-3 p-6">
      <header>
        <h1 className="text-lg font-semibold">Agent Config Object</h1>
        <p className="text-sm text-neutral-600">
          Typed config flows from the frontend to the agent via shared state.
          This demo pushes <code>tone</code>, <code>expertise</code>, and
          <code> responseLength</code> through <code>useAgent().setState</code>;
          the .NET agent reads them per turn and adapts its system prompt.
        </p>
      </header>
      <ConfigCard
        config={config}
        onToneChange={setTone}
        onExpertiseChange={setExpertise}
        onResponseLengthChange={setResponseLength}
      />
      <div className="flex-1 overflow-hidden rounded-md border border-neutral-200">
        <CopilotChat agentId={AGENT_ID} className="h-full rounded-md" />
      </div>
    </div>
  );
}
