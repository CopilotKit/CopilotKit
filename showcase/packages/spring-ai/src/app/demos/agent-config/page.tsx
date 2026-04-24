"use client";

/**
 * Agent Config Object demo (Spring AI port).
 *
 * Forwards a typed config object (tone / expertise / responseLength) from the
 * frontend to the Spring backend via `CopilotKit properties`. The Spring
 * controller at `/agent-config/run` reads those three fields off the AG-UI
 * envelope's `forwardedProps`, builds a per-request SpringAIAgent with a
 * system prompt composed from them, and runs the agent.
 */

import { CopilotChat, CopilotKit } from "@copilotkit/react-core/v2";
import { useMemo } from "react";

import { ConfigCard } from "./config-card";
import { useAgentConfig } from "./use-agent-config";

export default function AgentConfigDemoPage() {
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
    <CopilotKit
      runtimeUrl="/api/copilotkit-agent-config"
      agent="agent-config-demo"
      properties={providerProperties}
    >
      <div className="flex h-screen flex-col gap-3 p-6">
        <header>
          <h1 className="text-lg font-semibold">Agent Config Object</h1>
          <p className="text-sm text-black/60 dark:text-white/60">
            Forwarded props let the frontend tell the agent how to behave.
            Tone, expertise, and response length are forwarded to Spring, which
            builds a system prompt per turn.
          </p>
        </header>
        <ConfigCard
          config={config}
          onToneChange={setTone}
          onExpertiseChange={setExpertise}
          onResponseLengthChange={setResponseLength}
        />
        <div className="flex-1 overflow-hidden rounded-md border border-black/10 dark:border-white/10">
          <CopilotChat
            agentId="agent-config-demo"
            className="h-full rounded-md"
          />
        </div>
      </div>
    </CopilotKit>
  );
}
