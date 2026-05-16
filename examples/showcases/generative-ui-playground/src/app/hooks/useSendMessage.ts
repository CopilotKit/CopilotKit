"use client";

/**
 * useSendMessage - Hook for sending messages to the CopilotKit chat
 *
 * Provides a simple interface to programmatically send messages to the agent.
 * Used by PromptPill and protocol card pills to trigger chat interactions.
 */

import { useCallback } from "react";
import {
  useAgent,
  useCopilotKit,
  useCopilotChatConfiguration,
} from "@copilotkit/react-core/v2";
import { randomUUID, DEFAULT_AGENT_ID } from "@copilotkit/shared";

export function useSendMessage() {
  const { agent } = useAgent({ agentId: DEFAULT_AGENT_ID });
  const { copilotkit } = useCopilotKit();
  const config = useCopilotChatConfiguration();

  const sendMessage = useCallback(
    async (message: string) => {
      // Open the chat popup when sending a message
      config?.setModalOpen(true);
      
      try {
        // Atomic run: adds the message and starts the agent in one operation
        await copilotkit.runAgent({ 
          agentId: agent.id,
          input: message 
        });
      } catch (error) {
        console.error("Failed to run agent:", error);
      }
    },
    [agent.id, copilotkit, config],
  );

  return { sendMessage };
}
