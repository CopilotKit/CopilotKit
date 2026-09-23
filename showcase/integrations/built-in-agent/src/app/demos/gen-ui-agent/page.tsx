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
 * The backend agent keeps a `steps` list in its state and exposes a
 * `set_steps` tool that the model calls with the full plan on every status
 * transition. The integration publishes each update to the client as agent
 * state.
 *
 * On the client we subscribe to that state via `useAgent` (v2) and render a
 * single `InlineAgentStateCard` inside the chat transcript via
 * `messageView.children`. The card re-renders in place as state arrives —
 * no per-message claims, no duplicate cards.
 *
 * Canonical source; materialized into each consuming integration by
 * showcase/scripts/sync-shared-frontends.ts.
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

// @region[gen-ui-agent-state-rendering]
type AgentState = {
  steps?: Step[];
};

function Chat() {
  // OnStateChanged re-renders on every `steps` update. OnRunStatusChanged
  // re-renders when the run starts and ends, so `status` below reflects
  // `agent.isRunning` after the final state update has already landed.
  const { agent } = useAgent({
    agentId: "gen-ui-agent",
    updates: [UseAgentUpdate.OnStateChanged, UseAgentUpdate.OnRunStatusChanged],
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
// @endregion[gen-ui-agent-state-rendering]
