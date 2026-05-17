"use client";

/**
 * Homepage: Shared State — bare-minimum two-way state via useAgent.
 *
 * Reuses the `shared_state_read_write` LangGraph backend. Strips the
 * preferences card, notes card, and demo layout — just useAgent +
 * setState in 25 lines, with a tiny inline UI so the bidirectional sync
 * is visible at a glance.
 *
 * Iframe target for the "Shared State" chip on the website homepage dojo.
 */

import { useEffect } from "react";
import {
  CopilotKit,
  CopilotChat,
  useAgent,
  UseAgentUpdate,
} from "@copilotkit/react-core/v2";

type RWState = {
  preferences: { tone: string; language: string };
  notes: string[];
};

const INITIAL: RWState = {
  preferences: { tone: "casual", language: "English" },
  notes: [],
};

function DemoContent() {
  // Subscribe the UI to agent state changes — every time the agent's
  // `set_notes` tool writes, this re-renders.
  const { agent } = useAgent({
    agentId: "shared-state-read-write",
    updates: [UseAgentUpdate.OnStateChanged],
  });

  const state = (agent.state as RWState | undefined) ?? INITIAL;

  // Seed once so the agent has something to read on the first turn.
  useEffect(() => {
    if (!agent.state) agent.setState(INITIAL);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-screen">
      <aside className="w-72 p-4 border-r overflow-auto text-sm">
        <div className="font-semibold mb-2">Shared state</div>
        <pre className="text-xs whitespace-pre-wrap break-words">
          {JSON.stringify(state, null, 2)}
        </pre>
      </aside>
      <div className="flex-1">
        <CopilotChat agentId="shared-state-read-write" />
      </div>
    </div>
  );
}

export default function HomeSharedStateDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="shared-state-read-write">
      <DemoContent />
    </CopilotKit>
  );
}
