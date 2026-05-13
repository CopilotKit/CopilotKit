"use client";

import React, { useEffect, useRef } from "react";
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

  // Seed initial preferences exactly once, AFTER agent.state has been
  // observed at least once. The previous mount-only effect with empty
  // deps could fire before the runtime hydrated state on reload, wiping
  // backend-persisted preferences with INITIAL_PREFERENCES.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    if (agentState === undefined) return; // wait for first state event
    seededRef.current = true;
    if (!agentState?.preferences) {
      // Spread the observed state so any keys the runtime owns
      // (`copilotkit` slot, future framework additions) survive the
      // seed write — `agent.setState` replaces the whole state object
      // rather than merging. `notes` falls back to the observed value
      // (or `[]` if absent) so an existing notes list isn't wiped just
      // because the user landed without persisted preferences.
      agent.setState({
        ...(agentState as object | undefined),
        preferences: INITIAL_PREFERENCES,
        notes: agentState?.notes ?? [],
      } as RWAgentState);
    }
  }, [agent, agentState]);

  // @region[set-state]
  // @region[use-agent-write]
  // WRITE: every edit in the sidebar goes straight into agent state.
  // On the agent's next turn, `_inject_preferences` reads this back out
  // of state and prepends a preferences SystemMessage — so the UI's
  // writes visibly steer the model.
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
