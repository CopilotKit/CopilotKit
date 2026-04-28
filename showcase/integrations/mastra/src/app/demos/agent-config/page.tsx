"use client";

// Agent Config Object (Mastra port).
//
// The LangGraph reference uses a dedicated route + agent that reads runtime
// config props and rebuilds its system prompt per turn. Mastra's Memory
// primitive doesn't forward these the same way, so this port sends the
// config as `useAgentContext` entries — the agent still sees the values,
// but they arrive as frontend context, not as LangGraph config. The UI is
// otherwise identical.

import { useMemo } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat, useAgentContext } from "@copilotkit/react-core/v2";

import { ConfigCard } from "./config-card";
import { useAgentConfig } from "./use-agent-config";

export default function AgentConfigDemoPage() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="agent-config">
      <Inner />
    </CopilotKit>
  );
}

function Inner() {
  const { config, setTone, setExpertise, setResponseLength } = useAgentConfig();

  const stableConfig = useMemo(
    () => ({
      tone: config.tone,
      expertise: config.expertise,
      responseLength: config.responseLength,
    }),
    [config.tone, config.expertise, config.responseLength],
  );

  useAgentContext({
    description:
      "Agent configuration: tone, expertise, and response length preferences. " +
      "The agent should adapt its answers to match these.",
    value: stableConfig,
  });

  return (
    <div className="flex h-screen flex-col gap-3 p-6">
      <header>
        <h1 className="text-lg font-semibold">Agent Config Object</h1>
        <p className="text-sm text-[var(--text-muted)]">
          Forwarded config lets the frontend tell the agent how to behave. This
          demo passes <code>tone</code>, <code>expertise</code>, and
          <code> responseLength</code> via <code>useAgentContext</code>; the
          Mastra agent receives them as frontend context and adapts its
          responses.
        </p>
      </header>
      <ConfigCard
        config={config}
        onToneChange={setTone}
        onExpertiseChange={setExpertise}
        onResponseLengthChange={setResponseLength}
      />
      <div className="flex-1 overflow-hidden rounded-md border border-[var(--border)]">
        <CopilotChat agentId="agent-config" className="h-full rounded-md" />
      </div>
    </div>
  );
}
