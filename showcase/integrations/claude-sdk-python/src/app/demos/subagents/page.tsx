"use client";

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotChat,
  useAgent,
  UseAgentUpdate,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

import type { Delegation } from "./delegation-log";
import { DelegationLog } from "./delegation-log";

interface SubagentsAgentState {
  delegations?: Delegation[];
}

export default function SubagentsDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="subagents">
      <DemoContent />
    </CopilotKit>
  );
}

function DemoContent() {
  // Subscribe to agent state changes — every delegation append/update
  // emits a StateSnapshotEvent so this re-renders in real time.
  const { agent } = useAgent({
    agentId: "subagents",
    updates: [UseAgentUpdate.OnStateChanged, UseAgentUpdate.OnRunStatusChanged],
  });

  // @region[configure-suggestions]
  useConfigureSuggestions({
    suggestions: [
      {
        title: "Research draft",
        message:
          "Research the benefits of remote work and draft a one-paragraph summary",
      },
    ],
    available: "always",
  });
  // @endregion[configure-suggestions]

  const agentState = agent.state as SubagentsAgentState | undefined;
  const delegations = agentState?.delegations ?? [];
  const isRunning = agent.isRunning;

  return (
    <div className="flex flex-col md:flex-row h-screen w-full bg-gray-50">
      <section className="flex-1 min-h-0 p-4">
        <DelegationLog delegations={delegations} isRunning={isRunning} />
      </section>
      <aside className="md:w-[420px] md:shrink-0 flex flex-col min-h-0 border-l bg-white">
        <CopilotChat
          agentId="subagents"
          className="flex-1 min-h-0"
          labels={{
            chatInputPlaceholder: "Give the supervisor a task...",
          }}
        />
      </aside>
    </div>
  );
}
