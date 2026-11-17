"use client";

import React from "react";
import {
  CopilotKit,
  useAgent,
  UseAgentUpdate,
} from "@copilotkit/react-core/v2";
import { useDemoRuntimeUrl } from "@/lib/demo-runtime";

import { DemoLayout } from "./demo-layout";
import { useSharedStateStreamingSuggestions } from "./suggestions";

interface StreamingAgentState {
  document?: string;
}

interface SharedStateStreamingDemoProps {
  /** Set when the backend cannot stream the document token by token. */
  unsupportedNotice?: string;
}

export function SharedStateStreamingDemo({
  unsupportedNotice,
}: SharedStateStreamingDemoProps) {
  return (
    <CopilotKit
      runtimeUrl={useDemoRuntimeUrl("shared-state-streaming")}
      agent="shared-state-streaming"
    >
      <DemoContent unsupportedNotice={unsupportedNotice} />
    </CopilotKit>
  );
}

function DemoContent({ unsupportedNotice }: SharedStateStreamingDemoProps) {
  // @region[frontend-use-coagent-state]
  // Subscribe to BOTH state changes and run-status changes. The former
  // drives the per-token document rerender. The latter toggles the
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

  return (
    <DemoLayout
      document={document}
      isStreaming={isRunning}
      unsupportedNotice={unsupportedNotice}
    />
  );
}
