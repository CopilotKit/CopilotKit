import { DEFAULT_AWAIT_CHOICE_TIMEOUT_MS } from "@copilotkit/channels-core";
import type { StateStore } from "@copilotkit/channels-core";
import type { RenderedChoice } from "./render/message.js";
import type { NotionMessageRef } from "./types.js";

/** The numbered choices last posted in one discussion. */
export interface PendingChoices {
  /** The comment that lists the choices. */
  messageRef: NotionMessageRef;
  choices: RenderedChoice[];
}

/** How long a discussion stays joined after the bot replies in it: 30 days. */
export const JOINED_DISCUSSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** TTL options for a state write. */
export interface StateTtlOptions {
  ttlMs?: number;
}

function pendingKey(discussionId: string) {
  return `notion:pending-choices:${discussionId}`;
}

function joinedKey(discussionId: string) {
  return `notion:joined:${discussionId}`;
}

/**
 * Store the numbered choices just posted in a discussion. A newer set
 * replaces the older one.
 *
 * @param store - Adapter state store.
 * @param discussionId - Discussion the choice comment was posted in.
 * @param pending - The posted comment and its choices.
 * @param options - `ttlMs` (default one hour, the `awaitChoice` default).
 */
export async function savePendingChoices(
  store: StateStore,
  discussionId: string,
  pending: PendingChoices,
  options: StateTtlOptions = {},
) {
  const ttlMs = options.ttlMs ?? DEFAULT_AWAIT_CHOICE_TIMEOUT_MS;
  await store.kv.set(pendingKey(discussionId), pending, ttlMs);
}

/**
 * Read the pending numbered choices of a discussion.
 *
 * @param store - Adapter state store.
 * @param discussionId - Discussion to read.
 * @returns The pending choices, or `undefined` when none are live.
 */
export async function readPendingChoices(
  store: StateStore,
  discussionId: string,
) {
  return store.kv.get<PendingChoices>(pendingKey(discussionId));
}

/**
 * Drop the pending numbered choices of a discussion (after a reply picked one).
 *
 * @param store - Adapter state store.
 * @param discussionId - Discussion to clear.
 */
export async function clearPendingChoices(
  store: StateStore,
  discussionId: string,
) {
  await store.kv.delete(pendingKey(discussionId));
}

/**
 * Mark a discussion as joined, so later comments in it are turns without a
 * mention. Call it after the bot posts its first reply in the discussion.
 *
 * @param store - Adapter state store.
 * @param discussionId - Discussion the bot replied in.
 * @param options - `ttlMs` (default {@link JOINED_DISCUSSION_TTL_MS}).
 */
export async function markJoined(
  store: StateStore,
  discussionId: string,
  options: StateTtlOptions = {},
) {
  const ttlMs = options.ttlMs ?? JOINED_DISCUSSION_TTL_MS;
  await store.kv.set(joinedKey(discussionId), true, ttlMs);
}

/**
 * Whether the bot has replied in a discussion within the joined TTL.
 *
 * @param store - Adapter state store.
 * @param discussionId - Discussion to check.
 */
export async function isJoined(store: StateStore, discussionId: string) {
  const joined = await store.kv.get<boolean>(joinedKey(discussionId));
  return joined === true;
}
