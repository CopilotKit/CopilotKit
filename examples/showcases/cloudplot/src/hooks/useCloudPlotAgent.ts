"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { useAgent } from "@copilotkit/react-core/v2";
import type { CloudPlotAgentState, ThoughtLogEntry } from "@/types";

const initialState: CloudPlotAgentState = {
  nodes: [],
  edges: [],
  logs: [],
  cost: 0,
  status: "idle",
  validation_errors: [],
};

export function useCloudPlotAgent() {
  // V2 useAgent - returns non-optional agent
  const { agent } = useAgent({ agentId: "cloudplot_agent" });

  // Track isRunning state for UI
  const [isRunning, setIsRunning] = useState(false);

  // Type-safe state access with fallback
  const state = (agent.state as CloudPlotAgentState | null) ?? initialState;

  // Wrapped setState
  const setState = useCallback(
    (newState: CloudPlotAgentState) => {
      agent.setState(newState);
    },
    [agent]
  );

  // Initialize state if empty on mount
  const hasInitialized = useRef(false);
  useEffect(() => {
    if (!hasInitialized.current) {
      const currentState = agent.state as CloudPlotAgentState | null;
      if (!currentState || Object.keys(currentState).length === 0) {
        agent.setState(initialState);
      }
      hasInitialized.current = true;
    }
  }, [agent]);

  // Subscribe to agent events
  useEffect(() => {
    const subscriber = {
      onRunStartedEvent: () => {
        setIsRunning(true);
      },
      onRunFinalized: () => {
        setIsRunning(false);
      },
      onToolCallEndEvent: ({
        toolCallName,
        toolCallArgs,
      }: {
        toolCallName: string;
        toolCallArgs: unknown;
      }) => {
        const entry: ThoughtLogEntry = {
          timestamp: Date.now(),
          node: toolCallName,
          message: `Executed ${toolCallName}`,
          type: "info",
          toolName: toolCallName,
          toolArgs: toolCallArgs as Record<string, unknown>,
        };
        const currentState = agent.state as CloudPlotAgentState | null;
        if (currentState) {
          const newLogs = [...(currentState.logs || []), entry].slice(-100);
          agent.setState({ ...currentState, logs: newLogs });
        }
      },
    };

    const { unsubscribe } = agent.subscribe(subscriber);
    return () => unsubscribe();
  }, [agent]);

  // Append a user message and trigger agent (for QuickStartPills)
  const appendMessage = useCallback(
    (content: string) => {
      agent.addMessage({
        id: crypto.randomUUID(),
        role: "user" as const,
        content,
      });
      // Trigger the agent to process the message
      agent.runAgent();
    },
    [agent]
  );

  return {
    agent,
    state,
    setState,
    appendMessage,
    isRunning,
  };
}
