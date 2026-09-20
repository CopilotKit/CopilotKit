import type { AssistantMessage, Message } from "@ag-ui/core";

/**
 * Stable React keys for chat rows, across backends that re-key a message
 * mid-stream.
 *
 * ## The problem
 *
 * A message's canonical `id` is not stable within a turn. LangChain stamps a
 * placeholder id on the first streamed chunk when the provider didn't supply
 * one (`chat_models.py`: `if chunk.message.id is None: chunk.message.id =
 * "lc_run-" + "-" + run_id`), then prefers any provider-assigned id it sees
 * while merging chunks (`messages/ai.py`, "Ranks are defined by the order of
 * preference"). The `MESSAGES_SNAPSHOT` therefore carries the provider's final
 * id (e.g. `resp_…`) for a message the client already knows as `lc_run--…`.
 *
 * Keying rows by `id` made React unmount and remount the row on that swap —
 * the visible HITL chat flash, where a rendered approval card appears to
 * reset during a tool's `executing → complete` transition.
 *
 * This is provider-conditional: providers that stamp an id on every chunk
 * (so `chunk.message.id is None` never holds) never trigger a rename.
 *
 * ## The approach
 *
 * Tool-call ids survive the rename, so they are used as *anchors*: the first
 * message seen carrying a given tool call records the row key it was assigned,
 * and any later message carrying that same tool call reuses it. The store is
 * an override table consulted before falling back to `message.id`. Rendering
 * only reads it; each commit then records what it rendered:
 *
 * ```text
 * render 1  id=lc_run--1  no tools    key = message.id = lc_run--1
 *   commit 1                                                           store {}
 * render 2  id=lc_run--1  tc call_A   key = message.id = lc_run--1
 *   commit 2                                           store { tc:call_A -> lc_run--1 }
 * render 3  id=resp_1     tc call_A   key = store[tc:call_A]
 *                                         = lc_run--1  (no remount)
 *   commit 3                                                    store unchanged
 * ```
 *
 * Recording the anchor at commit 2 — while the id is still stable — is what
 * makes render 3 resolvable. Note the fix does not depend on render 2 existing:
 * a message born already carrying a tool call anchors on the first render that
 * commits it, under whatever id it holds then.
 *
 * ## Why an override table rather than keying rows by tool-call id
 *
 * Deriving the key from the tool call directly (`tc:<id>` whenever a tool call
 * is present) needs no state, but changes the key the moment a tool call
 * *appears* — so an assistant message that streams text and then calls a tool
 * remounts on that transition, for every provider, whether or not it renames.
 * That trades a conditional flash for an unconditional one. Recording an
 * override keeps the key the row already had.
 *
 * ## Cost
 *
 * The store holds only `tc:<toolCallId>` entries, so a conversation with no
 * tool calls keeps an empty store and behaviour byte-identical to keying by
 * `id`. Size is bounded to the tool calls of the currently-rendered messages
 * (see `pruneRowKeyStore`), not the conversation length. Deleting the store
 * reverts to plain `id` keying.
 *
 * ## Known gaps
 *
 * - A text-only assistant message has no anchor, so it still remounts when
 *   re-keyed. No client-side correlation signal exists for it; the fix is
 *   stable ids upstream.
 * - If the tool call's arrival and the id swap land in the same React batch,
 *   the intermediate state never renders, the anchor is never registered, and
 *   the row remounts as before. Correlating in the event-apply layer (i.e. in
 *   the AG-UI client, which observes every intermediate state) would be immune.
 */

const TOOL_ANCHOR_PREFIX = "tc:";

export interface RowKeyStore {
  /**
   * `tc:<toolCallId>` → the row key first assigned to a message carrying that
   * tool call. Populated only for assistant messages that carry tool calls.
   */
  overrides: Map<string, string>;
  /**
   * Anchors carried by more than one message in the last committed list. Such
   * an anchor identifies no single row, so it is never used to vend a key.
   */
  ambiguous: Set<string>;
}

export function createRowKeyStore(): RowKeyStore {
  return { overrides: new Map(), ambiguous: new Set() };
}

/**
 * Anchors a message contributes. Only assistant tool calls qualify: LangChain's
 * id preference applies when merging `AIMessageChunk`s, so user message ids are
 * not renamed, and `role: "tool"` messages are not rendered as rows at all.
 * Every tool call is used (not just the first) so the anchor survives tool-call
 * reordering between snapshots.
 */
function toolAnchorsOf(message: Message): string[] {
  if (message.role !== "assistant") return [];
  const toolCalls = (message as AssistantMessage).toolCalls;
  if (!toolCalls?.length) return [];

  const anchors: string[] = [];
  for (const toolCall of toolCalls) {
    if (toolCall?.id) anchors.push(`${TOOL_ANCHOR_PREFIX}${toolCall.id}`);
  }
  return anchors;
}

