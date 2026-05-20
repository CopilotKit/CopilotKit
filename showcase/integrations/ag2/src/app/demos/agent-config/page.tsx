"use client";

// Agent Config Object demo (AG2).
//
// The frontend passes a typed config object (tone / expertise /
// responseLength) through the CopilotKit provider's `properties` prop.
// AG2's AGUIStream maps these properties into ContextVariables on every
// run; the agent reads them and rebuilds its system prompt per turn.
//
// References:
// - src/agents/agent_config_agent.py — the AG2 ConversableAgent backing this.

import { CopilotChat, CopilotKit } from "@copilotkit/react-core/v2";
import { useMemo } from "react";

import { ConfigCard } from "./config-card";
import { useAgentConfig } from "./use-agent-config";

const RUNTIME_URL = "/api/copilotkit";
const AGENT_ID = "agent-config-demo";

export default function AgentConfigDemoPage() {
  const { config, setTone, setExpertise, setResponseLength } = useAgentConfig();

  // Widen to `Record<string, unknown>` so the provider's `properties` prop
  // accepts our strongly-typed config. The memo keeps the reference stable
  // between renders when the config itself hasn't changed.
  const providerProperties = useMemo<Record<string, unknown>>(
    () => ({
      tone: config.tone,
      expertise: config.expertise,
      responseLength: config.responseLength,
    }),
    [config.tone, config.expertise, config.responseLength],
  );

  return (
    <CopilotKit
      runtimeUrl={RUNTIME_URL}
      agent={AGENT_ID}
      properties={providerProperties}
    >
      <div className="flex h-screen flex-col gap-3 p-6">
        <header>
          <h1 className="text-lg font-semibold">Agent Config Object</h1>
          <p className="text-sm text-neutral-600">
            Forwarded props let the frontend tell the agent how to behave. This
            demo passes <code>tone</code>, <code>expertise</code>, and{" "}
            <code>responseLength</code> through the provider; the AG2 agent
            reads them from ContextVariables and rebuilds its system prompt per
            turn.
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
    </CopilotKit>
  );
}
