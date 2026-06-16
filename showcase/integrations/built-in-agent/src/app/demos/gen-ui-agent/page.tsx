"use client";

import React from "react";
import {
  CopilotChat,
  CopilotKit,
  useAgent,
  UseAgentUpdate,
} from "@copilotkit/react-core/v2";
import type { Step } from "./InlineAgentStateCard";
import { MessageListWithState } from "./message-list-with-state";
import { useSuggestions } from "./suggestions";

/**
 * Agentic Generative UI — In-Chat State Rendering
 *
 * The backend exposes a custom `set_steps` tool that the model calls to
 * update the current plan. Each call is translated into an AG-UI state
 * snapshot so the client receives the latest `steps`.
 *
 * On the client we subscribe to that live state via `useAgent` (v2) and
 * render a single `InlineAgentStateCard` inside the chat transcript via
 * `messageView.children`. The card re-renders in place as state arrives —
 * no per-message claims, no duplicate cards.
 *
 * This replaces the earlier `useCoAgentStateRender` approach, which produced
 * one card per state-changing message.
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

type AgentState = {
  steps?: Step[];
};

function Chat() {
  const { agent } = useAgent({
    agentId: "gen-ui-agent",
    updates: [UseAgentUpdate.OnStateChanged],
  });

  useSuggestions();

  const steps = (agent.state as AgentState | undefined)?.steps ?? [];
  const status = agent.isRunning ? "inProgress" : "complete";

  return (
    <CopilotChat
      agentId="gen-ui-agent"
      className="h-full rounded-2xl"
      messageView={{
        children: ({ messageElements, interruptElement }) => (
          <MessageListWithState
            messageElements={messageElements}
            interruptElement={interruptElement}
            steps={steps}
            status={status}
          />
        ),
      }}
    />
  );
}
