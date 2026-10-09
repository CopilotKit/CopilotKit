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
 * exactly as if the planner had typed it. Used by Meridian's in-app "ask the
 * copilot" surfaces (e.g. the sidebar Help control).
 *
 * Ported (not imported) from banking's equivalent: a skin's only inbound
 * dependency is the shell's `Skin` contract, so `src/skins/logistics/**` must
 * never reach into `src/skins/banking/**`.
 */
export function useAskCopilot() {
  // No explicit agentId: inherit the surrounding CopilotChatConfiguration's
  // agentId (the active skin's id, "logistics"), so this drives the SAME
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
