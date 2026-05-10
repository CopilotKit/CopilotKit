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
 *     `useFrontendTool`), A2UI activity messages, and custom-message
 *     renderers — re-composed by hand from the low-level hooks
 *     (`useRenderToolCall`, `useRenderActivityMessage`,
 *     `useRenderCustomMessages`) inside `use-rendered-messages.tsx`.
 *
 * This file is orchestration only — the provider, the agent wiring, and the
 * top-level send/stop handlers. Presentational pieces (message list, bubbles,
 * typing indicator, input bar) live in sibling files.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CopilotKitProvider,
  CopilotChatConfigurationProvider,
  useAgent,
  useCopilotKit,
} from "@copilotkit/react-core/v2";
import type { Message } from "@ag-ui/core";
import { MessageList } from "./message-list";
import { InputBar } from "./input-bar";
import { useHeadlessCompleteToolRenderers } from "./tool-renderers";

const AGENT_ID = "default";

// Outer wrapper — provides the CopilotKit runtime + page layout. Built-in-agent
// uses a single in-process /api/copilotkit endpoint with the `default` agent.
export default function HeadlessCompleteDemo() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" useSingleEndpoint>
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
    </CopilotKitProvider>
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

  const handleSubmit = useCallback(
    async (override?: string) => {
      const text = (override ?? input).trim();
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
    },
    [agent, input, isRunning],
  );

  const handleStop = useCallback(() => {
    try {
      copilotkit.stopAgent({ agent });
    } catch (err) {
      console.error("headless-complete: stopAgent failed", err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent]);
  // @endregion[page-send-message]

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
  handleSubmit: (override?: string) => void;
  handleStop: () => void;
}) {
  useHeadlessCompleteToolRenderers();

  const suggestions = [
    { title: "Weather in Tokyo", message: "What's the weather in Tokyo?" },
    { title: "AAPL stock price", message: "What's AAPL trading at right now?" },
    {
      title: "Highlight a note",
      message: "Highlight 'meeting at 3pm' in yellow.",
    },
    {
      title: "Sketch a diagram",
      message: "Use Excalidraw to sketch a simple system diagram.",
    },
    { title: "Largest continent", message: "What is the largest continent?" },
  ];

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <MessageList messages={messages} isRunning={isRunning} />
      <div
        data-testid="headless-suggestions"
        className="flex flex-wrap gap-2 px-4 py-2 border-t border-[#E9E9EF] bg-white"
      >
        {suggestions.map((s) => (
          <button
            key={s.title}
            type="button"
            onClick={() => handleSubmit(s.message)}
            disabled={isRunning}
            className="rounded-full border border-gray-300 bg-white px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {s.title}
          </button>
        ))}
      </div>
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
