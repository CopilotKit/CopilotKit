"use client";

import React from "react";

interface MessageItem {
  id: string;
  role: string;
  content?: unknown;
  toolCalls?: { id: string; name?: string; args?: unknown }[];
}

export function MessageList({
  messages,
  isRunning,
}: {
  messages: MessageItem[];
  isRunning: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 px-2 py-3 min-h-[400px] max-h-[600px] overflow-y-auto">
      {messages.length === 0 && (
        <div className="text-sm text-slate-400 italic px-2">
          No messages yet. Say hi.
        </div>
      )}
      {messages.map((m) => (
        <MessageRow key={m.id} message={m} />
      ))}
      {isRunning && (
        <div
          className="self-start text-xs text-slate-500 px-3 py-1.5 rounded-full bg-slate-100 inline-flex items-center gap-2"
          data-testid="agent-thinking"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
          Agent is thinking...
        </div>
      )}
    </div>
  );
}

function MessageRow({ message }: { message: MessageItem }) {
  if (message.role === "user") {
    return (
      <div
        data-testid="msg-user"
        className="self-end max-w-[80%] rounded-2xl rounded-br-md bg-blue-600 px-4 py-2 text-white shadow-sm"
      >
        {typeof message.content === "string" ? message.content : ""}
      </div>
    );
  }
  if (message.role === "assistant") {
    return (
      <div
        data-testid="msg-assistant"
        className="self-start max-w-[88%] space-y-1.5"
      >
        {message.content ? (
          <div className="rounded-2xl rounded-bl-md bg-slate-100 px-4 py-2 text-slate-900">
            {String(message.content)}
          </div>
        ) : null}
        {message.toolCalls?.map((tc) => (
          <div
            key={tc.id}
            data-testid="msg-tool-call"
            className="rounded-xl border border-purple-200 bg-purple-50 px-3 py-2 text-xs text-purple-900"
          >
            <div className="font-mono text-[11px] uppercase tracking-wide text-purple-600 mb-1">
              tool · {tc.name || "?"}
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px]">
              {JSON.stringify(tc.args ?? {}, null, 2)}
            </pre>
          </div>
        ))}
      </div>
    );
  }
  return null;
}
