"use client";

import React from "react";

/**
 * Right-aligned user bubble — pure chrome.
 *
 * Receives a precomputed `renderedContent` node (built by
 * `useRenderedMessages`). For user messages that's just the text content of
 * the message (attachments etc. are stripped in the headless composer).
 *
 * Note on `data-testid="headless-message-user"`: this attribute is
 * intentionally NOT unique — the parent renders one `<UserBubble>` per user
 * message in the conversation, so N user turns produce N matching nodes.
 * This matches the canonical LGP implementation at
 * `showcase/integrations/langgraph-python/src/app/demos/headless-complete/chat/message-user.tsx`
 * so downstream selectors stay byte-identical across integrations. D6 role
 * discrimination uses `data-message-role` (not the testid); tests that need
 * a single bubble should use `.last()`, `.nth(i)`, or a `data-message-role`
 * scoped selector rather than relying on Playwright strict-mode uniqueness.
 */
// @region[custom-bubbles]
export function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-testid="headless-message-user"
      data-message-role="user"
      className="flex justify-end"
    >
      <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-[#010507] text-white px-4 py-2 text-sm whitespace-pre-wrap break-words">
        {children}
      </div>
    </div>
  );
}
// @endregion[custom-bubbles]
