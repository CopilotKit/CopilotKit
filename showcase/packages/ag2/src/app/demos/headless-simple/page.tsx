"use client";

import React, { useState } from "react";
import {
  CopilotKit,
  useAgent,
  useComponent,
  useCopilotKit,
  useRenderToolCall,
} from "@copilotkit/react-core/v2";
import { z } from "zod";

export default function HeadlessSimpleDemo() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="headless-simple">
      <div className="flex justify-center items-start min-h-screen w-full p-6 bg-gray-50">
        <div className="w-full max-w-4xl">
          <HeadlessChat />
        </div>
      </div>
    </CopilotKit>
  );
}

function ShowCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="my-2 rounded-lg border border-gray-300 bg-white p-4 shadow-sm">
      <div className="font-semibold text-gray-900">{title}</div>
      <div className="mt-1 text-sm text-gray-700 whitespace-pre-wrap">
        {body}
      </div>
    </div>
  );
}

function HeadlessChat() {
  // @region[use-agent-simple]
  // @region[headless-hooks]
  const { agent } = useAgent({ agentId: "headless-simple" });
  const { copilotkit } = useCopilotKit();
  const [input, setInput] = useState("");

  useComponent({
    name: "show_card",
    description: "Display a titled card with a short body of text.",
    parameters: z.object({
      title: z.string().describe("Short heading for the card."),
      body: z.string().describe("Body text for the card."),
    }),
    render: ShowCard,
  });

  const renderToolCall = useRenderToolCall();
  // @endregion[headless-hooks]
  // @endregion[use-agent-simple]

  const send = () => {
    const text = input.trim();
    if (!text || agent.isRunning) return;
    agent.addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    });
    void copilotkit.runAgent({ agent }).catch(() => {});
    setInput("");
  };

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xl font-semibold">Headless Chat (Simple)</h1>
      <div className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 min-h-[300px]">
        {/* @region[message-list-simple] */}
        {agent.messages.length === 0 && (
          <div className="text-sm text-gray-400">No messages yet. Say hi!</div>
        )}
        {agent.messages.map((m) => {
          if (m.role === "user") {
            return (
              <div
                key={m.id}
                data-message-role="user"
                className="self-end rounded-lg bg-blue-600 px-3 py-2 text-white max-w-[80%]"
              >
                {typeof m.content === "string" ? m.content : ""}
              </div>
            );
          }
          if (m.role === "assistant") {
            const toolCalls =
              "toolCalls" in m && Array.isArray(m.toolCalls) ? m.toolCalls : [];
            return (
              <div
                key={m.id}
                data-message-role="assistant"
                className="self-start max-w-[90%]"
              >
                {m.content && (
                  <div className="rounded-lg bg-gray-100 px-3 py-2 text-gray-900">
                    {m.content as React.ReactNode}
                  </div>
                )}
                {toolCalls.map((tc: any) => (
                  <div key={tc.id}>{renderToolCall({ toolCall: tc })}</div>
                ))}
              </div>
            );
          }
          return null;
        })}
        {agent.isRunning && (
          <div className="text-xs text-gray-400">Agent is thinking...</div>
        )}
        {/* @endregion[message-list-simple] */}
      </div>
      <div className="flex gap-2">
        <textarea
          className="flex-1 rounded-lg border border-gray-300 p-2 text-sm"
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Type a message. Ask me to 'show a card about cats'."
        />
        <button
          className="rounded-lg bg-blue-600 px-4 py-2 text-white text-sm font-medium disabled:opacity-50"
          onClick={send}
          disabled={agent.isRunning || !input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
