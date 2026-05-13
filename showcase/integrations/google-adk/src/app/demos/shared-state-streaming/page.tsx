"use client";

import React from "react";
import {
  CopilotKit,
  useAgent,
  UseAgentUpdate,
} from "@copilotkit/react-core/v2";

import { DemoLayout } from "./demo-layout";
import { useSharedStateStreamingSuggestions } from "./suggestions";

interface StreamingAgentState {
  document?: string;
}

export default function SharedStateStreamingDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="shared-state-streaming">
      <DemoContent />
    </CopilotKit>
  );
}

function DemoContent() {
  // @region[frontend-use-coagent-state]
  // Subscribe to BOTH state changes and run-status changes. The former
  // drives the per-token document rerender; the latter toggles the
  // "LIVE" badge when the agent starts / stops.
  const { agent } = useAgent({
    agentId: "shared-state-streaming",
    updates: [UseAgentUpdate.OnStateChanged, UseAgentUpdate.OnRunStatusChanged],
  });
  // @endregion[frontend-use-coagent-state]

  useSharedStateStreamingSuggestions();

  const agentState = agent.state as StreamingAgentState | undefined;
  const document = agentState?.document ?? "";
  const isRunning = agent.isRunning;

  return <DemoLayout document={document} isStreaming={isRunning} />;
}
