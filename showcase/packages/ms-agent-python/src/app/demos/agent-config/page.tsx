"use client";

import { CopilotChat, CopilotKit } from "@copilotkit/react-core/v2";
import { useMemo } from "react";

import { ConfigCard } from "./config-card";
import { useAgentConfig } from "./use-agent-config";

export default function AgentConfigDemoPage() {
  const { config, setTone, setExpertise, setResponseLength } = useAgentConfig();

  // Widen to `Record<string, unknown>` so the provider's `properties` prop
  // accepts our strongly-typed config. The memo keeps the reference stable
  // between renders when the config itself hasn't changed, so the provider's
  // `[properties]`-keyed effect only re-fires when something real changed.
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
      runtimeUrl="/api/copilotkit-agent-config"
      agent="agent-config-demo"
      properties={providerProperties}
    >
      <div className="flex h-screen flex-col gap-3 p-6">
        <header>
          <h1 className="text-lg font-semibold">Agent Config Object</h1>
          <p className="text-sm text-neutral-600">
            Forwarded props let the frontend tell the agent how to behave. This
            demo passes <code>tone</code>, <code>expertise</code>, and
            <code> responseLength</code> through the provider; the MS Agent
            Framework agent reads them from the AG-UI run&apos;s
            <code> forwardedProps</code> and builds its system prompt per turn.
          </p>
        </header>
        <ConfigCard
          config={config}
          onToneChange={setTone}
          onExpertiseChange={setExpertise}
          onResponseLengthChange={setResponseLength}
        />
        <div className="flex-1 overflow-hidden rounded-md border border-neutral-200">
          <CopilotChat
            agentId="agent-config-demo"
            className="h-full rounded-md"
          />
        </div>
      </div>
    </CopilotKit>
  );
}
