import type { InjectionKey, Ref } from "vue";
import { ref } from "vue";

/**
 * Vue counterpart of React's `LastUserMessageContext`.
 *
 * Used by `CopilotChatView` to announce the latest user message
 * to descendants (notably `usePinToSend`), so scroll logic can anchor
 * the viewport to the most recent user turn in "pin-to-send" mode.
 *
 * `sendNonce` increments on each new send so repeated IDs (e.g., message
 * edits that preserve the ID) still trigger dependent effects.
 *
 * Vue divergence: React exposes a `React.Context` whose value is replaced
 * via `<Provider value={...}>`. Vue idiomatically provides a `Ref` so
 * descendant `watch` effects fire when the value changes; the underlying
 * `{ id, sendNonce }` shape and semantics match React 1:1.
 */
export type LastUserMessageState = {
  id: string | null;
  sendNonce: number;
};

export const DEFAULT_LAST_USER_MESSAGE_STATE: LastUserMessageState = {
  id: null,
  sendNonce: 0,
};

export const LastUserMessageKey: InjectionKey<Ref<LastUserMessageState>> =
  Symbol("LastUserMessage");

/**
 * Returns the default `LastUserMessageState` ref used when no provider
 * has been mounted above the consumer. Mirrors React's context default
 * value (`{ id: null, sendNonce: 0 }`).
 */
export function createDefaultLastUserMessageRef(): Ref<LastUserMessageState> {
  return ref({ ...DEFAULT_LAST_USER_MESSAGE_STATE });
}
