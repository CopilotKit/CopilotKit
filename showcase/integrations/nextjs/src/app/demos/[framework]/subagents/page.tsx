"use client";

import React, { use } from "react";
import {
  useAgent,
  UseAgentUpdate,
  useConfigureSuggestions,
  CopilotChat,
} from "@copilotkit/react-core/v2";
import { CopilotKit } from "@copilotkit/react-core";
import { DelegationLog, Delegation } from "./delegation-log";

const DEMO_ID = "subagents";

interface SubagentsAgentState {
  delegations?: Delegation[];
}

export default function SubagentsDemo({
  params,
}: {
  params: Promise<{ framework: string }>;
}) {
  const { framework } = use(params);
  return (
    <CopilotKit runtimeUrl={`/api/${framework}/${DEMO_ID}`} agent={DEMO_ID}>
      <DemoContent />
    </CopilotKit>
  );
}

function DemoContent() {
  const { agent } = useAgent({
    agentId: DEMO_ID,
    updates: [UseAgentUpdate.OnStateChanged, UseAgentUpdate.OnRunStatusChanged],
  });

  useConfigureSuggestions({
    suggestions: [
      {
        title: "Write a blog post",
        message:
          "Produce a short blog post about the benefits of cold exposure training. Research first, then write, then critique.",
      },
      {
        title: "Explain a topic",
        message:
          "Explain how large language models handle tool calling. Research, write a paragraph, then critique.",
      },
      {
        title: "Summarize a topic",
        message:
          "Summarize the current state of reusable rockets in 1 polished paragraph, with research and critique.",
      },
    ],
    available: "always",
  });

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
          agentId={DEMO_ID}
          className="flex-1 min-h-0"
          labels={{
            chatInputPlaceholder: "Give the supervisor a task...",
          }}
        />
      </aside>
    </div>
  );
}
