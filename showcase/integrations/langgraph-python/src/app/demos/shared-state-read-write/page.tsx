"use client";

// Canonical source; materialized into each selected integration by
// showcase/scripts/sync-shared-frontends.ts.

import React, { useEffect } from "react";
import {
  CopilotKit,
  useAgent,
  UseAgentUpdate,
} from "@copilotkit/react-core/v2";

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
  // @region[shared-state-provider]
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="shared-state-read-write">
      <DemoContent />
    </CopilotKit>
  );
  // @endregion[shared-state-provider]
}

function DemoContent() {
  // @region[use-agent]
  // @region[use-agent-read]
  // Subscribe the component to agent state changes. Any time the agent
  // mutates its state (e.g. via its `set_notes` tool) this hook fires,
  // we re-render, and the sidebar panels reflect the new values.
  const { agent, isReady } = useAgent({
    agentId: "shared-state-read-write",
    updates: [UseAgentUpdate.OnStateChanged],
  });
  // @endregion[use-agent-read]
  // @endregion[use-agent]

  useSharedStateReadWriteSuggestions();

  const agentState = agent.state as RWAgentState | undefined;
  const preferences = agentState?.preferences ?? INITIAL_PREFERENCES;
  const notes = agentState?.notes ?? [];

  // Wait for the runtime-synchronized agent before seeding. `useAgent` first
  // exposes a provisional instance, then swaps in the instance that
  // serializes `input.state` on a run. Seeding the provisional instance loses
  // preferences; seeding before hydration can overwrite persisted state.
  useEffect(() => {
    if (!isReady) return;
    const currentState = agent.state as RWAgentState | undefined;
    if (!currentState?.preferences) {
      agent.setState({
        ...(currentState as object | undefined),
        preferences: INITIAL_PREFERENCES,
        notes: currentState?.notes ?? [],
      } as RWAgentState);
    }
  }, [agent, isReady]);

  // @region[set-state]
  // @region[use-agent-write]
  // WRITE: every edit in the sidebar goes straight into agent state.
  // On the agent's next turn, the route's opt-in stateSystemPrompt formatter
  // reads this back out of state and adds it to the system prompt — so the
  // UI's writes visibly steer the model.
  const handlePreferencesChange = (next: Preferences) => {
    agent.setState({
      ...(agentState as object | undefined),
      preferences: next,
      notes: agentState?.notes ?? [],
    } as RWAgentState);
  };
  // @endregion[use-agent-write]
  // @endregion[set-state]

  // WRITE: let the user clear the agent-authored notes from the UI.
  const handleClearNotes = () => {
    agent.setState({
      ...(agentState as object | undefined),
      preferences: agentState?.preferences ?? INITIAL_PREFERENCES,
      notes: [],
    } as RWAgentState);
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
