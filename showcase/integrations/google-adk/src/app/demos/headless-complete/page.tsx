"use client";

import React, { useCallback, useState } from "react";
import {
  CopilotKit,
  useAgent,
  useCopilotKit,
  useDefaultRenderTool,
} from "@copilotkit/react-core/v2";

import { MessageList } from "./message-list";

export default function HeadlessCompleteDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="headless_complete">
      <div className="flex justify-center items-start min-h-screen w-full p-6 bg-slate-50">
        <div className="w-full max-w-4xl space-y-4">
          <header>
            <h1 className="text-xl font-semibold text-slate-900">
              Headless Chat (Complete)
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Built from scratch on useAgent — no CopilotChat.
            </p>
          </header>
          <HeadlessChat />
        </div>
      </div>
    </CopilotKit>
  );
}

function HeadlessChat() {
  // @region[page-send-message]
  const { agent } = useAgent({ agentId: "headless_complete" });
  const { copilotkit } = useCopilotKit();
  useDefaultRenderTool();
  const [input, setInput] = useState("");

  const isRunning = agent.isRunning;

  const handleSubmit = useCallback(
    (override?: string) => {
      const text = (override ?? input).trim();
      if (!text || isRunning) return;
      agent.addMessage({
        id: crypto.randomUUID(),
        role: "user",
        content: text,
      });
      void copilotkit.runAgent({ agent }).catch((err) => {
        console.error("[headless-complete] runAgent failed:", err);
      });
      setInput("");
    },
    [agent, copilotkit, input, isRunning],
  );
  // @endregion[page-send-message]

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
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <MessageList messages={agent.messages as any} isRunning={isRunning} />
      <div
        data-testid="headless-suggestions"
        className="flex flex-wrap gap-2 px-3 py-2 border-t border-slate-200 bg-slate-50"
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
      <div className="border-t border-slate-200 bg-slate-50 px-3 py-2 flex gap-2">
        <textarea
          className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
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
        <button
          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50"
          onClick={() => handleSubmit()}
          disabled={isRunning || !input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
