/**
 * Scenario: User's approach — subscribe via onEvent checking deprecated THINKING event types
 *
 * Component tree:
 *   <CopilotKit runtimeUrl="..." agent="default">
 *     <ScenarioDeprecatedInner />           ← useAgent + subscribe with onEvent
 *       └─ chat input + message display + event log
 *
 * Expected result: FAILS to capture reasoning events.
 *
 * Why: CopilotKit's BuiltInAgent emits REASONING_* events (the current types).
 * The deprecated THINKING_TEXT_MESSAGE_* types are never emitted by BuiltInAgent.
 * Even if they were, the backward-compat middleware transforms them to REASONING_*
 * before they reach subscribers. So checking event.type === EventType.THINKING_TEXT_MESSAGE_START
 * in onEvent will never match.
 *
 * Additionally, the model matters: only o3, o3-mini, o4-mini produce reasoning events.
 * GPT-5-Nano is a regular chat model and does NOT emit reasoning.
 */

import { useState, useEffect, useRef } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import { useAgent } from "@copilotkit/react-core/v2";
import { EventType } from "@ag-ui/client";
import type { AgentSubscriber, Message } from "@ag-ui/client";
import { TAG } from "./lib";

function ScenarioDeprecatedInner() {
  const { agent } = useAgent({});
  const [input, setInput] = useState("");
  const [eventLog, setEventLog] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!agent) return;

    console.log(TAG, "[deprecated] Subscribing with onEvent + THINKING types");

    const subscriber: AgentSubscriber = {
      onEvent: ({ event }) => {
        const line = `${event.type}${
          "delta" in event ? ` delta=${JSON.stringify((event as any).delta).slice(0, 60)}` : ""
        }`;
        console.log(TAG, "[deprecated] onEvent:", line);
        setEventLog((prev) => [...prev.slice(-50), line]);

        // User's approach: check deprecated THINKING event types
        if (event.type === EventType.THINKING_TEXT_MESSAGE_START) {
          console.log(TAG, "[deprecated] GOT THINKING_TEXT_MESSAGE_START");
        }
        if (event.type === EventType.THINKING_TEXT_MESSAGE_CONTENT) {
          console.log(TAG, "[deprecated] GOT THINKING_TEXT_MESSAGE_CONTENT");
        }
        if (event.type === EventType.THINKING_TEXT_MESSAGE_END) {
          console.log(TAG, "[deprecated] GOT THINKING_TEXT_MESSAGE_END");
        }

        // Also check the current types for comparison
        if (event.type === EventType.REASONING_START) {
          console.log(TAG, "[deprecated] GOT REASONING_START (new type)");
        }
        if (event.type === EventType.REASONING_MESSAGE_START) {
          console.log(TAG, "[deprecated] GOT REASONING_MESSAGE_START (new type)");
        }
        if (event.type === EventType.REASONING_MESSAGE_CONTENT) {
          console.log(TAG, "[deprecated] GOT REASONING_MESSAGE_CONTENT (new type)");
        }
        if (event.type === EventType.REASONING_MESSAGE_END) {
          console.log(TAG, "[deprecated] GOT REASONING_MESSAGE_END (new type)");
        }
        if (event.type === EventType.REASONING_END) {
          console.log(TAG, "[deprecated] GOT REASONING_END (new type)");
        }
      },
    };

    const sub = agent.subscribe(subscriber);
    return () => sub.unsubscribe();
  }, [agent]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [agent?.messages?.length, eventLog.length]);

  const handleSend = async () => {
    if (!input.trim() || !agent || agent.isRunning) return;
    const content = input.trim();
    setInput("");
    setEventLog([]);

    console.log(TAG, "[deprecated] Sending message:", content);

    agent.addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content,
    });

    try {
      await agent.runAgent();
      console.log(TAG, "[deprecated] runAgent() completed");
    } catch (err) {
      console.error(TAG, "[deprecated] runAgent() error:", err);
    }
  };

  return (
    <div className="flex flex-col h-[500px]">
      <div className="p-3 bg-red-50 border-b border-red-200 text-xs text-red-700">
        <strong>User's approach:</strong> Checking <code>EventType.THINKING_TEXT_MESSAGE_*</code> in{" "}
        <code>onEvent</code>. These deprecated types are never emitted — use REASONING_* instead.
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Chat */}
        <div className="flex-1 flex flex-col border-r">
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {agent?.messages?.map((msg: Message) => (
              <div
                key={msg.id}
                className={`p-2 rounded text-sm ${
                  msg.role === "user"
                    ? "bg-blue-50 ml-6 text-blue-900"
                    : msg.role === "reasoning"
                      ? "bg-purple-50 mr-6 text-purple-900 italic"
                      : "bg-gray-50 mr-6 text-gray-900"
                }`}
              >
                <span className="text-xs font-semibold text-gray-400">{msg.role}</span>
                <div>{(msg as any).content || "[empty]"}</div>
              </div>
            ))}
            {agent?.isRunning && (
              <div className="text-sm text-gray-400 italic">Running...</div>
            )}
            <div ref={messagesEndRef} />
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex gap-2 p-3 border-t"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={agent?.isRunning}
              placeholder="Ask something..."
              className="flex-1 rounded border px-2 py-1 text-sm"
            />
            <button
              type="submit"
              disabled={!input.trim() || agent?.isRunning}
              className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </div>

        {/* Event log */}
        <div className="w-80 flex flex-col">
          <div className="p-2 bg-gray-100 text-xs font-semibold border-b">
            Raw events (onEvent)
          </div>
          <div className="flex-1 overflow-y-auto p-2 font-mono text-[10px] space-y-0.5">
            {eventLog.length === 0 && (
              <div className="text-gray-400 italic">No events yet</div>
            )}
            {eventLog.map((line, i) => (
              <div
                key={i}
                className={
                  line.includes("REASONING") || line.includes("THINKING")
                    ? "text-purple-700 font-bold"
                    : "text-gray-600"
                }
              >
                {line}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ScenarioDeprecated() {
  return (
    <CopilotKit runtimeUrl="/api/tickets/tkt-reasoning-events/copilot" agent="default">
      <ScenarioDeprecatedInner />
    </CopilotKit>
  );
}
