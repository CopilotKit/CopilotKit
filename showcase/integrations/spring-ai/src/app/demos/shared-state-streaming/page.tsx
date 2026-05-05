"use client";

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useAgent,
  UseAgentUpdate,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

import { DocumentView } from "./document-view";

interface StreamingAgentState {
  document?: string;
}

export default function SharedStateStreamingDemo() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit-shared-state-streaming"
      agent="shared-state-streaming"
    >
      <DemoContent />
    </CopilotKit>
  );
}

function DemoContent() {
  // Subscribe to BOTH state changes and run-status changes. The former
  // drives the per-token document rerender; the latter toggles the
  // "LIVE" badge when the agent starts / stops.
  const { agent } = useAgent({
    agentId: "shared-state-streaming",
    updates: [UseAgentUpdate.OnStateChanged, UseAgentUpdate.OnRunStatusChanged],
  });

  useConfigureSuggestions({
    suggestions: [
      {
        title: "Write a short poem",
        message: "Write a short poem about autumn leaves.",
      },
      {
        title: "Draft an email",
        message:
          "Draft a polite email declining a meeting next Tuesday afternoon.",
      },
      {
        title: "Explain quantum computing",
        message:
          "Write a 2-paragraph explanation of quantum computing for a curious teenager.",
      },
    ],
    available: "always",
  });

  const agentState = agent.state as StreamingAgentState | undefined;
  const document = agentState?.document ?? "";
  const isRunning = agent.isRunning;

  return (
    <div className="flex flex-col md:flex-row h-screen w-full bg-gray-50">
      <section className="flex-1 min-h-0 p-4">
        <DocumentView content={document} isStreaming={isRunning} />
      </section>
      <aside className="md:w-[420px] md:shrink-0 flex flex-col min-h-0 border-l bg-white">
        <CopilotChat
          agentId="shared-state-streaming"
          className="flex-1 min-h-0"
          labels={{
            chatInputPlaceholder: "Ask me to write something...",
          }}
        />
      </aside>
    </div>
  );
}
