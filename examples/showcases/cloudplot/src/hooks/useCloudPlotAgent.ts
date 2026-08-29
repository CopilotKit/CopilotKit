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
  const { agent, isReady } = useAgent({ agentId: "cloudplot_agent" });
  const state = (agent.state as CloudPlotAgentState | null) ?? initialState;

  const initializedAgentRef = useRef<typeof agent | null>(null);
  useEffect(() => {
    if (!isReady || initializedAgentRef.current === agent) return;

    const currentState = agent.state as CloudPlotAgentState | null;
    if (!currentState || Object.keys(currentState).length === 0) {
      agent.setState(structuredClone(initialState));
    }
    initializedAgentRef.current = agent;
  }, [agent, isReady]);

  const appendMessage = useCallback(
    async (content: string) => {
      if (!isReady) {
        throw new Error("CloudPlot agent is not ready");
      }
      agent.addMessage({
        id: crypto.randomUUID(),
        role: "user" as const,
        content,
      });
      await agent.runAgent();
    },
    [agent, isReady],
  );

  return {
    agent,
    state,
    isReady,
    appendMessage,
  };
}
