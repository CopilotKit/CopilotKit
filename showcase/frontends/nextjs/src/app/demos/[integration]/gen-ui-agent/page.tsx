"use client";

import React from "react";
import {
  CopilotChat,
  CopilotKit,
  useAgent,
  UseAgentUpdate,
} from "@copilotkit/react-core/v2";
import { useDemoRuntimeUrl } from "@/lib/demo-runtime";
import type { Step } from "./InlineAgentStateCard";
import { MessageListWithState } from "./message-list-with-state";
import { useSuggestions } from "./suggestions";

/**
 * Agentic Generative UI: In-Chat State Rendering
 *
 * The agent on the backend keeps its own state (`steps: Step[]`) and exposes
 * a `set_steps` tool that the model calls to change that state. Every
 * `set_steps` call streams the updated `steps` to the client.
 *
 * On the client, `useAgent` subscribes to that live state, and
 * `messageView.children` renders a single `InlineAgentStateCard` inside the
 * chat transcript. The card re-renders in place as state arrives, so there
 * is one card per run, not one per state update.
 */
export default function GenUiAgentDemo() {
  return (
    <CopilotKit
      runtimeUrl={useDemoRuntimeUrl("gen-ui-agent")}
      agent="gen-ui-agent"
    >
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
