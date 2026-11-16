"use client";

/**
 * Agent Config Object: typed config knobs (tone, expertise, response length)
 * that reach the agent, so its replies change from one turn to the next.
 *
 * The knobs live in `useAgentConfig`. On every render, `ConfigContextRelay`
 * publishes the config to the agent with `useAgentContext`, and the agent
 * adds it to the model's prompt. An agent that reads the config from the
 * run's `forwardedProps` also gets it as the provider's `properties`.
 */

import { CopilotKit } from "@copilotkit/react-core/v2";
import { useDemoRuntimeUrl } from "@/lib/demo-runtime";
import { ConfigContextRelay } from "./config-context-relay";
import { DemoLayout } from "./demo-layout";
import type { AgentConfigDemoSettings } from "./demo-settings";
import { useAgentConfig } from "./use-agent-config";

export function AgentConfigDemo({
  settings,
}: {
  settings: AgentConfigDemoSettings;
}) {
  const { config, setTone, setExpertise, setResponseLength } = useAgentConfig();
  const runtimeUrl = useDemoRuntimeUrl("agent-config");

  return (
    // @region[provider-setup]
    <CopilotKit
      runtimeUrl={runtimeUrl}
      agent="agent-config-demo"
      properties={settings.readsForwardedProps ? config : undefined}
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
