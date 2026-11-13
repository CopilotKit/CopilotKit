import React from "react";

/**
 * Context used by `CopilotChatView` to announce the latest user message
 * to descendants (notably `usePinToSend`), so scroll logic can anchor
 * the viewport to the most recent user turn in "pin-to-send" mode.
 *
 * `sendNonce` increments on each new send so repeated IDs (e.g., message
 * edits that preserve the ID) still trigger dependent effects.
 *
 * While a message waits to be sent (queued behind a run), `id` is that
 * message's id, which `agent.messages` does not hold until it is dispatched.
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
