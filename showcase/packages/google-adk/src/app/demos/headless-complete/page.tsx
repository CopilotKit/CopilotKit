"use client";

import React, { useState } from "react";
import {
  CopilotKit,
  useAgent,
  useCopilotKit,
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
            <p className="text-sm text-slate-500 mt-1">
              Custom chat surface built from scratch on useAgent — full input
              control, message rendering, and run lifecycle.
            </p>
          </header>
          <HeadlessChat />
        </div>
      </div>
    </CopilotKit>
  );
}

function HeadlessChat() {
  const { agent } = useAgent({ agentId: "headless_complete" });
  const { copilotkit } = useCopilotKit();
  const [input, setInput] = useState("");

  const send = () => {
    const text = input.trim();
    if (!text || agent.isRunning) return;
    agent.addMessage({ id: crypto.randomUUID(), role: "user", content: text });
    void copilotkit.runAgent({ agent }).catch(() => {});
    setInput("");
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <MessageList
        messages={agent.messages as any}
        isRunning={agent.isRunning}
      />
      <div className="border-t border-slate-200 bg-slate-50 px-3 py-2 flex gap-2">
        <textarea
          className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Type a message — Enter to send, Shift+Enter for newline."
        />
        <button
          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm disabled:opacity-50"
          onClick={send}
          disabled={agent.isRunning || !input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
