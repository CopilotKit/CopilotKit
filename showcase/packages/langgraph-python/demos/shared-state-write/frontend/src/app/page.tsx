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

const INITIAL_PREFERENCES: Preferences = {
  name: "",
  tone: "casual",
  language: "English",
  interests: [],
};

interface WriteAgentState {
  preferences: Preferences;
}

export default function SharedStateWriteDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="shared-state-write">
      <DemoContent />
    </CopilotKit>
  );
}

function DemoContent() {
  const { agent } = useAgent({
    agentId: "shared-state-write",
    updates: [UseAgentUpdate.OnStateChanged],
  });

  useConfigureSuggestions({
    suggestions: [
      { title: "Greet me", message: "Say hi and introduce yourself." },
      {
        title: "Plan a weekend",
        message: "Suggest a weekend plan based on my interests.",
      },
      {
        title: "Respect my tone",
        message: "Tell me a short story in my preferred tone and language.",
      },
    ],
    available: "always",
  });

  const agentState = agent.state as WriteAgentState | undefined;
  const preferences = agentState?.preferences ?? INITIAL_PREFERENCES;

  // Seed initial preferences into agent state once, so the agent has
  // something to read on the very first turn.
  useEffect(() => {
    if (!agentState?.preferences) {
      agent.setState({ preferences: INITIAL_PREFERENCES });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every edit in the sidebar writes straight through to agent state.
  const handlePreferencesChange = (next: Preferences) => {
    agent.setState({ preferences: next });
  };

  return (
    <div className="flex flex-col md:flex-row h-screen w-full bg-gray-50">
      <aside className="p-4 md:w-[360px] md:shrink-0 overflow-y-auto">
        <PreferencesCard
          value={preferences}
          onChange={handlePreferencesChange}
        />
      </aside>
      <main className="flex-1 flex flex-col min-h-0">
        <CopilotChat
          agentId="shared-state-write"
          className="flex-1 min-h-0"
          labels={{
            chatInputPlaceholder: "Chat with the agent...",
          }}
        />
      </main>
    </div>
  );
}
