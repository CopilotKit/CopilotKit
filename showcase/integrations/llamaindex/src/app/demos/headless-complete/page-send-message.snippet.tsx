// Docs-only snippet — not imported or rendered. The dashboard demo at
// `page.tsx` for this framework uses its own custom-bubble composition
// pattern; the canonical `/headless` doc teaches the minimal page-level
// send-message wiring shown here. So the docs render real teaching code
// rather than a missing-snippet box.
//
// Mirrors the convention from `tool-rendering/render-flight-tool.snippet.tsx`.

// @region[page-send-message]
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAgent, useCopilotKit } from "@copilotkit/react-core/v2";
import type { Message } from "@ag-ui/core";

const AGENT_ID = "headless-complete";

export function HeadlessSendMessageWiring() {
  const threadId = useMemo(() => crypto.randomUUID(), []);
  const { agent } = useAgent({ agentId: AGENT_ID, threadId });
  const { copilotkit } = useCopilotKit();

  useEffect(() => {
    const ac = new AbortController();
    if ("abortController" in agent) {
      (
        agent as unknown as { abortController: AbortController }
      ).abortController = ac;
    }
    copilotkit.connectAgent({ agent }).catch(() => {
      // connectAgent emits via the subscriber system; swallow here.
    });
    return () => {
      ac.abort();
      void agent.detachActiveRun().catch(() => {});
    };
  }, [agent, copilotkit]);

  const [input, setInput] = useState("");
  const messages = agent.messages as Message[];
  const isRunning = agent.isRunning;

  const handleSubmit = useCallback(async () => {
    const text = input.trim();
    if (!text || isRunning) return;
    setInput("");
    agent.addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    });
    try {
      await copilotkit.runAgent({ agent });
    } catch (err) {
      console.error("headless-complete: runAgent failed", err);
    }
  }, [agent, copilotkit, input, isRunning]);

  const handleStop = useCallback(() => {
    try {
      copilotkit.stopAgent({ agent });
    } catch (err) {
      console.error("headless-complete: stopAgent failed", err);
    }
  }, [agent, copilotkit]);
  // @endregion[page-send-message]

  // Returned for completeness so the snippet compiles in isolation.
  return { handleSubmit, handleStop, messages, isRunning, input, setInput };
}
