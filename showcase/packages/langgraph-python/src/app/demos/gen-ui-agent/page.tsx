"use client";

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useAgent,
  UseAgentUpdate,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { InlineAgentStateCard } from "./InlineAgentStateCard";

/**
 * Agentic Generative UI — In-Chat State Rendering
 *
 * Demonstrates how to render intermediate agent state inline within the chat
 * transcript while a long-running agent task is in progress. The previous
 * v1 API `useCoAgentStateRender` has been replaced: in v2 you subscribe to
 * state updates via `useAgent({ updates: [OnStateChanged, OnRunStatusChanged] })`
 * and inject the rendered card through the `messageView.children` slot on
 * `<CopilotChat />`.
 */
export default function GenUiAgentDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="gen-ui-agent">
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

// The agent's state shape is open-ended; we render whatever keys it emits.
type AgentState = Record<string, unknown> | undefined;

function Chat() {
  // Subscribe to state + run-status changes so the inline progress card
  // re-renders whenever the agent emits a state update or toggles isRunning.
  const { agent } = useAgent({
    agentId: "gen-ui-agent",
    updates: [UseAgentUpdate.OnStateChanged, UseAgentUpdate.OnRunStatusChanged],
  });

  useConfigureSuggestions({
    suggestions: [
      {
        title: "Run a 3-step task",
        message:
          "Run a 3-step task: fetch data, process it, then summarize the result.",
      },
      {
        title: "Plan a project",
        message: "Break this down into steps: planning a small web app launch.",
      },
    ],
    available: "always",
  });

  const agentState = agent.state as AgentState;
  const isRunning = agent.isRunning;

  const stateEntries = agentState
    ? Object.entries(agentState).filter(
        ([, v]) => v !== undefined && v !== null,
      )
    : [];

  return (
    <CopilotChat
      agentId="gen-ui-agent"
      className="h-full rounded-2xl"
      messageView={{
        children: ({ messageElements, interruptElement }) => (
          <div
            data-testid="copilot-message-list"
            className="flex flex-col gap-2"
          >
            {messageElements}
            {(isRunning || stateEntries.length > 0) && (
              <InlineAgentStateCard
                isRunning={isRunning}
                stateEntries={stateEntries}
              />
            )}
            {interruptElement}
          </div>
        ),
      }}
    />
  );
}
