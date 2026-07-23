"use client";

import { useCallback } from "react";
import {
  useAgent,
  useCopilotChatConfiguration,
  useCopilotKit,
} from "@copilotkit/react-core/v2";

/**
 * Send a message to the copilot on the user's behalf: opens the docked panel,
 * appends the message, and starts a run — the same addMessage + runAgent path
 * a suggestion-pill click takes inside CopilotChat, so the conversation reads
 * exactly as if the user had typed it. Used by every in-app "ask the copilot"
 * surface (proactive notice, chart pills, report actions).
 */
export function useAskCopilot() {
  const { agent } = useAgent({ agentId: "default" });
  const { copilotkit } = useCopilotKit();
  const configuration = useCopilotChatConfiguration();
  const setModalOpen = configuration?.setModalOpen;

  return useCallback(
    async (message: string) => {
      setModalOpen?.(true);
      agent.addMessage({
        id: crypto.randomUUID(),
        role: "user",
        content: message,
      });
      try {
        await copilotkit.runAgent({ agent });
      } catch (error) {
        console.error("askCopilot: runAgent failed", error);
      }
    },
    [agent, copilotkit, setModalOpen],
  );
}

export default useAskCopilot;
