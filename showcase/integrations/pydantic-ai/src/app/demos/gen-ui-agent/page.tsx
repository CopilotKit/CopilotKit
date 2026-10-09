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
 * The intended contract: a backend agent defines its own state schema
 * (`steps: list[Step]`) and exposes a custom `set_steps` tool that the model
 * calls to mutate that state, streaming updated `steps` to the client.
 *
 * NOT IMPLEMENTED IN THIS PACKAGE. There is no `src/agents/gen_ui_agent.py`
 * and no `set_steps` tool anywhere in this package's Python. `gen-ui-agent`
 * has no route override, so it proxies to the root sales agent
 * (`src/agents/agent.py`), whose state slot is `todos`, not `steps` — the
 * card below therefore never populates. The frontend, the D6 fixture and
 * `tests/e2e/gen-ui-agent.spec.ts` were all copied from a parity sweep that
 * did not port the backend. Tracked in GH #6381.
 *
 * On the client we subscribe to agent state via `useAgent` (v2) and render a
 * single `InlineAgentStateCard` inside the chat transcript via
 * `messageView.children`. The card re-renders in place as state arrives —
 * no per-message claims, no duplicate cards. This mirrors the pattern used
 * by the integrations that do implement the backend (mastra, strands, ag2,
 * agno, crewai-crews, langgraph-typescript, ...) and replaces the earlier
 * `useCoAgentStateRender` approach which produced one card per
 * state-changing message.
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
