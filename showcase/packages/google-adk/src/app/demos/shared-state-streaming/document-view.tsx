"use client";

import React from "react";

export function DocumentView({
  content,
  isStreaming,
}: {
  content: string;
  isStreaming: boolean;
}) {
  return (
    <div className="h-full flex flex-col rounded-2xl bg-white border border-[#DBDBE5] shadow-sm">
      <header className="flex items-center justify-between px-5 py-3 border-b border-[#E9E9EF]">
        <div>
          <h2 className="text-sm font-semibold text-[#010507]">
            Streaming Document
          </h2>
          <p className="text-xs text-[#838389] mt-0.5">
            Updates token-by-token as the agent writes.
          </p>
        </div>
        {isStreaming && (
          <span
            data-testid="streaming-live-badge"
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-[11px] font-medium"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            LIVE
          </span>
        )}
      </header>
      <div
        data-testid="streaming-document"
        className="flex-1 overflow-y-auto px-6 py-5 prose prose-sm max-w-none"
      >
        {content ? (
          <pre className="whitespace-pre-wrap font-sans text-[#010507] text-sm leading-relaxed">
            {content}
            {isStreaming && <span className="ml-0.5 animate-pulse">▍</span>}
          </pre>
        ) : (
          <p className="text-sm text-[#838389] italic">
            No document yet. Ask the assistant to write something.
          </p>
        )}
      </div>
    </div>
  );
}
