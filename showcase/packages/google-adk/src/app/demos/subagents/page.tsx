"use client";

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotChat,
  useAgent,
  UseAgentUpdate,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

import { DelegationLog, Delegation } from "./delegation-log";

interface SubagentsState {
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
  const { agent } = useAgent({
    agentId: "subagents",
    updates: [UseAgentUpdate.OnStateChanged],
  });

  useConfigureSuggestions({
    suggestions: [
      {
        title: "Quick brief",
        message:
          "Plan a 1-paragraph brief on the benefits of pair programming.",
      },
      {
        title: "Marketing post",
        message:
          "Draft and critique a LinkedIn post announcing CopilotKit 2.0.",
      },
    ],
    available: "always",
  });

  const state = agent.state as SubagentsState | undefined;
  const delegations = state?.delegations ?? [];

  return (
    <div className="flex flex-col md:flex-row h-screen w-full bg-gray-50">
      <section className="flex-1 min-h-0 p-4">
        <DelegationLog delegations={delegations} />
      </section>
      <aside className="md:w-[420px] md:shrink-0 flex flex-col min-h-0 border-l bg-white">
        <CopilotChat
          agentId="subagents"
          className="flex-1 min-h-0"
          labels={{
            chatInputPlaceholder:
              "Ask the supervisor to plan, draft, or critique...",
          }}
        />
      </aside>
    </div>
  );
}
