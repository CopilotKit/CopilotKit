"use client";

import React from "react";
import {
  CopilotKit,
  CopilotChat,
  useAgent,
  UseAgentUpdate,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";

/**
 * Agentic Generative UI — In-Chat State Rendering
 *
 * Demonstrates how to render intermediate agent state inline within the chat
 * transcript while a long-running agent task is in progress. The previous
 * v1 API `useCoAgentStateRender` has been replaced: in v2 you subscribe to
 * state updates via `useAgent({ updates: [OnStateChanged, OnRunStatusChanged] })`
 * and inject the rendered card through the `messageView.children` slot on
 * `<CopilotChat />`.
 */
export default function GenUiAgentDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="gen-ui-agent">
      <div className="flex justify-center items-center h-screen w-full">
        <div className="h-full w-full max-w-4xl">
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

// The agent's state shape is open-ended; we render whatever keys it emits.
type AgentState = Record<string, unknown> | undefined;

function Chat() {
  // Subscribe to state + run-status changes so the inline progress card
  // re-renders whenever the agent emits a state update or toggles isRunning.
  const { agent } = useAgent({
    agentId: "gen-ui-agent",
    updates: [UseAgentUpdate.OnStateChanged, UseAgentUpdate.OnRunStatusChanged],
  });

  useConfigureSuggestions({
    suggestions: [
      {
        title: "Run a 3-step task",
        message:
          "Run a 3-step task: fetch data, process it, then summarize the result.",
      },
      {
        title: "Plan a project",
        message: "Break this down into steps: planning a small web app launch.",
      },
    ],
    available: "always",
  });

  const agentState = agent.state as AgentState;
  const isRunning = agent.isRunning;

  const stateEntries = agentState
    ? Object.entries(agentState).filter(
        ([, v]) => v !== undefined && v !== null,
      )
    : [];

  return (
    <CopilotChat
      agentId="gen-ui-agent"
      className="h-full rounded-2xl"
      messageView={{
        children: ({ messageElements, interruptElement }) => (
          <div
            data-testid="copilot-message-list"
            className="flex flex-col gap-2"
          >
            {messageElements}
            {(isRunning || stateEntries.length > 0) && (
              <InlineAgentStateCard
                isRunning={isRunning}
                stateEntries={stateEntries}
              />
            )}
            {interruptElement}
          </div>
        ),
      }}
    />
  );
}

function InlineAgentStateCard({
  isRunning,
  stateEntries,
}: {
  isRunning: boolean;
  stateEntries: [string, unknown][];
}) {
  return (
    <div
      data-testid="agent-state-card"
      className="my-3 mx-4 rounded-xl border border-gray-200 bg-gradient-to-br from-blue-50 via-white to-purple-50 p-4 shadow-sm"
    >
      <div className="flex items-center gap-2">
        {isRunning ? <SpinnerIcon /> : <CheckIcon />}
        <span className="text-sm font-semibold text-gray-800">
          {isRunning ? "Agent working…" : "Agent idle"}
        </span>
      </div>

      {stateEntries.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {stateEntries.map(([key, value]) => (
            <div
              key={key}
              data-testid="agent-state-entry"
              className="flex items-start gap-2 text-xs"
            >
              <span className="font-medium text-gray-600">{key}:</span>
              <span className="font-mono text-gray-800 break-all">
                {formatValue(value)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    const json = JSON.stringify(value);
    return json.length > 120 ? json.slice(0, 117) + "…" : json;
  } catch {
    return String(value);
  }
}

function SpinnerIcon() {
  return (
    <svg
      className="w-4 h-4 animate-spin text-blue-600"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      className="w-4 h-4 text-green-600"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={3}
        d="M5 13l4 4L19 7"
      />
    </svg>
  );
}
