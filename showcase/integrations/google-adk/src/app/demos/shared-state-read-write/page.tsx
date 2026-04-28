"use client";

import React, { useEffect, useRef } from "react";
import {
  CopilotKit,
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
  // @region[use-agent-read]
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

  // Handlers spread the closure-fresh `agentState` so no key is dropped.
  // Each handler is recreated every render, so `agentState` reflects the
  // most recent committed snapshot. Rapid back-to-back interactions
  // before React re-renders can still write the same snapshot twice —
  // CopilotKit's STATE_DELTA stream resolves the merge upstream and
  // either order is correct because both writes carry the full pair.
  // @region[use-agent-write]
  const handlePreferencesChange = (next: Preferences) => {
    agent.setState({
      ...(agentState as object | undefined),
      preferences: next,
      notes: agentState?.notes ?? [],
    } as RWAgentState);
  };
  // @endregion[use-agent-write]

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
