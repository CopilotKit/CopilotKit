import { DEFAULT_AWAIT_CHOICE_TIMEOUT_MS } from "@copilotkit/channels-core";
import type { StateStore } from "@copilotkit/channels-core";
import type { RenderedChoice } from "./render/message.js";
import type { LinearMessageRef } from "./types.js";

/**
 * How long a posted elicitation stays answerable: the `awaitChoice` default
 * timeout (one hour). After that a reply is an ordinary prompt again.
 */
export const PENDING_CHOICE_TTL_MS = DEFAULT_AWAIT_CHOICE_TIMEOUT_MS;

/**
 * The latest `select` elicitation the adapter posted into one agent session.
 * Linear echoes a pick as a plain `prompt` activity, so ingress needs this to
 * map the reply back to an interaction.
 */
export interface PendingChoiceSet {
  /** The elicitation activity the options were posted on. */
  messageRef: LinearMessageRef;
  /** The options of that elicitation, as `renderLinearMessage` returned them. */
  choices: RenderedChoice[];
}

function pendingChoiceKey(agentSessionId: string) {
  return `linear:pending-choice:${agentSessionId}`;
}

/**
 * Store the options of an elicitation as the pending set for its session.
 * A newer elicitation in the same session replaces the older set.
 *
 * @param store - Adapter state store.
 * @param set - The posted elicitation ref and its rendered choices.
 */
export function savePendingChoices(store: StateStore, set: PendingChoiceSet) {
  return store.kv.set(
    pendingChoiceKey(set.messageRef.agentSessionId),
    set,
    PENDING_CHOICE_TTL_MS,
  );
}

/**
 * Read the pending choice set of a session, or `undefined` when there is none
 * or it expired.
 *
 * @param store - Adapter state store.
 * @param agentSessionId - The Linear agent session id.
 */
export function readPendingChoices(store: StateStore, agentSessionId: string) {
  return store.kv.get<PendingChoiceSet>(pendingChoiceKey(agentSessionId));
}

/**
 * Drop the pending choice set of a session, for example after a reply
 * matched one of its options.
 *
 * @param store - Adapter state store.
 * @param agentSessionId - The Linear agent session id.
 */
export function clearPendingChoices(store: StateStore, agentSessionId: string) {
  return store.kv.delete(pendingChoiceKey(agentSessionId));
}
