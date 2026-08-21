"use client";

import { useRef, useEffect, useCallback } from "react";
import { useAgent } from "@copilotkit/react-core/v2";
import type { CloudPlotAgentState } from "@/types";

const initialState: CloudPlotAgentState = {
  nodes: [],
  edges: [],
  logs: [],
  cost: 0,
  status: "idle",
  validation_errors: [],
};

export function useCloudPlotAgent() {
  const { agent } = useAgent({ agentId: "cloudplot_agent" });
  const state = (agent.state as CloudPlotAgentState | null) ?? initialState;

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

  const appendMessage = useCallback(
    (content: string) => {
      agent.addMessage({
        id: crypto.randomUUID(),
        role: "user" as const,
        content,
      });
      agent.runAgent();
    },
    [agent],
  );

  return {
    agent,
    state,
    appendMessage,
  };
}
