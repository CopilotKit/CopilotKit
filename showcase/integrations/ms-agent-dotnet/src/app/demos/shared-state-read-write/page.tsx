"use client";

import React, { useEffect, useRef } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import {
  CopilotChat,
  useAgent,
  UseAgentUpdate,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

import type { Preferences } from "./preferences-card";
import { PreferencesCard } from "./preferences-card";
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

  // Seed initial preferences exactly once, AFTER agent.state has been
  // observed at least once. The previous mount-only effect with empty
  // deps could fire before the runtime hydrated state on reload, wiping
  // backend-persisted preferences with INITIAL_PREFERENCES.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    if (agentState === undefined) return;
    seededRef.current = true;
    if (!agentState?.preferences) {
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
  // Each handler closes over the latest committed snapshot via re-render,
  // so spreading `agentState` preserves any keys the runtime owns
  // (`copilotkit` slot, future framework additions). `agent.setState`
  // replaces the whole object rather than merging.
  const handlePreferencesChange = (next: Preferences) => {
    agent.setState({
      ...(agentState as object | undefined),
      preferences: next,
      notes: agentState?.notes ?? [],
    } as RWAgentState);
  };
  // @endregion[use-agent-write]
  // @endregion[set-state]

  const handleClearNotes = () => {
    agent.setState({
      ...(agentState as object | undefined),
      preferences: agentState?.preferences ?? INITIAL_PREFERENCES,
      notes: [],
    } as RWAgentState);
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
          labels={{ chatInputPlaceholder: "Chat with the agent..." }}
        />
      </main>
    </div>
  );
}
