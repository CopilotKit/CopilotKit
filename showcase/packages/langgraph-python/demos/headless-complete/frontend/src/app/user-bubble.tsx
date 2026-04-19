"use client";

import React from "react";

/**
 * Right-aligned user bubble — pure chrome.
 *
 * Receives a precomputed `renderedContent` node (built by
 * `useRenderedMessages`). For user messages that's just the text content of
 * the message (attachments etc. are stripped in the headless composer).
 */
export function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-blue-600 text-white px-4 py-2 text-sm whitespace-pre-wrap break-words">
        {children}
      </div>
    </div>
  );
}
