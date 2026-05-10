"use client";

import React, { useMemo, useState } from "react";
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

/**
 * Deduplicate assistant messages produced by the Spring AI AG-UI adapter's
 * multi-run tool-call loop.
 *
 * Root cause: the AG-UI Spring AI adapter's ToolMapper returns an empty
 * string for frontend tool results (show_card, book_call, etc.) because
 * actual execution happens on the CopilotKit frontend. When aimock fixtures
 * exhaust and proxy-mode forwards to the real LLM, the model may keep
 * calling the same frontend tool (it only sees the empty result and tries
 * again). Each CopilotKit follow-up run creates a new assistant message,
 * leading to unbounded DOM growth that prevents the D5 probe's
 * conversation-runner from settling.
 *
 * Fix: keep only the FIRST assistant message per unique tool-call name,
 * and only the FIRST text-only assistant narration. This stabilises the
 * DOM at ~2-3 elements (one tool-call ShowCard + one narration) regardless
 * of how many re-invocations the backend loop produces.
 */
function deduplicateMessages(
  messages: Array<{
    id: string;
    role: string;
    content?: unknown;
    toolCalls?: Array<{ id: string; function: { name: string } }>;
  }>,
) {
  const seenToolNames = new Set<string>();
  let seenNarration = false;
  return messages.filter((m) => {
    if (m.role !== "assistant") return true;
    const toolCalls =
      "toolCalls" in m && Array.isArray(m.toolCalls) ? m.toolCalls : [];
    const hasText =
      m.content && typeof m.content === "string" && m.content.trim();

    // Messages with both text content and tool calls: keep if tool names
    // are new, otherwise skip the whole message (the text would be a
    // duplicate narration from a loop iteration).
    if (hasText && toolCalls.length > 0) {
      const allSeen = toolCalls.every((tc) =>
        seenToolNames.has(tc.function.name),
      );
      if (allSeen) return false;
      for (const tc of toolCalls) seenToolNames.add(tc.function.name);
      seenNarration = true;
      return true;
    }

    // Text-only assistant messages (narration): keep the first one only.
    if (hasText && toolCalls.length === 0) {
      if (seenNarration) return false;
      seenNarration = true;
      return true;
    }

    // Tool-call-only messages: keep the first occurrence of each tool name.
    if (toolCalls.length > 0) {
      const allSeen = toolCalls.every((tc) =>
        seenToolNames.has(tc.function.name),
      );
      if (allSeen) return false;
      for (const tc of toolCalls) seenToolNames.add(tc.function.name);
      return true;
    }

    // Assistant message with no text and no tool calls (in-flight
    // streaming placeholder). Skip it — once content or tool calls land
    // the message will pass through one of the branches above. Rendering
    // empty wrappers only adds DOM noise that confuses readMessageCount.
    return false;
  });
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

  // Deduplicate to prevent the unbounded message growth caused by the
  // Spring AI AG-UI adapter's multi-run tool-call loop.
  const visibleMessages = useMemo(
    () => deduplicateMessages(agent.messages as any),
    [agent.messages],
  );

  const send = (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || agent.isRunning) return;
    agent.addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    });
    // Use copilotkit.runAgent so frontend tools registered via useComponent are
    // forwarded to the agent. Calling agent.runAgent() directly would bypass
    // tool registration and the agent would never see `show_card`.
    void copilotkit.runAgent({ agent }).catch(() => {});
    setInput("");
  };

  const suggestions = [
    {
      title: "Profile card",
      message: "Show me a profile card for Ada Lovelace",
    },
    {
      title: "Largest continent",
      message: "What is the largest continent?",
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xl font-semibold">Headless Chat (Simple)</h1>
      <div className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 min-h-[300px]">
        {/* @region[message-list-simple] */}
        {visibleMessages.length === 0 && (
          <div className="text-sm text-gray-400">No messages yet. Say hi!</div>
        )}
        {visibleMessages.map((m) => {
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
      <div data-testid="headless-suggestions" className="flex flex-wrap gap-2">
        {suggestions.map((s) => (
          <button
            key={s.title}
            type="button"
            onClick={() => send(s.message)}
            disabled={agent.isRunning}
            className="rounded-full border border-gray-300 bg-white px-3 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {s.title}
          </button>
        ))}
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
          onClick={() => send()}
          disabled={agent.isRunning || !input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
