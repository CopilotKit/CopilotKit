"use client";

import React, { useEffect } from "react";
import {
  CopilotKit,
  useAgent,
  UseAgentUpdate,
} from "@copilotkit/react-core/v2";
import { useDemoRuntimeUrl } from "@/lib/demo-runtime";

import type { Preferences } from "./preferences-card";
import { DemoLayout } from "./demo-layout";
import { useSharedStateReadWriteSuggestions } from "./suggestions";

const INITIAL_PREFERENCES: Preferences = {
  name: "",
  tone: "casual",
  language: "English",
  interests: [],
};

// Shape of the bidirectional shared state.
// - `preferences` is WRITTEN by the UI via agent.setState().
// - `notes` is WRITTEN by the agent via its `set_notes` tool and READ
//   by the UI via useAgent().
interface RWAgentState {
  preferences: Preferences;
  notes: string[];
}

export default function SharedStateReadWriteDemo() {
  return (
    <CopilotKit
      runtimeUrl={useDemoRuntimeUrl("shared-state-read-write")}
      agent="shared-state-read-write"
    >
      <DemoContent />
    </CopilotKit>
  );
}

function DemoContent() {
  // @region[use-agent]
  // @region[use-agent-read]
  // Subscribe the component to agent state changes. Any time the agent
  // mutates its state (e.g. via its `set_notes` tool) this hook fires,
  // we re-render, and the sidebar panels reflect the new values.
  const { agent } = useAgent({
    agentId: "shared-state-read-write",
    updates: [UseAgentUpdate.OnStateChanged],
  });
  // @endregion[use-agent-read]
  // @endregion[use-agent]

  useSharedStateReadWriteSuggestions();

  const agentState = agent.state as Partial<RWAgentState> | undefined;
  const preferences = agentState?.preferences ?? INITIAL_PREFERENCES;
  const notes = agentState?.notes ?? [];

  // Seed the initial preferences and an empty notes list, so the agent has
  // something to read on the first turn.
  //
  // The effect depends on `agent`: while the runtime's /info request is in
  // flight, `useAgent` returns a provisional agent, and then it swaps in the
  // real agent. Only the real agent sends its state to the backend, so it
  // must be seeded too. The `preferences` check keeps the seed from
  // overwriting state that is already there.
  useEffect(() => {
    const current = agent.state as Partial<RWAgentState> | undefined;
    if (current?.preferences) return;
    agent.setState({
      ...current,
      preferences: INITIAL_PREFERENCES,
      notes: current?.notes ?? [],
    } satisfies RWAgentState);
  }, [agent]);

  // @region[set-state]
  // @region[use-agent-write]
  // WRITE: every edit in the sidebar goes straight into agent state.
  // On the agent's next turn, the backend reads the preferences back out of
  // state and adds them to the system prompt, so the UI's writes visibly
  // steer the model. `setState` replaces the whole state object, so the
  // write spreads the current state to keep any keys the runtime owns.
  const handlePreferencesChange = (next: Preferences) => {
    agent.setState({
      ...agentState,
      preferences: next,
      notes, // preserve what the agent has written
    } satisfies RWAgentState);
  };
  // @endregion[use-agent-write]
  // @endregion[set-state]

  // WRITE: let the user clear the agent-authored notes from the UI.
  const handleClearNotes = () => {
    agent.setState({
      ...agentState,
      preferences,
      notes: [],
    } satisfies RWAgentState);
  };

  return (
    <DemoLayout
      preferences={preferences}
      notes={notes}
      onPreferencesChange={handlePreferencesChange}
      onClearNotes={handleClearNotes}
    />
  );
}
