"use client";

import React from "react";

export interface DocumentViewProps {
  /** Current document text. Grows token-by-token while the agent is streaming. */
  content: string;
  /** True while the agent is actively running. Used to show a live indicator. */
  isStreaming: boolean;
}

/**
 * Live document panel — renders the `document` slot of agent state.
 *
 * On every streamed token, the parent re-renders this component with a
 * longer `content` string. We surface:
 *
 *   - a "LIVE" badge + blinking cursor while the agent is running
 *   - the current character count (a cheap but visible token-ish counter)
 *   - the growing document text
 *
 * Together they make the per-token delta stream obvious to a viewer.
 */
export function DocumentView({ content, isStreaming }: DocumentViewProps) {
  const charCount = content.length;

  return (
    <div
      data-testid="document-view"
      className="w-full h-full flex flex-col bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden"
    >
      <div className="flex items-center justify-between px-6 py-3 border-b bg-gradient-to-r from-blue-50 to-purple-50">
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold text-gray-800">Document</span>
          {isStreaming && (
            <span
              data-testid="document-live-badge"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold tracking-wide"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              LIVE
            </span>
          )}
        </div>
        <span
          data-testid="document-char-count"
          className="text-xs text-gray-500 font-mono"
        >
          {charCount} chars
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {content.length === 0 && !isStreaming ? (
          <p className="text-gray-400 italic">
            Ask the agent to write something — its output will stream here token
            by token.
          </p>
        ) : (
          <div
            data-testid="document-content"
            className="whitespace-pre-wrap text-gray-800 leading-relaxed font-serif"
          >
            {content}
            {isStreaming && (
              <span className="inline-block w-2 h-5 bg-blue-500 ml-0.5 align-text-bottom animate-pulse" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
