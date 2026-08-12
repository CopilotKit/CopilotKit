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

/**
 * Report an app-side event TO the copilot so it acknowledges on screen — used
 * when the user performs an action in the app UI (e.g. changing a card PIN in
 * the app's own dialog, not via the chat) and we want the agent to confirm it
 * saw the change, closing the loop.
 *
 * This appends a ready-made ASSISTANT message to the CURRENT thread (no LLM
 * run). We do it deterministically rather than prompting the model because the
 * PIN pill navigates first, and kicking off a fresh run right after a route
 * change races the thread sync (the reply can land in / a new thread while the
 * pane still shows another). A direct assistant bubble is instant, always says
 * the right thing, and stays in the thread the user is looking at.
 */
export function useReportToCopilot() {
  const { agent } = useAgent({ agentId: "default" });
  const configuration = useCopilotChatConfiguration();
  const setModalOpen = configuration?.setModalOpen;

  return useCallback(
    (confirmation: string) => {
      setModalOpen?.(true);
      agent.addMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: confirmation,
      });
    },
    [agent, setModalOpen],
  );
}

export default useAskCopilot;
