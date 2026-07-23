"use client";

/**
 * Agent Config Object — typed config knobs (tone / expertise / responseLength)
 * forwarded from the provider into the agent so its behavior changes per turn.
 *
 * Wiring: the toggles live in `useAgentConfig`. Each render the resolved
 * config is published to the agent via `useAgentContext` — the v2 idiom
 * for "frontend → agent runtime context". The Python agent picks it up
 * through a before-model callback that reads
 * `state["copilotkit"]["context"]` and injects a derived directive block
 * into the model's system instruction before each call.
 */

import { CopilotKit } from "@copilotkit/react-core/v2";

import { DemoLayout } from "./demo-layout";
import { ConfigContextRelay } from "./config-context-relay";
import { useAgentConfig } from "./use-agent-config";

export default function AgentConfigDemoPage() {
  const { config, setTone, setExpertise, setResponseLength } = useAgentConfig();

  return (
    // @region[provider-setup]
    <CopilotKit
      runtimeUrl="/api/copilotkit-agent-config"
      agent="agent-config-demo"
    >
      <ConfigContextRelay config={config} />
      <DemoLayout
        config={config}
        onToneChange={setTone}
        onExpertiseChange={setExpertise}
        onResponseLengthChange={setResponseLength}
      />
    </CopilotKit>
    // @endregion[provider-setup]
  );
}
