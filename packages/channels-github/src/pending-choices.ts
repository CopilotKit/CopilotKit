import { DEFAULT_AWAIT_CHOICE_TIMEOUT_MS } from "@copilotkit/channels-core";
import type { StateStore } from "@copilotkit/channels-core";
import type { RenderedChoice } from "./render/message.js";
import type { GitHubMessageRef } from "./types.js";

/** The numbered choice list most recently posted in one conversation. */
export interface PendingChoices {
  /** The comment that shows the numbered list. */
  messageRef: GitHubMessageRef;
  /** The listed choices, in list order. */
  choices: RenderedChoice[];
}

/**
 * How long a posted choice list stays answerable: the `awaitChoice` default
 * timeout (one hour). After that a numbered reply is no longer decoded.
 */
export const PENDING_CHOICES_TTL_MS = DEFAULT_AWAIT_CHOICE_TIMEOUT_MS;

function storeKey(conversationKey: string) {
  return `github:pending-choices:${conversationKey}`;
}

/**
 * Record the choice list just posted in a conversation. It replaces any older
 * list in that conversation. An empty `choices` list clears the entry.
 *
 * @param store - Adapter state store.
 * @param conversationKey - Key from `conversationKeyOf`.
 * @param pending - The posted comment and its choices.
 */
export async function savePendingChoices(
  store: StateStore,
  conversationKey: string,
  pending: PendingChoices,
) {
  if (pending.choices.length === 0) {
    await store.kv.delete(storeKey(conversationKey));
    return;
  }
  await store.kv.set(
    storeKey(conversationKey),
    pending,
    PENDING_CHOICES_TTL_MS,
  );
}

/**
 * Read the live choice list of a conversation.
 *
 * @param store - Adapter state store.
 * @param conversationKey - Key from `conversationKeyOf`.
 * @returns The pending set, or `undefined` when none is live.
 */
export function readPendingChoices(store: StateStore, conversationKey: string) {
  return store.kv.get<PendingChoices>(storeKey(conversationKey));
}

/**
 * Atomically remove and return the choice list of a conversation. Call it
 * after a reply decoded, so each list is answered once.
 *
 * @param store - Adapter state store.
 * @param conversationKey - Key from `conversationKeyOf`.
 * @returns The removed set, or `undefined` when another reply already took it.
 */
export function clearPendingChoices(
  store: StateStore,
  conversationKey: string,
) {
  return store.kv.consume<PendingChoices>(storeKey(conversationKey));
}
