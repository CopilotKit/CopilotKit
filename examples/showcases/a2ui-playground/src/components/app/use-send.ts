"use client";

import { useCallback } from "react";
import { useAgent, useCopilotKit } from "@copilotkit/react-core/v2";
import { runStore } from "@/lib/run-store";
import { useMode, type Mode } from "./providers";

/**
 * Send a prompt through the same agent the chat uses. Surface clicks need no
 * helper: Gen UI 2.0 forwards an `event` binding to the agent itself, as a
 * user message plus the A2UI 1.0 action in the generative UI envelope.
 *
 * `mode` overrides the mode bar for this one prompt (macro suggestions always
 * compose). A failed run never throws: the agent tap marks it, and the chat
 * shows it with a Retry button.
 */
export function useSend() {
  const { agent } = useAgent({ agentId: "default" });
  const { copilotkit } = useCopilotKit();
  const { mode: current, model, format } = useMode();

  const send = useCallback(
    async (text: string, options: { mode?: Mode } = {}) => {
      // The runtime's agent, not a provisional one from before it connected: messages added to that one vanish.
      const live = copilotkit.getAgent("default") ?? agent;
      if (!live || live.isRunning) return;
      const mode = options.mode ?? current;
      const messageId = crypto.randomUUID();
      runStore.startRun(text, mode, { model, format, messageId });
      live.addMessage({ id: messageId, role: "user", content: text });
      await copilotkit.runAgent({
        agent: live,
        forwardedProps: { mode, model, format },
      });
    },
    [agent, copilotkit, current, model, format],
  );

  return { send, running: !!agent?.isRunning };
}
