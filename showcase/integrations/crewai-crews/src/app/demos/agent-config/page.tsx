"use client";

import {
  CopilotChat,
  CopilotKit,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { useMemo } from "react";

import { ConfigCard } from "./config-card";
import { useAgentConfig } from "./use-agent-config";

function CanonicalSuggestion() {
  // @canonical: pill exercises catalog message — see showcase/aimock/_canonical-catalog.json
  // Single-click prompt matches the aimock fixture in
  // showcase/aimock/d5-all.json so the local stack renders deterministically.
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Personalize tone",
        message: "introduce yourself per your config",
      },
    ],
    available: "always",
  });
  return null;
}

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
      <CanonicalSuggestion />
      <div className="flex h-screen flex-col gap-3 p-6">
        <header>
          <h1 className="text-lg font-semibold">Agent Config Object</h1>
          <p className="text-sm text-gray-500">
            Forwarded provider properties (<code>tone</code>,{" "}
            <code>expertise</code>, <code>responseLength</code>) are threaded
            into the CrewAI agent server via a FastAPI middleware that splices
            them into <code>state.inputs</code>, which the crew chat flow
            appends to the system prompt on every turn.
          </p>
        </header>
        <ConfigCard
          config={config}
          onToneChange={setTone}
          onExpertiseChange={setExpertise}
          onResponseLengthChange={setResponseLength}
        />
        <div className="flex-1 overflow-hidden rounded-md border border-gray-200">
          <CopilotChat
            agentId="agent-config-demo"
            className="h-full rounded-md"
          />
        </div>
      </div>
    </CopilotKit>
  );
}
