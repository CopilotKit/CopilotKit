"use client";

import { use, useMemo } from "react";
import { CopilotChat, CopilotKit } from "@copilotkit/react-core/v2";

import { ConfigCard } from "./config-card";
import { useAgentConfig } from "./use-agent-config";

const DEMO_ID = "agent-config";

export default function AgentConfigDemoPage({
  params,
}: {
  params: Promise<{ framework: string }>;
}) {
  const { framework } = use(params);
  const { config, setTone, setExpertise, setResponseLength } = useAgentConfig();

  const providerProperties = useMemo<Record<string, unknown>>(
    () => ({
      tone: config.tone,
      expertise: config.expertise,
      responseLength: config.responseLength,
    }),
    [config.tone, config.expertise, config.responseLength],
  );

  return (
    // @region[provider-setup]
    <CopilotKit
      runtimeUrl={`/api/${framework}/${DEMO_ID}`}
      agent={DEMO_ID}
      properties={providerProperties}
    >
      <div className="flex h-screen flex-col gap-3 p-6">
        <header>
          <h1 className="text-lg font-semibold">Agent Config Object</h1>
          <p className="text-sm text-[var(--text-muted)]">
            Forwarded props let the frontend tell the agent how to behave. This
            demo passes <code>tone</code>, <code>expertise</code>, and
            <code> responseLength</code> through the provider; the agent reads
            them from the run config and builds its system prompt per turn.
          </p>
        </header>
        <ConfigCard
          config={config}
          onToneChange={setTone}
          onExpertiseChange={setExpertise}
          onResponseLengthChange={setResponseLength}
        />
        <div className="flex-1 overflow-hidden rounded-md border border-[var(--border)]">
          <CopilotChat
            agentId={DEMO_ID}
            className="h-full rounded-md"
          />
        </div>
      </div>
    </CopilotKit>
    // @endregion[provider-setup]
  );
}
