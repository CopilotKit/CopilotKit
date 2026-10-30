// Reference implementation copied from the a2ui-playground build (working, measured).
// Paths like @/a2ui/... are app-specific: adapt imports to your project.
"use client";

import { useCallback } from "react";
import { useAgent, useCopilotKit } from "@copilotkit/react-core/v2";
import { runStore } from "@/lib/run-store";
import { useMode } from "./providers";

/**
 * Send a prompt through the same agent the chat uses. Surface clicks need no
 * helper: Gen UI 2.0 forwards an `event` binding to the agent itself, as a
 * user message plus the A2UI 1.0 action in the generative UI envelope.
 */
export function useSend() {
  const { agent } = useAgent({ agentId: "default" });
  const { copilotkit } = useCopilotKit();
  const { mode } = useMode();

  const send = useCallback(
    async (text: string) => {
      if (!agent || agent.isRunning) return;
      runStore.startRun(text, mode);
      agent.addMessage({
        id: crypto.randomUUID(),
        role: "user",
        content: text,
      });
      await copilotkit.runAgent({ agent, forwardedProps: { mode } });
    },
    [agent, copilotkit, mode],
  );

  return { send, running: !!agent?.isRunning };
}
