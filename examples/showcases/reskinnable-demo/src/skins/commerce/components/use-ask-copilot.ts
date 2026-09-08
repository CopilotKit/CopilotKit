"use client";

import { useCallback } from "react";
import {
  useAgent,
  useCopilotChatConfiguration,
  useCopilotKit,
} from "@copilotkit/react-core/v2";

/**
 * Send a message to Bellwether on the user's behalf: open the docked panel,
 * append the message, and start a run — the same addMessage + runAgent path a
 * suggestion pill takes, so the conversation reads exactly as if the merchandiser
 * had typed it. Used by the sidebar Help control.
 *
 * PORTED, not imported. A skin's only inbound dependency is the shell's `Skin`
 * contract, so `src/skins/commerce/**` must never reach into another skin's
 * folder — even for a hook this small.
 */
export function useAskCopilot() {
  // No explicit agentId: inherit the surrounding CopilotChatConfiguration's
  // agentId (the active skin's id, "commerce"), so this drives the SAME
  // agent/thread the docked chat panel uses.
  const { agent } = useAgent();
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
