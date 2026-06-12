"use client";

// @region[use-agent-simple]
import React, { useState } from "react";
import {
  CopilotKitProvider,
  useAgent,
  useComponent,
  useCopilotKit,
  useRenderToolCall,
} from "@copilotkit/react-core/v2";
import { z } from "zod";

export default function HeadlessSimpleDemo() {
  return (
    <CopilotKitProvider runtimeUrl="/api/copilotkit" useSingleEndpoint>
      <div className="flex justify-center items-start min-h-screen w-full p-6 bg-gray-50">
        <div className="w-full max-w-4xl">
          <HeadlessChat />
        </div>
      </div>
    </CopilotKitProvider>
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

/**
 * Browser-friendly UUID. `crypto.randomUUID` only exists in secure
 * contexts — the local harness drives this page over plain http
 * (http://built-in-agent:10000), where it is undefined and the page throws
 * before the message ever sends. Fall back to a math-based UUIDv4
 * (same pattern as the spring-ai headless-simple demo's generateMessageId).
 */
function generateMessageId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function HeadlessChat() {
  // @region[headless-hooks]
  const { agent } = useAgent({ agentId: "default" });
  const { copilotkit } = useCopilotKit();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

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

  const send = (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || agent.isRunning) return;
    setError(null);
    agent.addMessage({
      id: generateMessageId(),
      role: "user",
      content: text,
    });
    // Use copilotkit.runAgent so frontend tools registered via useComponent are
    // forwarded to the agent. Calling agent.runAgent() directly would bypass
    // tool registration and the agent would never see `show_card`.
    void copilotkit.runAgent({ agent }).catch((err) => {
      // Don't swallow run failures: log so a network failure / runtime
      // error / transport disconnect surfaces in the console — and
      // render an inline banner so the end user isn't staring at a
      // frozen UI.
      console.error("[built-in-agent:headless-simple] runAgent failed", err);
      setError(err instanceof Error ? err.message : String(err));
    });
    setInput("");
  };

  // The literal pill labels ARE the contract: the d5 probe
  // (showcase/harness/src/probes/scripts/d5-headless-simple.ts) clicks the
  // first one by exact text, and the aimock d6 fixtures
  // (showcase/aimock/d6/built-in-agent/headless-simple.json) match on these
  // prompts. Change one and the other has to match or the probe goes red.
  const suggestions = [
    "Say hello in one short sentence.",
    "Tell me a one-line joke.",
    "Give me a fun fact.",
  ];

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
                data-testid="headless-message-user"
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
                data-testid="headless-message-assistant"
                data-message-role="assistant"
                className="self-start max-w-[90%]"
              >
                {m.content && (
                  <div className="rounded-lg bg-gray-100 px-3 py-2 text-gray-900">
                    {m.content}
                  </div>
                )}
                {toolCalls.map((tc) => (
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
      <div data-testid="headless-suggestions" className="flex flex-wrap gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => send(s)}
            disabled={agent.isRunning}
            className="rounded-full border border-gray-300 bg-white px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>
      {error && (
        <div
          data-testid="headless-simple-error"
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          {error}
        </div>
      )}
      <div data-testid="headless-composer" className="flex gap-2">
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
          onClick={() => send()}
          disabled={agent.isRunning || !input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