/**
 * Resolves `message.id` → row key for one render pass.
 *
 * Pure: it reads `store` and never writes to it. React may double-invoke a
 * render in StrictMode, and may render a newer snapshot at low priority and
 * then abandon that render entirely. An anchor recorded by a render that never
 * commits would vend its key to the render that does — re-keying the row the
 * user is looking at, which is the remount this module exists to prevent.
 * Anchors are therefore recorded by `commitRowKeyStore` after the commit.
 *
 * `messages` must be deduplicated (see `deduplicateMessages`): duplicate ids
 * would overwrite each other in the returned map. Iteration order is
 * significant — the first message to claim a key keeps it.
 */
export function resolveRowRenderKeys(
  store: RowKeyStore,
  messages: Message[],
): Map<string, string> {
  const keys = new Map<string, string>();
  const claimed = new Set<string>();

  for (const message of messages) {
    const anchors = toolAnchorsOf(message);

    // Reuse the key recorded for any of this message's anchors. An override
    // pointing at a key another row already claimed this pass is skipped:
    // two messages can share a tool-call id (upstream bug, or replayed
    // state), and the later one falls back to its own id instead.
    let key: string | undefined;
    for (const anchor of anchors) {
      if (store.ambiguous.has(anchor)) continue;
      const recorded = store.overrides.get(anchor);
      if (recorded !== undefined && !claimed.has(recorded)) {
        key = recorded;
        break;
      }
    }

    key ??= message.id;

    // Backstop for a pathological collision: an override vends a key equal to
    // a later message's own id. Deduplicated ids can't collide with each
    // other, so this only triggers against an override-supplied key.
    if (claimed.has(key)) {
      let suffix = 2;
      while (claimed.has(`${key}:${suffix}`)) suffix += 1;
      key = `${key}:${suffix}`;
    }

    keys.set(message.id, key);
    claimed.add(key);
  }

  return keys;
}

/**
 * Records the anchors of a committed render, then bounds the store to it.
 * Call from a post-commit effect, never during render — see
 * `resolveRowRenderKeys`.
 *
 * Re-resolving here reproduces the keys the commit actually rendered with,
 * because the store cannot change between a render and its own commit effect.
 *
 * An anchor carried by two rows in the same list is marked ambiguous rather
 * than recorded. Recording it would give the first row's key to whichever row
 * outlived the other, and with it that row's DOM and component state.
 */
export function commitRowKeyStore(
  store: RowKeyStore,
  messages: Message[],
): void {
  const keys = resolveRowRenderKeys(store, messages);

  const anchorCounts = new Map<string, number>();
  for (const message of messages) {
    for (const anchor of toolAnchorsOf(message)) {
      anchorCounts.set(anchor, (anchorCounts.get(anchor) ?? 0) + 1);
    }
  }

  // Ambiguity is a property of the committed list, so it is recomputed rather
  // than accumulated: an anchor left alone by the row that shadowed it becomes
  // usable again.
  store.ambiguous.clear();
  for (const [anchor, count] of anchorCounts) {
    if (count > 1) {
      store.ambiguous.add(anchor);
      store.overrides.delete(anchor);
    }
  }

  // First claimant of an anchor owns it, so a re-keyed message resolves to
  // the key the row already had rather than overwriting it.
  for (const message of messages) {
    const key = keys.get(message.id);
    if (key === undefined) continue;
    for (const anchor of toolAnchorsOf(message)) {
      if (store.ambiguous.has(anchor)) continue;
      if (!store.overrides.has(anchor)) store.overrides.set(anchor, key);
    }
  }

  pruneRowKeyStore(store, messages);
}

/**
 * Drops anchors no longer present in `messages`, bounding the store to the
 * tool calls of the currently-rendered messages. Called by
 * `commitRowKeyStore`; like it, this writes to the store and so belongs after
 * commit, never during render.
 *
 * Pruned entries are unreachable by construction: `resolveRowRenderKeys` only
 * looks up anchors belonging to messages in the list it is given.
 */
export function pruneRowKeyStore(
  store: RowKeyStore,
  messages: Message[],
): void {
  const live = new Set<string>();
  for (const message of messages) {
    for (const anchor of toolAnchorsOf(message)) live.add(anchor);
  }

  for (const anchor of store.overrides.keys()) {
    if (!live.has(anchor)) store.overrides.delete(anchor);
  }
  for (const anchor of store.ambiguous) {
    if (!live.has(anchor)) store.ambiguous.delete(anchor);
  }
}
