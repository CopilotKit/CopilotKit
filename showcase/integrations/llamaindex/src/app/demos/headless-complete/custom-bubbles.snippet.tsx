// Docs-only snippet — not imported or rendered. The dashboard demo at
// `page.tsx` for this framework uses its own custom-bubble composition
// pattern; the canonical `/headless` doc teaches the `useRenderedMessages`
// + bubble-chrome shape that this file mirrors. So the docs render real
// teaching code rather than a missing-snippet box.
//
// Mirrors the convention from `tool-rendering/render-flight-tool.snippet.tsx`.

"use client";

import React from "react";

/**
 * Right-aligned user bubble — pure chrome.
 *
 * Receives a precomputed `renderedContent` node (built by
 * `useRenderedMessages`). For user messages that's just the text content of
 * the message (attachments etc. are stripped in the headless composer).
 */
// @region[custom-bubbles]
export function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-[#010507] text-white px-4 py-2 text-sm whitespace-pre-wrap break-words">
        {children}
      </div>
    </div>
  );
}
// @endregion[custom-bubbles]

("use client");

/**
 * Left-aligned assistant bubble — pure chrome.
 *
 * Receives a precomputed `renderedContent` node (built by
 * `useRenderedMessages`) and wraps it in the styled bubble container.
 * No imports from `@copilotkit/react-core`'s chat primitives here — the
 * manual composition upstream already produced the final node, so this
 * file is purely presentational.
 *
 * An empty node (e.g. an assistant message that has neither text nor tool
 * calls yet) is suppressed so the bubble doesn't flash an empty rounded
 * box while streaming hasn't started.
 */
// @region[custom-bubbles]
export function AssistantBubble({ children }: { children: React.ReactNode }) {
  if (isEmpty(children)) return null;

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] flex flex-col gap-2">
        <div className="rounded-2xl rounded-bl-sm bg-[#F0F0F4] text-[#010507] px-4 py-2 text-sm">
          {children}
        </div>
      </div>
    </div>
  );
}
// @endregion[custom-bubbles]

function isEmpty(node: React.ReactNode): boolean {
  if (node == null || node === false) return true;
  if (typeof node === "string") return node.trim().length === 0;
  if (Array.isArray(node)) return node.every(isEmpty);
  return false;
}
