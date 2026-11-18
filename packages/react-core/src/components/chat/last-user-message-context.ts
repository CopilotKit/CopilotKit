import React from "react";

/**
 * Context used by `CopilotChatView` to announce the latest user message
 * to descendants (notably `usePinToSend`), so scroll logic can anchor
 * the viewport to the most recent user turn in "pin-to-send" mode.
 *
 * `sendNonce` increments on each new send so repeated IDs (e.g., message
 * edits that preserve the ID) still trigger dependent effects.
 */
export type LastUserMessageState = {
  id: string | null;
  sendNonce: number;
};

export const LastUserMessageContext = React.createContext<LastUserMessageState>(
  {
    id: null,
    sendNonce: 0,
  },
);
