"use client";

import React from "react";
import {
  CopilotKit,
  useAgent,
  UseAgentUpdate,
  useRenderTool,
} from "@copilotkit/react-core/v2";
import { z } from "zod";

import { Delegation } from "./delegation-log";
import {
  SubAgentActivityCard,
  type SubAgentToolStatus,
} from "./subagent-activity-card";
import { DemoLayout } from "./demo-layout";
import { inferActiveSubAgent } from "./active-subagent";
import { useSubagentsSuggestions } from "./suggestions";

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
  const { agent } = useAgent({
    agentId: "subagents",
    updates: [UseAgentUpdate.OnStateChanged, UseAgentUpdate.OnRunStatusChanged],
  });

  useSubagentsSuggestions();

  // @region[subagent-tool-renderers]
  // Per-tool renderers — one for each sub-agent tool the supervisor can
  // call. These surface "Researcher is running task Y" inline in the
  // chat stream so the user can see what is happening without staring
  // at the side panel. Each tool's `render` receives streaming
  // parameters + the eventual result + a status that walks
  // inProgress → executing → complete.
  useRenderTool(
    {
      name: "research_agent",
      parameters: z.object({ task: z.string() }),
      render: ({ parameters, status, result }) => (
        <SubAgentActivityCard
          subAgent="research_agent"
          task={parameters?.task}
          status={status as SubAgentToolStatus}
          result={typeof result === "string" ? result : undefined}
        />
      ),
    },
    [],
  );

  useRenderTool(
    {
      name: "writing_agent",
      parameters: z.object({ task: z.string() }),
      render: ({ parameters, status, result }) => (
        <SubAgentActivityCard
          subAgent="writing_agent"
          task={parameters?.task}
          status={status as SubAgentToolStatus}
          result={typeof result === "string" ? result : undefined}
        />
      ),
    },
    [],
  );

  useRenderTool(
    {
      name: "critique_agent",
      parameters: z.object({ task: z.string() }),
      render: ({ parameters, status, result }) => (
        <SubAgentActivityCard
          subAgent="critique_agent"
          task={parameters?.task}
          status={status as SubAgentToolStatus}
          result={typeof result === "string" ? result : undefined}
        />
      ),
    },
    [],
  );
  // @endregion[subagent-tool-renderers]

  const agentState = agent.state as SubagentsAgentState | undefined;
  const delegations = agentState?.delegations ?? [];
  const isRunning = agent.isRunning;
  const activeSubAgent = isRunning
    ? inferActiveSubAgent(delegations, agent.messages)
    : null;

  return (
    <DemoLayout
      delegations={delegations}
      isRunning={isRunning}
      activeSubAgent={activeSubAgent}
    />
  );
}
