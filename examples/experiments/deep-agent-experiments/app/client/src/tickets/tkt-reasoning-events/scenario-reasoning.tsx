/**
 * Scenario: Correct approach — subscribe using dedicated onReasoning* callbacks
 *
 * Component tree:
 *   <CopilotKit runtimeUrl="..." agent="default">
 *     <ScenarioReasoningInner />           ← useAgent + subscribe with onReasoning* callbacks
 *       └─ chat input + message display + reasoning log
 *
 * Expected result: WORKS when the model actually supports reasoning (o4-mini, o3, etc).
 * Still shows no reasoning events if the model (e.g. GPT-5-Nano) doesn't produce them.
 *
 * Why: The ag-ui client has dedicated subscriber callbacks for reasoning events:
 *   - onReasoningStartEvent
 *   - onReasoningMessageStartEvent
 *   - onReasoningMessageContentEvent
 *   - onReasoningMessageEndEvent
 *   - onReasoningEndEvent
 * These fire on REASONING_* event types, which is what BuiltInAgent emits.
 */

import { useState, useEffect, useRef } from "react";
import { CopilotKit } from "@copilotkit/react-core";
import { useAgent } from "@copilotkit/react-core/v2";
import type { AgentSubscriber, Message } from "@ag-ui/client";
import { TAG } from "./lib";

function ScenarioReasoningInner() {
  const { agent } = useAgent({});
  const [input, setInput] = useState("");
  const [reasoningLog, setReasoningLog] = useState<string[]>([]);
  const [reasoningContent, setReasoningContent] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!agent) return;

    console.log(TAG, "[reasoning] Subscribing with onReasoning* callbacks");

    const subscriber: AgentSubscriber = {
      onReasoningStartEvent: () => {
        console.log(TAG, "[reasoning] REASONING_START");
        setReasoningLog((prev) => [...prev.slice(-50), "REASONING_START"]);
        setReasoningContent("");
      },
      onReasoningMessageStartEvent: ({ event }) => {
        console.log(TAG, "[reasoning] REASONING_MESSAGE_START", event.messageId);
        setReasoningLog((prev) => [
          ...prev.slice(-50),
          `REASONING_MESSAGE_START (id=${event.messageId})`,
        ]);
      },
      onReasoningMessageContentEvent: ({ event, reasoningMessageBuffer }) => {
        const delta = event.delta ?? "";
        console.log(
          TAG,
          "[reasoning] REASONING_MESSAGE_CONTENT delta:",
          JSON.stringify(delta).slice(0, 80),
        );
        setReasoningContent(reasoningMessageBuffer);
        setReasoningLog((prev) => [
          ...prev.slice(-50),
          `REASONING_MESSAGE_CONTENT delta=${JSON.stringify(delta).slice(0, 40)}`,
        ]);
      },
      onReasoningMessageEndEvent: ({ reasoningMessageBuffer }) => {
        console.log(
          TAG,
          "[reasoning] REASONING_MESSAGE_END, full:",
          reasoningMessageBuffer.slice(0, 200),
        );
        setReasoningLog((prev) => [...prev.slice(-50), "REASONING_MESSAGE_END"]);
      },
      onReasoningEndEvent: () => {
        console.log(TAG, "[reasoning] REASONING_END");
        setReasoningLog((prev) => [...prev.slice(-50), "REASONING_END"]);
      },
      onTextMessageStartEvent: () => {
        console.log(TAG, "[reasoning] TEXT_MESSAGE_START (for comparison)");
        setReasoningLog((prev) => [...prev.slice(-50), "TEXT_MESSAGE_START"]);
      },
      onTextMessageEndEvent: () => {
        console.log(TAG, "[reasoning] TEXT_MESSAGE_END (for comparison)");
        setReasoningLog((prev) => [...prev.slice(-50), "TEXT_MESSAGE_END"]);
      },
    };

    const sub = agent.subscribe(subscriber);
    return () => sub.unsubscribe();
  }, [agent]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [agent?.messages?.length, reasoningLog.length]);

  const handleSend = async () => {
    if (!input.trim() || !agent || agent.isRunning) return;
    const content = input.trim();
    setInput("");
    setReasoningLog([]);
    setReasoningContent("");

    console.log(TAG, "[reasoning] Sending message:", content);

    agent.addMessage({
      id: crypto.randomUUID(),
      role: "user",
      content,
    });

    try {
      await agent.runAgent();
      console.log(TAG, "[reasoning] runAgent() completed");
    } catch (err) {
      console.error(TAG, "[reasoning] runAgent() error:", err);
    }
  };

  return (
    <div className="flex flex-col h-[500px]">
      <div className="p-3 bg-green-50 border-b border-green-200 text-xs text-green-700">
        <strong>Correct approach:</strong> Using dedicated <code>onReasoningStartEvent</code>,{" "}
        <code>onReasoningMessageContentEvent</code>, etc. callbacks.
        Works when the model actually supports reasoning (o4-mini, o3).
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

          {/* Live reasoning content */}
          {reasoningContent && (
            <div className="p-2 bg-purple-50 border-t border-purple-200 text-xs text-purple-700 max-h-24 overflow-y-auto">
              <strong>Live reasoning:</strong> {reasoningContent}
            </div>
          )}

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
            Reasoning events
          </div>
          <div className="flex-1 overflow-y-auto p-2 font-mono text-[10px] space-y-0.5">
            {reasoningLog.length === 0 && (
              <div className="text-gray-400 italic">No events yet</div>
            )}
            {reasoningLog.map((line, i) => (
              <div
                key={i}
                className={
                  line.includes("REASONING")
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

export default function ScenarioReasoning() {
  return (
    <CopilotKit runtimeUrl="/api/tickets/tkt-reasoning-events/copilot" agent="default">
      <ScenarioReasoningInner />
    </CopilotKit>
  );
}
