"use client";

import React, { useEffect } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotChat,
  useAgent,
  UseAgentUpdate,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

import { PreferencesCard, Preferences } from "./preferences-card";
import { NotesCard } from "./notes-card";

const INITIAL_PREFERENCES: Preferences = {
  name: "",
  tone: "casual",
  language: "English",
  interests: [],
};

// Shape of the bidirectional shared state.
// - `preferences` is WRITTEN by the UI via agent.setState().
// - `notes` is WRITTEN by the agno agent via its `set_notes` tool and
//   READ by the UI via useAgent().
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
  // @region[use-agent-read]
  // Subscribe to agent state changes. The custom AGUI router for this
  // agent (see agent_server.py) emits a STATE_SNAPSHOT event after every
  // run, which fires this hook and re-renders the panels below.
  const { agent } = useAgent({
    agentId: "shared-state-read-write",
    updates: [UseAgentUpdate.OnStateChanged],
  });
  // @endregion[use-agent-read]

  useConfigureSuggestions({
    suggestions: [
      { title: "Greet me", message: "Say hi and introduce yourself." },
      {
        title: "Remember something",
        message:
          "Remember that I prefer morning meetings and that I don't eat dairy.",
      },
      {
        title: "Plan a weekend",
        message: "Suggest a weekend plan based on my interests.",
      },
    ],
    available: "always",
  });

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

  // @region[use-agent-write]
  // WRITE: every edit in the sidebar goes straight into agent state.
  // On the agent's next turn, the dynamic instructions function reads
  // this back out of session_state and adds it to the system prompt —
  // so the UI's writes visibly steer the model.
  const handlePreferencesChange = (next: Preferences) => {
    agent.setState({
      preferences: next,
      notes, // preserve what the agent has written
    } as RWAgentState);
  };
  // @endregion[use-agent-write]

  // WRITE: let the user clear the agent-authored notes from the UI.
  const handleClearNotes = () => {
    agent.setState({ preferences, notes: [] } as RWAgentState);
  };

  return (
    <div className="flex flex-col md:flex-row h-screen w-full bg-gray-50">
      <aside className="p-4 md:w-[360px] md:shrink-0 overflow-y-auto space-y-4">
        <PreferencesCard
          value={preferences}
          onChange={handlePreferencesChange}
        />
        <NotesCard notes={notes} onClear={handleClearNotes} />
      </aside>
      <main className="flex-1 flex flex-col min-h-0">
        <CopilotChat
          agentId="shared-state-read-write"
          className="flex-1 min-h-0"
          labels={{
            chatInputPlaceholder: "Chat with the agent...",
          }}
        />
      </main>
    </div>
  );
}
