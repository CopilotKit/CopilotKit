"use client";

import React, { useEffect, useRef } from "react";
import { useRenderToolCall } from "@copilotkit/react-core/v2";
import type { Message } from "@ag-ui/core";

export function MessageList({
  messages,
  isRunning,
}: {
  messages: Message[];
  isRunning: boolean;
}) {
  const renderToolCall = useRenderToolCall();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isRunning]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
      {messages.length === 0 && (
        <div className="text-sm text-gray-400">No messages yet. Say hi!</div>
      )}
      {messages.map((m) => {
        if (m.role === "user") {
          return (
            <div
              key={m.id}
              className="self-end ml-auto max-w-[80%] rounded-lg bg-blue-600 px-3 py-2 text-white"
            >
              {typeof m.content === "string" ? m.content : ""}
            </div>
          );
        }
        if (m.role === "assistant") {
          const toolCalls =
            "toolCalls" in m && Array.isArray((m as any).toolCalls)
              ? (m as any).toolCalls
              : [];
          return (
            <div key={m.id} className="max-w-[90%]">
              {m.content && (
                <div className="rounded-lg bg-gray-100 px-3 py-2 text-gray-900">
                  {m.content as React.ReactNode}
                </div>
              )}
              {toolCalls.map((tc: any) => (
                <div key={tc.id} className="mt-1">
                  {renderToolCall({ toolCall: tc })}
                </div>
              ))}
            </div>
          );
        }
        return null;
      })}
      {isRunning && (
        <div className="text-xs text-gray-400">Agent is thinking...</div>
      )}
      <div ref={endRef} />
    </div>
  );
}
