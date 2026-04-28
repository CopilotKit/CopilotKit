// Docs-only snippet — not imported or rendered. The actual route is served
// by page.tsx, which carries a `deduplicateMessages` pass to defend against
// the Spring AI AG-UI adapter's multi-run tool-call loop (see the comment
// on that helper in page.tsx). That dedup logic is QA scaffolding, not part
// of the headless-chat teaching content. This file gives the docs a clean
// minimal surface to point at via `use-agent-simple` and
// `message-list-simple` regions without the dedup distraction.
//
// Why a sibling file: the bundler walks every file in the demo folder and
// extracts region markers from each, so a docs-targeted teaching example
// can live alongside the production demo without being wired into the
// route. See: showcase/scripts/bundle-demo-content.ts.

import React, { useState } from "react";
import {
  useAgent,
  useComponent,
  useCopilotKit,
  useRenderToolCall,
} from "@copilotkit/react-core/v2";
import { z } from "zod";

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

export function HeadlessChat() {
  // @region[use-agent-simple]
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
                {toolCalls.map((tc: { id: string }) => (
                  <div key={tc.id}>
                    {renderToolCall({ toolCall: tc as any })}
                  </div>
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
          placeholder="Type a message..."
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
