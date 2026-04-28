"use client";

import React, { useEffect, useRef } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotChat,
  useAgent,
  UseAgentUpdate,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

import { ConfigCard, AgentConfigValue, INITIAL_CONFIG } from "./config-card";

interface AgentConfigState {
  config?: AgentConfigValue;
}

export default function AgentConfigDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="agent_config">
      <DemoContent />
    </CopilotKit>
  );
}

function DemoContent() {
  const { agent } = useAgent({
    agentId: "agent_config",
    updates: [UseAgentUpdate.OnStateChanged],
  });

  useConfigureSuggestions({
    suggestions: [
      { title: "Greet me", message: "Greet me — show off your tone." },
      {
        title: "Explain WebSockets",
        message: "Explain WebSockets at the configured expertise level.",
      },
    ],
    available: "always",
  });

  const state = agent.state as AgentConfigState | undefined;
  const config = state?.config ?? INITIAL_CONFIG;

  // Seed `config` exactly once, AFTER `agent.state` has actually been
  // observed at least once. The previous mount-only effect with empty
  // deps could fire before the runtime's first state-hydration tick,
  // overwriting a backend-persisted config with INITIAL_CONFIG. The ref
  // gates the seed to a single emission for the lifetime of the component.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    if (state === undefined) return; // wait for first state event
    seededRef.current = true;
    if (!state?.config) {
      // Spread the observed state so any other keys the runtime added
      // (e.g. \`copilotkit\` for read-only context, future framework
      // additions) survive the seed write — \`agent.setState\` replaces
      // the whole state object rather than merging.
      agent.setState({
        ...state,
        config: INITIAL_CONFIG,
      } as AgentConfigState);
    }
  }, [agent, state]);

  const handleChange = (next: AgentConfigValue) => {
    // Same spread discipline as the seed effect — preserve any keys the
    // runtime owns (copilotkit slot, etc.) when writing config back.
    agent.setState({
      ...state,
      config: next,
    } as AgentConfigState);
  };

  return (
    <div className="flex h-screen w-full bg-gray-50">
      <aside className="md:w-[340px] md:shrink-0 p-4 overflow-y-auto">
        <ConfigCard value={config} onChange={handleChange} />
      </aside>
      <main className="flex-1 flex flex-col min-h-0">
        <CopilotChat
          agentId="agent_config"
          className="flex-1 min-h-0"
          labels={{
            chatInputPlaceholder: "Try the agent under different configs...",
          }}
        />
      </main>
    </div>
  );
}
