"use client";

/**
 * Agent Config Object — typed config knobs (tone / expertise / responseLength)
 * forwarded from the provider into the agent so its behavior changes per turn.
 *
 * Wiring: the toggles live in `useAgentConfig`. Each render the resolved
 * config is published to the agent via `useAgentContext` — the v2 idiom
 * for "frontend → agent runtime context" in LangGraph 0.6+. The Python
 * graph picks it up through `CopilotKitMiddleware`, which routes the
 * context entry into the model's prompt before each call.
 *
 * (LangGraph 0.6 deprecated `configurable` in favor of `context`; the
 * `properties` prop on `<CopilotKit>` still works for v1-style relays
 * but goes through `forwardedProps` and does not land in `RunnableConfig`
 * in @ag-ui/langgraph 0.0.31. `useAgentContext` is the supported path.)
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
