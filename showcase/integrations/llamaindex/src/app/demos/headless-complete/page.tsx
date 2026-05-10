"use client";

/**
 * Headless Chat (Complete) — LlamaIndex variant.
 *
 * Full chat implementation built from scratch on `useAgent`, without using
 * `<CopilotChat />`. Demonstrates manual lifecycle (connect/run/stop),
 * a hand-rolled message list, and tool-call rendering via `useRenderToolCall`.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CopilotKit,
  CopilotChatConfigurationProvider,
  useAgent,
  useCopilotKit,
} from "@copilotkit/react-core/v2";
import type { Message } from "@ag-ui/core";
import { MessageList } from "./message-list";

const AGENT_ID = "headless_complete";

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

function Chat() {
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
    copilotkit.connectAgent({ agent }).catch(() => {});
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
        className="flex flex-wrap gap-2 px-4 py-2 border-t border-gray-200 bg-white"
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
      <div className="border-t border-gray-200 p-3 flex gap-2">
        <textarea
          className="flex-1 rounded-lg border border-gray-300 p-2 text-sm"
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder={isRunning ? "Agent is working..." : "Type a message..."}
          disabled={isRunning}
        />
        {isRunning ? (
          <button
            className="rounded-lg bg-red-600 px-4 py-2 text-white text-sm font-medium"
            onClick={handleStop}
          >
            Stop
          </button>
        ) : (
          <button
            className="rounded-lg bg-blue-600 px-4 py-2 text-white text-sm font-medium disabled:opacity-50"
            onClick={() => handleSubmit()}
            disabled={!input.trim()}
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}
