"use client";

import { CopilotKitProvider, CopilotChat } from "@copilotkit/react-core/v2";
import { useMemo } from "react";

import { ConfigCard } from "./config-card";
import { useAgentConfig } from "./use-agent-config";

export default function AgentConfigDemoPage() {
  const { config, setTone, setExpertise, setResponseLength } = useAgentConfig();

  // Stable reference between renders when nothing has changed so the
  // provider's `[properties]`-keyed effect only re-fires on real updates.
  const providerProperties = useMemo<Record<string, unknown>>(
    () => ({
      tone: config.tone,
      expertise: config.expertise,
      responseLength: config.responseLength,
    }),
    [config.tone, config.expertise, config.responseLength],
  );

  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit-agent-config"
      properties={providerProperties}
      useSingleEndpoint
    >
      <div className="flex h-screen flex-col gap-3 p-6">
        <header>
          <h1 className="text-lg font-semibold">Agent Config Object</h1>
          <p className="text-sm text-neutral-600">
            Forwarded props let the frontend tell the agent how to behave. This
            demo passes <code>tone</code>, <code>expertise</code>, and
            <code> responseLength</code> through the provider; the
            built-in-agent factory reads them from{" "}
            <code>input.forwardedProps</code> and prepends a tuned system prompt
            per turn.
          </p>
        </header>
        <ConfigCard
          config={config}
          onToneChange={setTone}
          onExpertiseChange={setExpertise}
          onResponseLengthChange={setResponseLength}
        />
        <div className="flex-1 overflow-hidden rounded-md border border-neutral-200">
          <CopilotChat className="h-full rounded-md" />
        </div>
      </div>
    </CopilotKitProvider>
  );
}
