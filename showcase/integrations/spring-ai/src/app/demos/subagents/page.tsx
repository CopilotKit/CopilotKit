"use client";

/**
 * Sub-Agents demo — Spring AI port.
 *
 * Mirrors the LangGraph reference
 * (showcase/integrations/langgraph-python/src/app/demos/subagents/) against the
 * Spring controller at `/subagents/run`.
 *
 * A supervisor LLM coordinates three sub-agents (research / writing /
 * critique). On the backend, each sub-agent is its own Spring AI ChatClient
 * call with a dedicated system prompt; the supervisor invokes them as
 * tools. After every delegation the Spring controller appends a Delegation
 * entry to `state.delegations` and emits a STATE_SNAPSHOT, so this page's
 * live "delegation log" panel updates entry by entry as the supervisor
 * works.
 */

import React from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotChat,
  useAgent,
  UseAgentUpdate,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

import { DelegationLog, Delegation } from "./delegation-log";

interface SubagentsAgentState {
  delegations?: Delegation[];
}

export default function SubagentsDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit-subagents" agent="subagents">
      <DemoContent />
    </CopilotKit>
  );
}

function DemoContent() {
  const { agent } = useAgent({
    agentId: "subagents",
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
