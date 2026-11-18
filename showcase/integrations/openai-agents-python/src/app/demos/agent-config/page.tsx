"use client";

/**
 * Agent Config Object — typed config knobs (tone / expertise / responseLength)
 * forwarded from the provider into the agent so its behavior changes per turn.
 *
 * Wiring: the toggles live in `useAgentConfig`. Each render the resolved
 * config is published to the agent via `useAgentContext` — the v2 idiom
 * for "frontend → agent runtime context". It reaches the agent as
 * `RunAgentInput.context`; the adapter appends it to the agent's
 * instructions before every model call, after the static rulebook.
 */

import { CopilotKitProvider } from "@copilotkit/react-core";

import { DemoLayout } from "./demo-layout";
import { ConfigContextRelay } from "./config-context-relay";
import { useAgentConfig } from "./use-agent-config";

export default function AgentConfigDemoPage() {
  const { config, setTone, setExpertise, setResponseLength } = useAgentConfig();

  return (
    // @region[provider-setup]
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit-agent-config"
      agentId="agent-config-demo"
    >
      <ConfigContextRelay config={config} />
      <DemoLayout
        config={config}
        onToneChange={setTone}
        onExpertiseChange={setExpertise}
        onResponseLengthChange={setResponseLength}
      />
    </CopilotKitProvider>
    // @endregion[provider-setup]
  );
}
