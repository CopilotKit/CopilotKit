import type { Message } from "@ag-ui/core";

/** What decides the chat view's layout. */
export interface ɵChatViewStateInput {
  /** How many messages the chat has. */
  messageCount: number;
  /** How many suggestions are available. */
  suggestionCount: number;
  isRunning: boolean;
  /** Whether the thread's first connect is still loading. */
  isConnecting: boolean;
  /** Whether a caller picked the thread (see `hasExplicitThreadId`). */
  hasExplicitThreadId: boolean;
  /** `false` when the app turned the welcome screen off. */
  welcomeScreenEnabled: boolean;
  /** The measured height of the input overlay, in px. */
  inputContainerHeight: number;
}

/**
 * The chat view's layout decisions:
 *
 * - `hasSuggestions`: suggestions show only when there are some and the
 *   thread is neither connecting nor running. Mid-replay or mid-run they would
 *   render against a message tree that is still changing and jump.
 * - `showWelcomeScreen`: the welcome screen shows for an empty chat, unless
 *   the app turned it off, the first connect is loading, or a caller picked
 *   the thread (a picked thread is never greeted generically, even when
 *   empty).
 * - `paddingBottom`: room under the messages for the input overlay, plus 4px
 *   with suggestions or 32px without.
 */
export function ɵgetChatViewState(input: ɵChatViewStateInput) {
  const hasSuggestions =
    !input.isConnecting && !input.isRunning && input.suggestionCount > 0;
  const showWelcomeScreen =
    input.messageCount === 0 &&
    input.welcomeScreenEnabled &&
    !input.isConnecting &&
    !input.hasExplicitThreadId;
  return {
    hasSuggestions,
    showWelcomeScreen,
    paddingBottom: input.inputContainerHeight + (hasSuggestions ? 4 : 32),
  };
}

/** The latest user message and how many sends the chat has seen. */
export interface ɵLastUserMessageState {
  id: string | null;
  /** Grows by one on each new send, so a repeated id still triggers effects. */
  sendNonce: number;
}

/** The id of the last user message, or `null` when there is none. */
export function ɵgetLastUserMessageId(messages: readonly Message[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role === "user") return message.id;
  }
  return null;
}

/**
 * Tracks the latest user message for pin-to-send scrolling. The messages the
 * chat starts with do not count as a send, so restoring a thread does not
 * scroll; each later new user-message id bumps `sendNonce`.
 *
 * @example
 * ```ts
 * const tracker = ɵcreateLastUserMessageTracker(agent.messages);
 * const state = tracker.update(agent.messages); // same object until a send
 * ```
 */
export function ɵcreateLastUserMessageTracker(
  initialMessages: readonly Message[],
) {
  let state: ɵLastUserMessageState = {
    id: ɵgetLastUserMessageId(initialMessages),
    sendNonce: 0,
  };
  // The last id that counted as a send. A clear (no user message) keeps it,
  // so the same message coming back is not a new send.
  let lastSentId = state.id;
  return {
    /** The state for `messages`. Keeps its identity until the last user message changes. */
    update(messages: readonly Message[]) {
      const id = ɵgetLastUserMessageId(messages);
      if (id === state.id) return state;
      const isNewSend = id !== null && id !== lastSentId;
      if (isNewSend) lastSentId = id;
      state = {
        id,
        sendNonce: isNewSend ? state.sendNonce + 1 : state.sendNonce,
      };
      return state;
    },
  };
}
