"use client";

/**
 * Shared State (Read + Write) demo — Spring AI port.
 *
 * Mirrors the LangGraph reference
 * (showcase/integrations/langgraph-python/src/app/demos/shared-state-read-write/)
 * against the Spring controller at `/shared-state-read-write/run`.
 *
 * - WRITE (UI -> agent): the sidebar form's `preferences` object is pushed
 *   into agent state via `agent.setState({ preferences, notes })`. On the
 *   next turn, the Spring agent reads it off the AG-UI envelope and injects
 *   it into the system prompt so the LLM adapts to tone, language, name,
 *   and interests.
 * - READ (agent -> UI): the agent calls its `set_notes` tool, which mutates
 *   `state.notes` and emits a STATE_SNAPSHOT. `useAgent({updates:
 *   [OnStateChanged]})` re-renders this page and the notes card reflects
 *   the new list immediately.
 */

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

interface RWAgentState {
  preferences: Preferences;
  notes: string[];
}

export default function SharedStateReadWriteDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit-shared-state-read-write"
      agent="shared-state-read-write"
    >
      <DemoContent />
    </CopilotKit>
  );
}

function DemoContent() {
  // @region[use-agent-read]
  // Subscribe the component to agent state changes. Any time the agent
  // mutates its state (e.g. via its `set_notes` tool) this hook fires,
  // we re-render, and the sidebar panels reflect the new values.
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
  // Spring agent has something to read on the very first turn.
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
  // WRITE: every edit in the sidebar goes straight into agent state. On
  // the agent's next turn, the Spring controller reads the same object off
  // the AG-UI state envelope and adds it to the system prompt.
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
