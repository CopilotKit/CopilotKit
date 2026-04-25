"use client";

/**
 * Headless Chat (Complete) — TRULY headless.
 *
 * A full chat implementation built from scratch on `useAgent`, without using
 * `<CopilotChat />` AND without `<CopilotChatMessageView>` or
 * `<CopilotChatAssistantMessage>`. Demonstrates:
 *   - scrollable messages area with auto-scroll to bottom on new messages
 *   - distinct user vs assistant bubbles (pure chrome — no chat primitives)
 *   - text input + send button, disabled while running
 *   - stop button to cancel a running agent turn
 *   - the FULL generative UI composition — text, reasoning cards, tool-call
 *     renderings (`useRenderTool` / `useDefaultRenderTool` / `useComponent` /
 *     `useFrontendTool`), A2UI activity messages, MCP Apps activity messages,
 *     and custom-message renderers — re-composed by hand from the low-level
 *     hooks (`useRenderToolCall`, `useRenderActivityMessage`,
 *     `useRenderCustomMessages`) inside `use-rendered-messages.tsx`.
 *
 * This file is orchestration only — the provider, the agent wiring, and the
 * top-level send/stop handlers. Presentational pieces (message list, bubbles,
 * typing indicator, input bar) live in sibling files.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CopilotKit,
  CopilotChatConfigurationProvider,
  useAgent,
  useCopilotKit,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import type { Message } from "@ag-ui/core";
import { MessageList } from "./message-list";
import { InputBar } from "./input-bar";
import { useHeadlessCompleteToolRenderers } from "./tool-renderers";

const AGENT_ID = "headless-complete";

// Outer wrapper — provides the CopilotKit runtime + page layout.
// In the Strands package this cell uses the main /api/copilotkit runtime
// (not mcp-apps, which is skipped — see PARITY_NOTES.md). The remaining
// rendering paths (tools, reasoning, A2UI activity messages, custom
// messages) all work fine against the shared Strands agent.
export default function HeadlessCompleteDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent={AGENT_ID}>
      <div className="flex justify-center items-center h-screen w-full bg-gray-50">
        <div className="h-full w-full max-w-3xl flex flex-col bg-white shadow-sm">
          <header className="px-4 py-3 border-b border-gray-200">
            <h1 className="text-base font-semibold">
              Headless Chat (Complete)
            </h1>
            <p className="text-xs text-gray-500">
              Built from scratch on useAgent — no CopilotChat.
            </p>
          </header>
          <Chat />
        </div>
      </div>
    </CopilotKit>
  );
}

// Inner view — the actual chat. Reads messages + isRunning straight off the
// agent, wires up the connect/run/stop lifecycle, and hands the pure
// presentational pieces their props.
function Chat() {
  // @region[page-send-message]
  const threadId = useMemo(() => crypto.randomUUID(), []);
  const { agent } = useAgent({ agentId: AGENT_ID, threadId });
  const { copilotkit } = useCopilotKit();

  // Connect the agent on mount so the backend session is live before the first
  // send. Mirrors the internal connect effect used by CopilotChat (abort on
  // unmount to play nice with React StrictMode).
  useEffect(() => {
    const ac = new AbortController();
    // HttpAgent honors abortController.signal; assign before connect.
    if ("abortController" in agent) {
      (
        agent as unknown as { abortController: AbortController }
      ).abortController = ac;
    }
    copilotkit.connectAgent({ agent }).catch(() => {
      // connectAgent emits via the subscriber system; swallow here to avoid
      // unhandled-rejection noise on unmount.
    });
    return () => {
      ac.abort();
      void agent.detachActiveRun().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, threadId]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, input, isRunning]);

  const handleStop = useCallback(() => {
    try {
      copilotkit.stopAgent({ agent });
    } catch (err) {
      console.error("headless-complete: stopAgent failed", err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent]);
  // @endregion[page-send-message]

  // Wrap the chat body in a CopilotChatConfigurationProvider so that the
  // rendering primitives used inside `useRenderedMessages`
  // (useRenderToolCall, useRenderActivityMessage, useRenderCustomMessages)
  // see a matching (agentId, threadId) pair — without it, activity-message
  // renderers wouldn't scope to this agent and custom message renderers
  // would early-return null. This provider is independent of the
  // <CopilotChat /> component; using it here keeps the surface fully
  // headless while still unlocking the full generative-UI composition.
  return (
    <CopilotChatConfigurationProvider agentId={AGENT_ID} threadId={threadId}>
      <ChatBody
        messages={messages}
        isRunning={isRunning}
        input={input}
        setInput={setInput}
        handleSubmit={handleSubmit}
        handleStop={handleStop}
      />
    </CopilotChatConfigurationProvider>
  );
}

// Nested body — rendered INSIDE CopilotChatConfigurationProvider so the
// suggestions hook picks up the correct (agentId, threadId) scope and
// the frontend-registered `useComponent` tool registers against this
// agent. Tool-call renderers are registered here too; keeping them
// co-located with the component that reads them through
// `useRenderToolCall` (inside MessageList -> useRenderedMessages) makes
// the composition story of the headless cell easy to trace.
function ChatBody({
  messages,
  isRunning,
  input,
  setInput,
  handleSubmit,
  handleStop,
}: {
  messages: Message[];
  isRunning: boolean;
  input: string;
  setInput: (next: string) => void;
  handleSubmit: () => void;
  handleStop: () => void;
}) {
  useHeadlessCompleteToolRenderers();

  useConfigureSuggestions({
    suggestions: [
      {
        title: "Weather in Tokyo",
        message: "What's the weather in Tokyo?",
      },
      {
        title: "AAPL stock price",
        message: "What's AAPL trading at right now?",
      },
      {
        title: "Highlight a note",
        message: "Highlight 'meeting at 3pm' in yellow.",
      },
      {
        title: "Sketch a diagram",
        message: "Use Excalidraw to sketch a simple system diagram.",
      },
    ],
    available: "always",
  });

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <MessageList messages={messages} isRunning={isRunning} />
      <InputBar
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        onStop={handleStop}
        isRunning={isRunning}
        canStop={isRunning && messages.length > 0}
      />
    </div>
  );
}
