"use client";

import { useCallback } from "react";
import {
  UseAgentUpdate,
  useAgent,
  useCopilotKit,
} from "@copilotkit/react-core/v2";
import { AGENT_ID } from "@/agent";

/**
 * Sends a prompt as if the user had typed it: a visible user message, then a
 * run. This is what a click on a canvas button does too. While the agent is
 * running a prompt is dropped, so a double click does not start a second run.
 */
export function useSendPrompt() {
  const { agent } = useAgent({
    agentId: AGENT_ID,
    updates: [UseAgentUpdate.OnRunStatusChanged],
  });
  const { copilotkit } = useCopilotKit();
  const send = useCallback(
    async (text: string) => {
      if (agent.isRunning) return false;
      agent.addMessage({
        id: crypto.randomUUID(),
        role: "user",
        content: text,
      });
      await copilotkit.runAgent({ agent });
      return true;
    },
    [agent, copilotkit],
  );
  return { send, running: agent.isRunning };
}
