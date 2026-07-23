"use client";

import React, { useEffect } from "react";
import {
  CopilotKit,
  useAgent,
  UseAgentUpdate,
} from "@copilotkit/react-core/v2";

import { Preferences } from "./preferences-card";
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
    <CopilotKit runtimeUrl="/api/copilotkit" agent="shared-state-read-write">
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

  const agentState = agent.state as RWAgentState | undefined;
  const preferences = agentState?.preferences ?? INITIAL_PREFERENCES;
  const notes = agentState?.notes ?? [];

  // Seed initial preferences + empty notes into agent state once, so the
  // agent has something to read on the very first turn.
  useEffect(() => {
    if (!agentState?.preferences) {
      agent.setState({
        preferences: INITIAL_PREFERENCES,
        notes: [],
      } as RWAgentState);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // @region[set-state]
  // @region[use-agent-write]
  // WRITE: every edit in the sidebar goes straight into agent state.
  // On the agent's next turn, `PreferencesInjectorMiddleware` reads this
  // back out of state and adds it to the system prompt — so the UI's
  // writes visibly steer the model.
  const handlePreferencesChange = (next: Preferences) => {
    agent.setState({
      preferences: next,
      notes, // preserve what the agent has written
    } as RWAgentState);
  };
  // @endregion[use-agent-write]
  // @endregion[set-state]

  // WRITE: let the user clear the agent-authored notes from the UI.
  const handleClearNotes = () => {
    agent.setState({ preferences, notes: [] } as RWAgentState);
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
